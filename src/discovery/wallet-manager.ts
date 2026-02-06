/**
 * Wallet Manager
 *
 * Maintains the live smart wallet watchlist:
 * - Keeps 20-100 top-scored wallets active
 * - Re-scores all wallets weekly
 * - Demotes declining wallets
 * - Promotes new qualifying wallets
 * - Detects crowding and rotates burned wallets
 * - Tracks wallet effectiveness
 */

import { Connection } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { SmartWallet } from '../types';
import { query } from '../db/postgres';
import { WalletScorer } from './wallet-scorer';

interface WalletStats {
  address: string;
  signalsGenerated: number;
  tradesEntered: number;
  tradesWon: number;
  avgTimeToMove: number; // Average time from signal to price movement
  isCrowded: boolean;
  isBurned: boolean;
}

export class WalletManager {
  private connection: Connection;
  private scorer: WalletScorer;
  private watchlist: Map<string, SmartWallet> = new Map();
  private walletStats: Map<string, WalletStats> = new Map();
  private maintenanceInterval: NodeJS.Timeout | null = null;

  // Memory management limits - reduced for 512MB Render instances
  private readonly MAX_WATCHLIST_SIZE = 100;
  private readonly MAX_WALLET_STATS = 100;

  constructor(connection: Connection) {
    this.connection = connection;
    this.scorer = new WalletScorer(connection);
  }

  /**
   * Initialize wallet manager and load watchlist
   */
  async initialize(): Promise<void> {
    logger.info('📋 Initializing Wallet Manager...');

    try {
      // Load existing watchlist from database
      await this.loadWatchlist();

      // Load wallet stats
      await this.loadWalletStats();

      // Enforce memory limits immediately after loading
      this.enforceMemoryLimits();

      logger.info(`✅ Wallet Manager initialized`, {
        watchlistSize: this.watchlist.size,
        tier1: this.getTierCount(1),
        tier2: this.getTierCount(2),
        tier3: this.getTierCount(3)
      });

    } catch (error: any) {
      logger.error('Error initializing wallet manager', { error: error.message });
      throw error;
    }
  }

  /**
   * Start weekly re-scoring routine
   */
  async startWeeklyMaintenance(): Promise<void> {
    logger.info('Starting weekly wallet maintenance routine...');

    // Run immediately on start
    await this.performWeeklyMaintenance();

    // Then run every 7 days (store interval for cleanup)
    this.maintenanceInterval = setInterval(async () => {
      await this.performWeeklyMaintenance();
    }, 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * Stop maintenance and cleanup
   */
  stop(): void {
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
    // Clear in-memory caches
    this.watchlist.clear();
    this.walletStats.clear();
    logger.info('Wallet Manager stopped');
  }

  /**
   * Enforce memory limits on in-memory collections
   */
  private enforceMemoryLimits(): void {
    // Limit watchlist size
    if (this.watchlist.size > this.MAX_WATCHLIST_SIZE) {
      const entries = Array.from(this.watchlist.entries())
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
      this.watchlist.clear();
      entries.slice(0, this.MAX_WATCHLIST_SIZE).forEach(([k, v]) => this.watchlist.set(k, v));
    }

    // Limit wallet stats
    if (this.walletStats.size > this.MAX_WALLET_STATS) {
      const entries = Array.from(this.walletStats.keys());
      const toRemove = entries.slice(0, entries.length - this.MAX_WALLET_STATS);
      for (const key of toRemove) {
        this.walletStats.delete(key);
      }
    }
  }

  /**
   * Perform weekly maintenance
   */
  private async performWeeklyMaintenance(): Promise<void> {
    logger.info('🔧 Performing weekly wallet maintenance...');

    try {
      // Step 1: Remove poor performing wallets FIRST
      logger.info('Removing poor performing wallets...');
      await this.removePoorPerformers();

      // Step 1.5: Demote wallets with declining performance
      logger.info('Checking for declining performance...');
      await this.demoteDecliningWallets();

      // Step 2: Check for wallet rotation (per CLAUDE.md: rotate every 2-4 weeks)
      logger.info('Checking wallet rotation schedule...');
      await this.checkWalletRotation();

      // Step 3: Re-score ALL remaining wallets
      logger.info('Re-scoring all wallets...');
      const rescored = await this.scorer.scoreAllWallets();

      // Step 4: Detect and remove burned wallets
      logger.info('Detecting crowded/burned wallets...');
      await this.detectBurnedWallets();

      // Step 5: Update watchlist based on new scores
      logger.info('Updating watchlist...');
      await this.updateWatchlist(rescored);

      // Step 6: Clean up inactive wallets
      logger.info('Removing inactive wallets...');
      await this.removeInactiveWallets();

      // Step 7: Keep only top performers (max 100 wallets)
      logger.info('Pruning to top performers...');
      await this.pruneToTopPerformers();

      // Step 8: Enforce memory limits on in-memory collections
      this.enforceMemoryLimits();

      logger.info('✅ Weekly maintenance complete', {
        watchlistSize: this.watchlist.size,
        tier1: this.getTierCount(1),
        tier2: this.getTierCount(2),
        tier3: this.getTierCount(3)
      });

    } catch (error: any) {
      logger.error('Error in weekly maintenance', { error: error.message });
    }
  }

  /**
   * Remove wallets with consistently poor performance
   * Criteria for removal:
   * - Win rate < 10% with 5+ tokens entered (proven bad picker)
   * - No wins after 10+ tokens (unable to find winners)
   * - Average peak multiplier < 1.2x with 5+ tokens (not finding good entries)
   * - One-hit wonders: < 3 wins with 5+ tokens (not proven per CLAUDE.md)
   */
  private async removePoorPerformers(): Promise<void> {
    try {
      // Find wallets that meet removal criteria
      const poorPerformers = await query<{ address: string; reason: string }>(
        `SELECT address,
          CASE
            WHEN tokens_entered >= 5 AND win_rate < 0.10 THEN 'Win rate below 10%'
            WHEN tokens_entered >= 10 AND tokens_won = 0 THEN 'No wins after 10+ tokens'
            WHEN tokens_entered >= 5 AND avg_peak_multiplier < 1.2 THEN 'Avg peak below 1.2x'
            WHEN tokens_entered >= 5 AND tokens_won < 3 THEN 'One-hit wonder (< 3 wins with 5+ tokens)'
            ELSE 'Poor performance'
          END as reason
         FROM smart_wallets
         WHERE is_active = true
         AND (
           (tokens_entered >= 5 AND win_rate < 0.10)
           OR (tokens_entered >= 10 AND COALESCE(tokens_won, 0) = 0)
           OR (tokens_entered >= 5 AND COALESCE(avg_peak_multiplier, 0) < 1.2)
           OR (tokens_entered >= 5 AND COALESCE(tokens_won, 0) < 3)
         )`
      );

      if (poorPerformers.rows.length === 0) {
        logger.info('No poor performers to remove');
        return;
      }

      logger.info(`Found ${poorPerformers.rows.length} poor performing wallets to remove`);

      for (const wallet of poorPerformers.rows) {
        // Mark as inactive (soft delete)
        await query(
          `UPDATE smart_wallets SET is_active = false, notes = $2, updated_at = NOW() WHERE address = $1`,
          [wallet.address, `Removed: ${wallet.reason}`]
        );

        // Remove from watchlist
        this.watchlist.delete(wallet.address);

        logger.info(`Removed wallet ${wallet.address.slice(0, 8)}...: ${wallet.reason}`);
      }

      logger.info(`✅ Removed ${poorPerformers.rows.length} poor performing wallets`);

    } catch (error: any) {
      logger.error('Error removing poor performers', { error: error.message });
    }
  }

  /**
   * Demote wallets whose recent performance is declining
   * Per CLAUDE.md: "Demote wallets whose performance is declining"
   */
  private async demoteDecliningWallets(): Promise<void> {
    try {
      // Find wallets where recent 7-day win rate is much lower than overall
      const declining = await query<{ address: string; current_tier: number }>(
        `SELECT sw.address, sw.tier as current_tier
         FROM smart_wallets sw
         WHERE sw.is_active = true
         AND sw.tier < 3
         AND EXISTS (
           SELECT 1 FROM wallet_discoveries wd
           WHERE wd.wallet_address = sw.address
           AND wd.entry_time > NOW() - INTERVAL '7 days'
           GROUP BY wd.wallet_address
           HAVING COUNT(*) FILTER (WHERE is_winner) * 1.0 / NULLIF(COUNT(*), 0) < sw.win_rate - 0.2
         )`
      );

      if (declining.rows.length === 0) {
        logger.debug('No wallets with declining performance');
        return;
      }

      for (const wallet of declining.rows) {
        const newTier = Math.min(3, wallet.current_tier + 1) as 1 | 2 | 3;
        await query(
          `UPDATE smart_wallets SET tier = $2, notes = 'Demoted: Performance declining', updated_at = NOW()
           WHERE address = $1`,
          [wallet.address, newTier]
        );

        // Also update in-memory watchlist
        const existing = this.watchlist.get(wallet.address);
        if (existing) {
          existing.tier = newTier;
          this.watchlist.set(wallet.address, existing);
        }

        logger.info(`Demoted wallet ${wallet.address.slice(0, 8)}... from Tier ${wallet.current_tier} to ${newTier}`);
      }

      logger.info(`✅ Demoted ${declining.rows.length} wallets with declining performance`);

    } catch (error: any) {
      logger.error('Error demoting declining wallets', { error: error.message });
    }
  }

  /**
   * Check for wallet rotation per CLAUDE.md Category 14:
   * "WALLET ROTATION: Every 2–4 weeks, find new alpha wallets, phase out crowded ones"
   *
   * Wallets older than 4 weeks are flagged for review. This doesn't auto-remove them
   * but alerts that fresh alpha discovery should be prioritized.
   */
  private async checkWalletRotation(): Promise<void> {
    try {
      // Find wallets that have been in the watchlist for more than 4 weeks
      const staleWallets = await query<{ address: string; tier: number; age_days: number }>(
        `SELECT address, tier,
                EXTRACT(DAY FROM NOW() - created_at)::INTEGER as age_days
         FROM smart_wallets
         WHERE is_active = true
         AND created_at < NOW() - INTERVAL '28 days'
         ORDER BY created_at ASC`
      );

      if (staleWallets.rows.length === 0) {
        logger.debug('No wallets due for rotation');
        return;
      }

      logger.warn(`⚠️ ROTATION ALERT: ${staleWallets.rows.length} wallets are older than 4 weeks`, {
        count: staleWallets.rows.length,
        wallets: staleWallets.rows.slice(0, 10).map(w => ({
          address: w.address.slice(0, 8) + '...',
          tier: w.tier,
          ageDays: w.age_days
        }))
      });

      // For wallets older than 6 weeks with poor recent performance, demote to Tier 3
      const veryStaleResult = await query<{ address: string }>(
        `SELECT sw.address
         FROM smart_wallets sw
         WHERE sw.is_active = true
         AND sw.tier < 3
         AND sw.created_at < NOW() - INTERVAL '42 days'
         AND NOT EXISTS (
           SELECT 1 FROM wallet_discoveries wd
           WHERE wd.wallet_address = sw.address
           AND wd.entry_time > NOW() - INTERVAL '14 days'
           AND wd.is_winner = true
         )`
      );

      if (veryStaleResult.rows.length > 0) {
        for (const wallet of veryStaleResult.rows) {
          await query(
            `UPDATE smart_wallets
             SET tier = 3, notes = 'Demoted: Stale wallet (>6 weeks, no recent wins)', updated_at = NOW()
             WHERE address = $1`,
            [wallet.address]
          );

          // Update in-memory watchlist
          const existing = this.watchlist.get(wallet.address);
          if (existing) {
            existing.tier = 3;
            this.watchlist.set(wallet.address, existing);
          }

          logger.info(`Demoted stale wallet ${wallet.address.slice(0, 8)}... to Tier 3 (>6 weeks old, no recent wins)`);
        }

        logger.info(`✅ Demoted ${veryStaleResult.rows.length} very stale wallets to Tier 3`);
      }

    } catch (error: any) {
      logger.error('Error checking wallet rotation', { error: error.message });
    }
  }

  /**
   * Keep only top 100 wallets by score, deactivate the rest
   */
  private async pruneToTopPerformers(): Promise<void> {
    try {
      // Get count of active wallets
      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM smart_wallets WHERE is_active = true`
      );

      const totalActive = parseInt(countResult.rows[0]?.count || '0');

      if (totalActive <= 100) {
        logger.debug(`Only ${totalActive} active wallets, no pruning needed`);
        return;
      }

      // Deactivate wallets outside top 100 by score
      await query(
        `UPDATE smart_wallets
         SET is_active = false, notes = 'Pruned: Outside top 100', updated_at = NOW()
         WHERE address IN (
           SELECT address FROM smart_wallets
           WHERE is_active = true
           ORDER BY score DESC
           OFFSET 100
         )`
      );

      const prunedCount = totalActive - 100;
      logger.info(`Pruned ${prunedCount} wallets to keep top 100 performers`);

    } catch (error: any) {
      logger.error('Error pruning to top performers', { error: error.message });
    }
  }

  /**
   * Get current watchlist
   */
  getWatchlist(): SmartWallet[] {
    return Array.from(this.watchlist.values());
  }

  /**
   * Get wallets by tier
   */
  getWalletsByTier(tier: 1 | 2 | 3): SmartWallet[] {
    return this.getWatchlist().filter(w => w.tier === tier);
  }

  /**
   * Check if a wallet is on the watchlist
   */
  isWatching(address: string): boolean {
    return this.watchlist.has(address);
  }

  /**
   * Record a wallet signal (wallet entered a token)
   */
  async recordWalletSignal(walletAddress: string, _tokenAddress: string): Promise<void> {
    if (!this.walletStats.has(walletAddress)) {
      // Memory protection: enforce limits before adding new entries
      if (this.walletStats.size >= this.MAX_WALLET_STATS) {
        this.enforceMemoryLimits();
      }

      this.walletStats.set(walletAddress, {
        address: walletAddress,
        signalsGenerated: 0,
        tradesEntered: 0,
        tradesWon: 0,
        avgTimeToMove: 0,
        isCrowded: false,
        isBurned: false
      });
    }

    const stats = this.walletStats.get(walletAddress)!;
    stats.signalsGenerated++;

    this.walletStats.set(walletAddress, stats);

    // Save to database
    await this.saveWalletStats(walletAddress);
  }

  /**
   * Record trade outcome for wallet signal
   */
  async recordTradeOutcome(
    walletAddress: string,
    entered: boolean,
    won: boolean
  ): Promise<void> {
    const stats = this.walletStats.get(walletAddress);
    if (!stats) return;

    if (entered) {
      stats.tradesEntered++;
      if (won) {
        stats.tradesWon++;
      }
    }

    this.walletStats.set(walletAddress, stats);
    await this.saveWalletStats(walletAddress);
  }

  /**
   * Get wallet effectiveness metrics
   */
  getWalletEffectiveness(address: string): WalletStats | null {
    return this.walletStats.get(address) || null;
  }

  /**
   * Load watchlist from database
   */
  private async loadWatchlist(): Promise<void> {
    try {
      const result = await query(`
        SELECT address, tier, score, win_rate, average_return,
               tokens_entered, last_active, total_trades, successful_trades, average_hold_time
        FROM smart_wallets
        WHERE last_active > NOW() - INTERVAL '7 days'
        AND is_active = true
        ORDER BY score DESC
        LIMIT 100
      `);

      for (const row of result.rows) {
        const wallet: SmartWallet = {
          address: row.address,
          tier: row.tier,
          score: row.score,
          winRate: row.win_rate,
          averageReturn: row.average_return,
          tokensEntered: row.tokens_entered,
          lastActive: new Date(row.last_active),
          metrics: {
            totalTrades: row.total_trades || 0,
            successfulTrades: row.successful_trades || 0,
            averageHoldTime: row.average_hold_time || 0
          }
        };

        this.watchlist.set(wallet.address, wallet);
      }

      logger.info(`Loaded ${this.watchlist.size} wallets from database`);

    } catch (error: any) {
      logger.error('Error loading watchlist', { error: error.message });
    }
  }

  /**
   * Load wallet stats from database
   */
  private async loadWalletStats(): Promise<void> {
    try {
      const result = await query(`
        SELECT wallet_address, signals_generated, trades_entered,
               trades_won, avg_time_to_move, is_crowded, is_burned
        FROM wallet_stats
      `);

      for (const row of result.rows) {
        this.walletStats.set(row.wallet_address, {
          address: row.wallet_address,
          signalsGenerated: row.signals_generated,
          tradesEntered: row.trades_entered,
          tradesWon: row.trades_won,
          avgTimeToMove: row.avg_time_to_move,
          isCrowded: row.is_crowded,
          isBurned: row.is_burned
        });
      }

      logger.debug(`Loaded stats for ${this.walletStats.size} wallets`);

    } catch (error: any) {
      logger.error('Error loading wallet stats', { error: error.message });
    }
  }

  /**
   * Detect burned wallets (being front-run)
   */
  private async detectBurnedWallets(): Promise<void> {
    for (const [address, stats] of this.walletStats.entries()) {
      // Check if wallet is being front-run
      // If avg time-to-move is shrinking, others are copying this wallet
      // If trade entry rate is declining, wallet is crowded

      if (stats.signalsGenerated > 5) {
        const entryRate = stats.tradesEntered / stats.signalsGenerated;

        // If entry rate < 50%, wallet might be crowded (we're getting beaten)
        if (entryRate < 0.5) {
          stats.isCrowded = true;
          logger.warn(`Wallet ${address.slice(0, 8)}... marked as CROWDED (entry rate: ${(entryRate * 100).toFixed(1)}%)`);
        }

        // If entry rate < 20%, wallet is burned
        if (entryRate < 0.2) {
          stats.isBurned = true;
          logger.warn(`Wallet ${address.slice(0, 8)}... marked as BURNED (entry rate: ${(entryRate * 100).toFixed(1)}%)`);
        }
      }

      this.walletStats.set(address, stats);
    }

    // Remove burned wallets from watchlist
    for (const [address, stats] of this.walletStats.entries()) {
      if (stats.isBurned && this.watchlist.has(address)) {
        logger.info(`Removing burned wallet ${address.slice(0, 8)}... from watchlist`);
        this.watchlist.delete(address);

        // Mark as inactive in database
        await query(`
          UPDATE smart_wallets
          SET is_active = false, updated_at = NOW()
          WHERE address = $1
        `, [address]);
      }
    }
  }

  /**
   * Update watchlist with newly scored wallets
   */
  private async updateWatchlist(scoredWallets: SmartWallet[]): Promise<void> {
    // Filter out burned wallets
    const cleanWallets = scoredWallets.filter(w => {
      const stats = this.walletStats.get(w.address);
      return !stats || !stats.isBurned;
    });

    // Keep top 100 wallets
    const topWallets = cleanWallets.slice(0, 100);

    // Clear and rebuild watchlist
    this.watchlist.clear();
    for (const wallet of topWallets) {
      this.watchlist.set(wallet.address, wallet);
    }

    logger.info(`Watchlist updated with ${this.watchlist.size} wallets`);
  }

  /**
   * Remove inactive wallets (> 7 days)
   */
  private async removeInactiveWallets(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const toRemove: string[] = [];

    for (const [address, wallet] of this.watchlist.entries()) {
      if (wallet.lastActive < sevenDaysAgo) {
        toRemove.push(address);
      }
    }

    for (const address of toRemove) {
      this.watchlist.delete(address);
      logger.info(`Removed inactive wallet ${address.slice(0, 8)}...`);
    }

    if (toRemove.length > 0) {
      logger.info(`Removed ${toRemove.length} inactive wallets`);
    }
  }

  /**
   * Save wallet stats to database
   */
  private async saveWalletStats(address: string): Promise<void> {
    try {
      const stats = this.walletStats.get(address);
      if (!stats) return;

      await query(`
        INSERT INTO wallet_stats (
          wallet_address, signals_generated, trades_entered,
          trades_won, avg_time_to_move, is_crowded, is_burned, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (wallet_address)
        DO UPDATE SET
          signals_generated = $2,
          trades_entered = $3,
          trades_won = $4,
          avg_time_to_move = $5,
          is_crowded = $6,
          is_burned = $7,
          updated_at = NOW()
      `, [
        stats.address,
        stats.signalsGenerated,
        stats.tradesEntered,
        stats.tradesWon,
        stats.avgTimeToMove,
        stats.isCrowded,
        stats.isBurned
      ]);

    } catch (error: any) {
      logger.debug('Error saving wallet stats', { error: error.message });
    }
  }

  /**
   * Get count of wallets in a tier
   */
  private getTierCount(tier: 1 | 2 | 3): number {
    return Array.from(this.watchlist.values()).filter(w => w.tier === tier).length;
  }

  /**
   * Get wallet info
   */
  getWallet(address: string): SmartWallet | null {
    return this.watchlist.get(address) || null;
  }
}
