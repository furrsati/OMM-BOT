/**
 * Blacklist Manager
 *
 * Maintains a permanent blacklist of:
 * 1. Known rugger deployer wallets
 * 2. Associated wallets (2-hop connection analysis)
 * 3. Contract addresses of confirmed scams
 * 4. Wallets that participated in rugs as insiders
 *
 * Blacklist sources:
 * - Internal database (confirmed rugs from bot operations)
 * - Community-submitted blacklists (verified)
 * - On-chain connection analysis
 *
 * CRITICAL: Once blacklisted, always blacklisted - no second chances
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { query } from '../db/postgres';

export interface BlacklistCheckResult {
  isBlacklisted: boolean;
  reason: string | null;
  depth: number; // 0 = direct, 1-2 = connected
  blacklistedAddress: string | null;
}

export class BlacklistManager {
  private connection: Connection;
  private cache: Map<string, boolean> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Initialize blacklist from database
   */
  async initialize(): Promise<void> {
    logger.info('🚫 Initializing Blacklist Manager...');

    try {
      // Load blacklist from database into cache
      await this.loadBlacklistToCache();

      logger.info('✅ Blacklist Manager initialized', {
        entriesLoaded: this.cache.size
      });

    } catch (error: any) {
      logger.error('Error initializing blacklist manager', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if an address is blacklisted (with 2-hop analysis)
   */
  async isBlacklisted(
    address: string,
    checkConnections: boolean = true
  ): Promise<BlacklistCheckResult> {
    // Check direct blacklist first
    const directCheck = await this.checkDirect(address);
    if (directCheck.isBlacklisted) {
      return directCheck;
    }

    // If not directly blacklisted, check connections
    if (checkConnections) {
      const connectionCheck = await this.checkConnections(address, 2);
      if (connectionCheck.isBlacklisted) {
        return connectionCheck;
      }
    }

    return {
      isBlacklisted: false,
      reason: null,
      depth: 0,
      blacklistedAddress: null
    };
  }

  /**
   * Add address to blacklist
   */
  async addToBlacklist(
    address: string,
    type: 'wallet' | 'contract',
    reason: string,
    depth: number = 0
  ): Promise<void> {
    try {
      logger.warn(`🚫 Adding to blacklist: ${address.slice(0, 8)}...`, { reason });

      // Add to database
      await query(`
        INSERT INTO blacklist (address, type, reason, depth, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (address) DO UPDATE
        SET reason = $3, depth = $4, updated_at = NOW()
      `, [address, type, reason, depth]);

      // Add to cache
      this.cache.set(address, true);

      // REDIS REMOVED - caching disabled
      // Add to Redis with 30-day expiry
      // await this.redis.setEx(
      //   `blacklist:${address}`,
      //   30 * 24 * 60 * 60,
      //   JSON.stringify({ type, reason, depth, timestamp: Date.now() })
      // );

    } catch (error: any) {
      logger.error('Error adding to blacklist', { error: error.message });
      throw error;
    }
  }

  /**
   * Batch check multiple addresses
   */
  async batchCheck(addresses: string[]): Promise<Map<string, BlacklistCheckResult>> {
    const results = new Map<string, BlacklistCheckResult>();

    const checks = addresses.map(async (address) => {
      const result = await this.isBlacklisted(address, false); // Skip connections for speed
      results.set(address, result);
    });

    await Promise.allSettled(checks);

    return results;
  }

  /**
   * Import community blacklist
   * Accepts JSON array of blacklist entries
   */
  async importCommunityBlacklist(entries: Array<{
    address: string;
    type: 'wallet' | 'contract';
    reason: string;
  }>): Promise<number> {
    logger.info(`Importing ${entries.length} blacklist entries...`);

    let imported = 0;

    for (const entry of entries) {
      try {
        // Verify address is valid Solana address
        new PublicKey(entry.address);

        await this.addToBlacklist(entry.address, entry.type, `Community: ${entry.reason}`, 0);
        imported++;

      } catch (error: any) {
        logger.warn(`Invalid blacklist entry: ${entry.address}`, { error: error.message });
      }
    }

    logger.info(`✅ Imported ${imported}/${entries.length} blacklist entries`);

    return imported;
  }

  /**
   * Auto-blacklist a confirmed rug
   * Adds deployer and connected wallets to blacklist
   */
  async blacklistConfirmedRug(
    contractAddress: string,
    deployerAddress: string,
    reason: string
  ): Promise<void> {
    logger.warn(`🚨 Blacklisting confirmed rug: ${contractAddress.slice(0, 8)}...`);

    try {
      // Add contract to blacklist
      await this.addToBlacklist(contractAddress, 'contract', `Confirmed rug: ${reason}`, 0);

      // Add deployer to blacklist
      await this.addToBlacklist(deployerAddress, 'wallet', `Rug deployer: ${reason}`, 0);

      // Find and blacklist connected wallets (1-hop only for confirmed rugs)
      const connectedWallets = await this.findConnectedWallets(deployerAddress, 1);

      for (const wallet of connectedWallets) {
        await this.addToBlacklist(
          wallet,
          'wallet',
          `Connected to rug deployer: ${deployerAddress.slice(0, 8)}`,
          1
        );
      }

      logger.warn(`🚫 Blacklisted rug and ${connectedWallets.length} connected wallets`);

    } catch (error: any) {
      logger.error('Error blacklisting rug', { error: error.message });
    }
  }

  /**
   * Get blacklist statistics
   */
  async getStats(): Promise<{
    totalEntries: number;
    wallets: number;
    contracts: number;
    recentlyAdded: number;
  }> {
    try {
      const result = await query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE type = 'wallet') as wallets,
          COUNT(*) FILTER (WHERE type = 'contract') as contracts,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as recent
        FROM blacklist
      `);

      const row = result.rows[0];

      return {
        totalEntries: parseInt(row.total),
        wallets: parseInt(row.wallets),
        contracts: parseInt(row.contracts),
        recentlyAdded: parseInt(row.recent)
      };

    } catch (error: any) {
      logger.error('Error getting blacklist stats', { error: error.message });
      return {
        totalEntries: 0,
        wallets: 0,
        contracts: 0,
        recentlyAdded: 0
      };
    }
  }

  /**
   * Direct blacklist check (no connections)
   */
  private async checkDirect(address: string): Promise<BlacklistCheckResult> {
    // Check cache first
    if (this.cache.has(address)) {
      return {
        isBlacklisted: true,
        reason: 'Directly blacklisted',
        depth: 0,
        blacklistedAddress: address
      };
    }

    // REDIS REMOVED - caching disabled
    // Check Redis
    // const cached = await this.redis.get(`blacklist:${address}`);
    // if (cached) {
    //   const data = JSON.parse(cached);
    //   this.cache.set(address, true); // Update memory cache
    //   return {
    //     isBlacklisted: true,
    //     reason: data.reason,
    //     depth: 0,
    //     blacklistedAddress: address
    //   };
    // }

    // Check database
    try {
      const result = await query(
        'SELECT reason FROM blacklist WHERE address = $1',
        [address]
      );

      if (result.rows.length > 0) {
        this.cache.set(address, true);
        return {
          isBlacklisted: true,
          reason: result.rows[0].reason,
          depth: 0,
          blacklistedAddress: address
        };
      }

    } catch (error: any) {
      logger.debug('Error checking blacklist', { error: error.message });
    }

    return {
      isBlacklisted: false,
      reason: null,
      depth: 0,
      blacklistedAddress: null
    };
  }

  /**
   * Check connections to blacklisted addresses (N hops)
   */
  private async checkConnections(
    address: string,
    maxDepth: number
  ): Promise<BlacklistCheckResult> {
    try {
      // Find connected wallets
      const connected = await this.findConnectedWallets(address, maxDepth);

      // Check if any connected wallet is blacklisted
      for (const wallet of connected) {
        const check = await this.checkDirect(wallet);
        if (check.isBlacklisted) {
          return {
            isBlacklisted: true,
            reason: `Connected to blacklisted address: ${wallet.slice(0, 8)}`,
            depth: 1, // Simplified - would track actual depth in production
            blacklistedAddress: wallet
          };
        }
      }

      return {
        isBlacklisted: false,
        reason: null,
        depth: 0,
        blacklistedAddress: null
      };

    } catch (error: any) {
      logger.debug('Error checking connections', { error: error.message });
      return {
        isBlacklisted: false,
        reason: null,
        depth: 0,
        blacklistedAddress: null
      };
    }
  }

  /**
   * Find wallets connected to an address (N hops deep)
   * STUB: Full implementation requires transaction history analysis
   */
  private async findConnectedWallets(
    address: string,
    maxDepth: number
  ): Promise<string[]> {
    try {
      logger.debug('Finding connected wallets (STUB)', { address, maxDepth });

      // STUB: In production, this would:
      // 1. Get transaction history for the address
      // 2. Extract all addresses that sent/received SOL or tokens
      // 3. Recursively check those addresses up to maxDepth hops
      // 4. Return deduplicated list

      // For now, return empty array
      return [];

    } catch (error: any) {
      logger.debug('Error finding connected wallets', { error: error.message });
      return [];
    }
  }

  /**
   * Load blacklist from database to cache
   */
  private async loadBlacklistToCache(): Promise<void> {
    try {
      const result = await query('SELECT address FROM blacklist');

      for (const row of result.rows) {
        this.cache.set(row.address, true);
      }

      logger.info(`Loaded ${result.rows.length} blacklist entries to cache`);

    } catch (error: any) {
      logger.error('Error loading blacklist to cache', { error: error.message });
    }
  }

  /**
   * Clear cache (force reload from database)
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Blacklist cache cleared');
  }
}
