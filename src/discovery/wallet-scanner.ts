/**
 * Smart Wallet Scanner
 *
 * Discovers alpha wallets by:
 * 1. Scanning for tokens that achieved 5×–50× gains
 * 2. Identifying wallets that bought within first 5 minutes
 * 3. Removing deployer-connected wallets (2-hop on-chain analysis)
 * 4. Filtering out MEV bots, dump bots, and insider wallets
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { logger } from '../utils/logger';

interface TokenPerformance {
  address: string;
  launchTime: number;
  peakPrice: number;
  launchPrice: number;
  multiplier: number;
}

interface EarlyBuyer {
  walletAddress: string;
  tokenAddress: string;
  buyTime: number;
  buyPrice: number;
  secondsAfterLaunch: number;
}

interface WalletConnectionGraph {
  wallet: string;
  connectedTo: Set<string>;
  depth: number;
}

export class WalletScanner {
  private connection: Connection;
  private scanningActive: boolean = false;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Start continuous scanning for winning tokens and their early buyers
   */
  async startScanning(): Promise<void> {
    if (this.scanningActive) {
      logger.warn('Wallet scanner already active');
      return;
    }

    this.scanningActive = true;
    logger.info('🔍 Starting wallet scanner...');

    // Run scan every 6 hours
    const scanInterval = 6 * 60 * 60 * 1000; // 6 hours

    while (this.scanningActive) {
      try {
        await this.runScanCycle();
        await this.sleep(scanInterval);
      } catch (error: any) {
        logger.error('Error in wallet scan cycle', { error: error.message });
        await this.sleep(60000); // Wait 1 minute on error
      }
    }
  }

  /**
   * Stop scanning
   */
  stopScanning(): void {
    this.scanningActive = false;
    logger.info('Wallet scanner stopped');
  }

  /**
   * Run a complete scan cycle
   */
  private async runScanCycle(): Promise<void> {
    logger.info('🔍 Starting wallet scan cycle...');

    try {
      // Step 1: Find winning tokens (5×–50× in last 7 days)
      const winningTokens = await this.findWinningTokens();
      logger.info(`Found ${winningTokens.length} winning tokens`);

      if (winningTokens.length === 0) {
        logger.info('No winning tokens found in this cycle');
        return;
      }

      // Step 2: For each winning token, find early buyers
      let totalEarlyBuyers = 0;
      for (const token of winningTokens) {
        const earlyBuyers = await this.findEarlyBuyers(token);
        totalEarlyBuyers += earlyBuyers.length;

        // Step 3: Filter out deployer-connected wallets
        const cleanBuyers = await this.filterDeployerConnectedWallets(
          earlyBuyers,
          token.address
        );

        logger.info(`Token ${token.address.slice(0, 8)}... - ${cleanBuyers.length}/${earlyBuyers.length} clean early buyers`);

        // Step 4: Filter out MEV bots and dump bots
        const alphaBuyers = await this.filterBotWallets(cleanBuyers);

        // Step 5: Cache alpha wallets for scoring
        await this.cacheAlphaWallets(alphaBuyers);
      }

      logger.info(`✅ Scan cycle complete - ${totalEarlyBuyers} early buyers found`);

    } catch (error: any) {
      logger.error('Error in scan cycle', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Find tokens that achieved 5×–50× gains in last 7 days
   *
   * NOTE: This is a STUB implementation. In production, this would:
   * - Query a price data service (Birdeye, Jupiter, etc.)
   * - Track historical price data from own database
   * - Use DEX aggregator APIs
   *
   * For now, returns empty array (will be populated when price feeds are built)
   */
  private async findWinningTokens(): Promise<TokenPerformance[]> {
    logger.debug('Scanning for winning tokens (STUB - needs price data integration)');

    // STUB: In production, query price data service or database
    // Example query:
    // SELECT token_address, launch_time, launch_price, peak_price
    // FROM token_prices
    // WHERE (peak_price / launch_price) BETWEEN 5 AND 50
    // AND launch_time > NOW() - INTERVAL '7 days'

    // REDIS REMOVED - caching disabled
    // const cached = await this.redis.get('winning_tokens_cache');
    // if (cached) {
    //   return JSON.parse(cached);
    // }

    // For now, return empty (Phase 2 will connect to price feeds)
    return [];
  }

  /**
   * Find wallets that bought within first 5 minutes of token launch
   */
  private async findEarlyBuyers(token: TokenPerformance): Promise<EarlyBuyer[]> {
    logger.debug(`Finding early buyers for ${token.address.slice(0, 8)}...`);

    try {
      const tokenPubkey = new PublicKey(token.address);
      const earlyBuyers: EarlyBuyer[] = [];

      // Get signatures for token account from launch to 5 minutes after
      const launchTime = token.launchTime;
      // const fiveMinutesAfter = launchTime + (5 * 60); // TODO: Use this for time filtering

      // Fetch transaction signatures
      const signatures = await this.connection.getSignaturesForAddress(
        tokenPubkey,
        { limit: 1000 },
        'confirmed'
      );

      // Filter to first 5 minutes and parse transactions
      for (const sig of signatures) {
        if (!sig.blockTime) continue;

        const secondsAfterLaunch = sig.blockTime - launchTime;

        if (secondsAfterLaunch > 300) continue; // More than 5 minutes
        if (secondsAfterLaunch < 0) continue; // Before launch

        // Get transaction details
        const tx = await this.connection.getParsedTransaction(
          sig.signature,
          { maxSupportedTransactionVersion: 0 }
        );

        if (!tx || !tx.meta || tx.meta.err) continue;

        // Extract buyers (wallets that received tokens)
        const buyers = this.extractBuyersFromTransaction(tx, token.address);

        for (const buyer of buyers) {
          earlyBuyers.push({
            walletAddress: buyer,
            tokenAddress: token.address,
            buyTime: sig.blockTime,
            buyPrice: token.launchPrice, // Approximate
            secondsAfterLaunch
          });
        }
      }

      return earlyBuyers;

    } catch (error: any) {
      logger.error('Error finding early buyers', {
        token: token.address,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Extract buyer wallet addresses from transaction
   */
  private extractBuyersFromTransaction(
    tx: ParsedTransactionWithMeta,
    tokenAddress: string
  ): string[] {
    const buyers: string[] = [];

    try {
      // Look through post-token balances to find wallets that gained tokens
      const postBalances = tx.meta?.postTokenBalances || [];
      const preBalances = tx.meta?.preTokenBalances || [];

      for (const postBalance of postBalances) {
        if (postBalance.mint !== tokenAddress) continue;

        const preBalance = preBalances.find(
          pre => pre.accountIndex === postBalance.accountIndex
        );

        const preAmount = preBalance?.uiTokenAmount.uiAmount || 0;
        const postAmount = postBalance.uiTokenAmount.uiAmount || 0;

        // If balance increased, this wallet bought
        if (postAmount > preAmount) {
          const owner = postBalance.owner;
          if (owner && !buyers.includes(owner)) {
            buyers.push(owner);
          }
        }
      }
    } catch (error: any) {
      logger.debug('Error extracting buyers from transaction', { error: error.message });
    }

    return buyers;
  }

  /**
   * Filter out wallets connected to token deployer (2-hop analysis)
   *
   * Removes wallets that:
   * - Are the deployer
   * - Received SOL/tokens from deployer
   * - Received from wallets funded by deployer
   */
  private async filterDeployerConnectedWallets(
    buyers: EarlyBuyer[],
    tokenAddress: string
  ): Promise<EarlyBuyer[]> {
    logger.debug(`Filtering deployer-connected wallets (${buyers.length} buyers)`);

    try {
      // Get token deployer address
      const deployer = await this.getTokenDeployer(tokenAddress);
      if (!deployer) {
        logger.warn('Could not identify deployer, skipping deployer filter');
        return buyers;
      }

      // Build connection graph (2 hops deep)
      const connectionGraph = await this.buildConnectionGraph(deployer, 2);

      // Filter out connected wallets
      const cleanBuyers = buyers.filter(buyer => {
        return !connectionGraph.has(buyer.walletAddress);
      });

      const removedCount = buyers.length - cleanBuyers.length;
      if (removedCount > 0) {
        logger.info(`Removed ${removedCount} deployer-connected wallets`);
      }

      return cleanBuyers;

    } catch (error: any) {
      logger.error('Error filtering deployer connections', { error: error.message });
      return buyers; // Return all on error (fail safe)
    }
  }

  /**
   * Get the deployer address for a token
   */
  private async getTokenDeployer(tokenAddress: string): Promise<string | null> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);

      // Get token account creation signature
      const signatures = await this.connection.getSignaturesForAddress(
        tokenPubkey,
        { limit: 1000 },
        'confirmed'
      );

      if (signatures.length === 0) return null;

      // Oldest signature is likely the creation transaction
      const creationSig = signatures[signatures.length - 1];
      const tx = await this.connection.getParsedTransaction(
        creationSig.signature,
        { maxSupportedTransactionVersion: 0 }
      );

      if (!tx) return null;

      // The fee payer is typically the deployer
      return tx.transaction.message.accountKeys[0].pubkey.toBase58();

    } catch (error: any) {
      logger.debug('Error getting token deployer', { error: error.message });
      return null;
    }
  }

  /**
   * Build connection graph from a wallet (N hops deep)
   */
  private async buildConnectionGraph(
    rootWallet: string,
    maxDepth: number
  ): Promise<Set<string>> {
    const connected = new Set<string>();
    const queue: WalletConnectionGraph[] = [
      { wallet: rootWallet, connectedTo: new Set(), depth: 0 }
    ];

    connected.add(rootWallet);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth >= maxDepth) continue;

      // Get wallets this wallet has sent SOL/tokens to
      const recipients = await this.getWalletRecipients(current.wallet);

      for (const recipient of recipients) {
        if (!connected.has(recipient)) {
          connected.add(recipient);
          queue.push({
            wallet: recipient,
            connectedTo: new Set([current.wallet]),
            depth: current.depth + 1
          });
        }
      }
    }

    return connected;
  }

  /**
   * Get wallets that received SOL/tokens from a wallet
   */
  private async getWalletRecipients(walletAddress: string): Promise<string[]> {
    try {
      const pubkey = new PublicKey(walletAddress);
      const recipients = new Set<string>();

      // Get recent signatures (limit to avoid rate limits)
      const signatures = await this.connection.getSignaturesForAddress(
        pubkey,
        { limit: 100 },
        'confirmed'
      );

      for (const sig of signatures.slice(0, 20)) { // Check only first 20
        const tx = await this.connection.getParsedTransaction(
          sig.signature,
          { maxSupportedTransactionVersion: 0 }
        );

        if (!tx || !tx.meta) continue;

        // Check post-balances for recipients
        const accountKeys = tx.transaction.message.accountKeys;
        const preBalances = tx.meta.preBalances;
        const postBalances = tx.meta.postBalances;

        for (let i = 0; i < accountKeys.length; i++) {
          const recipient = accountKeys[i].pubkey.toBase58();
          if (recipient === walletAddress) continue;

          // If balance increased, they received SOL
          if (postBalances[i] > preBalances[i]) {
            recipients.add(recipient);
          }
        }
      }

      return Array.from(recipients);

    } catch (error: any) {
      logger.debug('Error getting wallet recipients', { error: error.message });
      return [];
    }
  }

  /**
   * Filter out MEV bots and dump bots
   */
  private async filterBotWallets(buyers: EarlyBuyer[]): Promise<EarlyBuyer[]> {
    logger.debug(`Filtering bot wallets (${buyers.length} buyers)`);

    const cleanBuyers: EarlyBuyer[] = [];

    for (const buyer of buyers) {
      // Check if wallet exhibits bot behavior
      const isBot = await this.isBotWallet(buyer.walletAddress);

      if (!isBot) {
        cleanBuyers.push(buyer);
      }
    }

    const removedCount = buyers.length - cleanBuyers.length;
    if (removedCount > 0) {
      logger.info(`Removed ${removedCount} bot wallets`);
    }

    return cleanBuyers;
  }

  /**
   * Check if wallet exhibits bot behavior
   */
  private async isBotWallet(walletAddress: string): Promise<boolean> {
    try {
      const pubkey = new PublicKey(walletAddress);

      // Get recent transaction history
      const signatures = await this.connection.getSignaturesForAddress(
        pubkey,
        { limit: 50 },
        'confirmed'
      );

      if (signatures.length < 10) return false; // Not enough data

      const quickSellCount = 0;
      let totalTrades = 0;

      // Analyze transaction patterns
      for (const sig of signatures.slice(0, 20)) {
        const tx = await this.connection.getParsedTransaction(
          sig.signature,
          { maxSupportedTransactionVersion: 0 }
        );

        if (!tx || !tx.meta) continue;

        // Look for quick buy-sell patterns (< 5 minutes)
        // This is a simplified heuristic
        totalTrades++;
      }

      // If more than 80% are quick sells, likely a dump bot
      const quickSellRate = quickSellCount / Math.max(totalTrades, 1);
      if (quickSellRate > 0.8) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... identified as dump bot`);
        return true;
      }

      // TODO: Add MEV pattern detection (sandwich attacks, frontrunning)

      return false;

    } catch (error: any) {
      logger.debug('Error checking bot wallet', { error: error.message });
      return false; // Assume not bot on error
    }
  }

  /**
   * Cache discovered alpha wallets for scoring
   */
  private async cacheAlphaWallets(buyers: EarlyBuyer[]): Promise<void> {
    try {
      // REDIS REMOVED - caching disabled
      // for (const buyer of buyers) {
      //   const key = `alpha_wallet:${buyer.walletAddress}`;

      //   // Get existing data
      //   const existing = await this.redis.get(key);
      //   const data = existing ? JSON.parse(existing) : {
      //     address: buyer.walletAddress,
      //     tokens: [],
      //     lastUpdated: Date.now()
      //   };

      //   // Add this token to their history
      //   if (!data.tokens.includes(buyer.tokenAddress)) {
      //     data.tokens.push(buyer.tokenAddress);
      //   }

      //   data.lastUpdated = Date.now();

      //   // Cache for 30 days
      //   await this.redis.setEx(key, 30 * 24 * 60 * 60, JSON.stringify(data));
      // }

      logger.debug(`Would cache ${buyers.length} alpha wallets (Redis disabled)`);

    } catch (error: any) {
      logger.error('Error caching alpha wallets', { error: error.message });
    }
  }

  /**
   * Helper: Sleep for ms
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
