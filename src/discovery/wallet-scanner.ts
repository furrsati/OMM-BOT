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
import { query } from '../db/postgres';

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
   * Uses DexScreener API to find trending Solana tokens and filter
   * for those that achieved significant gains from launch.
   */
  private async findWinningTokens(): Promise<TokenPerformance[]> {
    logger.info('🔍 Scanning for winning tokens via DexScreener...');

    const winningTokens: TokenPerformance[] = [];

    try {
      // Fetch trending tokens from DexScreener
      const trendingResponse = await this.fetchWithRetry(
        'https://api.dexscreener.com/token-boosts/top/v1',
        { timeout: 15000 }
      );

      if (!trendingResponse.ok) {
        logger.warn('DexScreener trending API failed, trying search API');
        return await this.findWinningTokensViaSearch();
      }

      const trendingData = await trendingResponse.json() as any[];

      // Filter for Solana tokens
      const solanaTrending = (Array.isArray(trendingData) ? trendingData : []).filter(
        (t: any) => t.chainId === 'solana'
      ).slice(0, 50); // Limit to top 50

      logger.info(`Found ${solanaTrending.length} trending Solana tokens`);

      // For each trending token, get detailed price data
      for (const token of solanaTrending) {
        try {
          const tokenData = await this.getTokenPerformance(token.tokenAddress);
          if (tokenData && tokenData.multiplier >= 5 && tokenData.multiplier <= 50) {
            winningTokens.push(tokenData);
            logger.debug(`Found winning token: ${token.tokenAddress.slice(0, 8)}... (${tokenData.multiplier.toFixed(1)}x)`);
          }
        } catch (error: any) {
          logger.debug(`Error fetching token ${token.tokenAddress}: ${error.message}`);
        }

        // Rate limit: 300ms between requests
        await this.sleep(300);
      }

      // Also check recent token profiles
      const profilesResponse = await this.fetchWithRetry(
        'https://api.dexscreener.com/token-profiles/latest/v1',
        { timeout: 15000 }
      );

      if (profilesResponse.ok) {
        const profilesData = await profilesResponse.json() as any[];
        const solanaProfiles = (Array.isArray(profilesData) ? profilesData : []).filter(
          (t: any) => t.chainId === 'solana'
        ).slice(0, 30);

        for (const token of solanaProfiles) {
          try {
            // Skip if already processed
            if (winningTokens.some(w => w.address === token.tokenAddress)) continue;

            const tokenData = await this.getTokenPerformance(token.tokenAddress);
            if (tokenData && tokenData.multiplier >= 5 && tokenData.multiplier <= 50) {
              winningTokens.push(tokenData);
            }
          } catch (error: any) {
            logger.debug(`Error fetching token profile ${token.tokenAddress}: ${error.message}`);
          }

          await this.sleep(300);
        }
      }

      logger.info(`✅ Found ${winningTokens.length} winning tokens (5x-50x gains)`);

      return winningTokens;

    } catch (error: any) {
      logger.error('Error finding winning tokens', { error: error.message });
      return [];
    }
  }

  /**
   * Alternative method to find winning tokens via search
   */
  private async findWinningTokensViaSearch(): Promise<TokenPerformance[]> {
    const winningTokens: TokenPerformance[] = [];

    try {
      // Search for recent Solana pairs
      const searchResponse = await this.fetchWithRetry(
        'https://api.dexscreener.com/latest/dex/search?q=SOL',
        { timeout: 15000 }
      );

      if (!searchResponse.ok) return [];

      const searchData = await searchResponse.json() as { pairs?: any[] };
      const pairs = (searchData.pairs || []).filter(
        (p: any) => p.chainId === 'solana' && p.dexId === 'raydium'
      ).slice(0, 50);

      for (const pair of pairs) {
        try {
          const tokenData = await this.getTokenPerformanceFromPair(pair);
          if (tokenData && tokenData.multiplier >= 5 && tokenData.multiplier <= 50) {
            winningTokens.push(tokenData);
          }
        } catch (error: any) {
          logger.debug(`Error processing pair: ${error.message}`);
        }

        await this.sleep(300);
      }

      return winningTokens;
    } catch (error: any) {
      logger.error('Error in search-based token finding', { error: error.message });
      return [];
    }
  }

  /**
   * Get token performance data from DexScreener
   */
  private async getTokenPerformance(tokenAddress: string): Promise<TokenPerformance | null> {
    try {
      const response = await this.fetchWithRetry(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { timeout: 10000 }
      );

      if (!response.ok) return null;

      const data = await response.json() as { pairs?: any[] };
      const pairs = data.pairs || [];

      // Find the main SOL pair (usually first)
      const mainPair = pairs.find((p: any) =>
        p.chainId === 'solana' && p.quoteToken?.symbol === 'SOL'
      ) || pairs[0];

      if (!mainPair) return null;

      // Calculate performance metrics
      const priceChange24h = parseFloat(mainPair.priceChange?.h24 || '0');
      const currentPrice = parseFloat(mainPair.priceUsd || '0');

      // Estimate launch price from 24h change (rough approximation)
      // For more accurate data, we'd need historical price API
      const priceMultiplier24h = 1 + (priceChange24h / 100);

      // Check if this looks like a recent winner
      // Use creation timestamp if available
      const pairCreatedAt = mainPair.pairCreatedAt || Date.now();
      const ageInDays = (Date.now() - pairCreatedAt) / (1000 * 60 * 60 * 24);

      // Only consider tokens less than 7 days old with significant gains
      if (ageInDays > 7) return null;

      // Estimate multiplier from available data
      // DexScreener provides priceChange for various periods
      const priceChange6h = parseFloat(mainPair.priceChange?.h6 || '0');
      const priceChange1h = parseFloat(mainPair.priceChange?.h1 || '0');

      // Rough multiplier estimation
      let estimatedMultiplier = 1;
      if (priceChange24h > 0) {
        estimatedMultiplier = Math.max(estimatedMultiplier, priceMultiplier24h);
      }

      // If we have FDV and initial supply data, calculate more accurately
      const fdv = parseFloat(mainPair.fdv || '0');
      const liquidity = parseFloat(mainPair.liquidity?.usd || '0');

      // Heuristic: high FDV/liquidity ratio often indicates significant gains
      if (fdv > 0 && liquidity > 0) {
        const fdvToLiquidityRatio = fdv / liquidity;
        if (fdvToLiquidityRatio > 10) {
          estimatedMultiplier = Math.max(estimatedMultiplier, Math.sqrt(fdvToLiquidityRatio));
        }
      }

      // Filter: only return if multiplier is in target range
      if (estimatedMultiplier < 5 || estimatedMultiplier > 50) {
        return null;
      }

      const launchPrice = currentPrice / estimatedMultiplier;

      return {
        address: tokenAddress,
        launchTime: Math.floor(pairCreatedAt / 1000),
        launchPrice,
        peakPrice: currentPrice,
        multiplier: estimatedMultiplier
      };
    } catch (error: any) {
      logger.debug(`Error getting token performance for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get token performance from a pair object
   */
  private getTokenPerformanceFromPair(pair: any): TokenPerformance | null {
    try {
      const priceChange24h = parseFloat(pair.priceChange?.h24 || '0');
      const currentPrice = parseFloat(pair.priceUsd || '0');
      const pairCreatedAt = pair.pairCreatedAt || Date.now();

      const ageInDays = (Date.now() - pairCreatedAt) / (1000 * 60 * 60 * 24);
      if (ageInDays > 7) return null;

      const priceMultiplier = 1 + (priceChange24h / 100);
      if (priceMultiplier < 5 || priceMultiplier > 50) return null;

      return {
        address: pair.baseToken?.address || '',
        launchTime: Math.floor(pairCreatedAt / 1000),
        launchPrice: currentPrice / priceMultiplier,
        peakPrice: currentPrice,
        multiplier: priceMultiplier
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch with retry and timeout
   */
  private async fetchWithRetry(
    url: string,
    options: { timeout?: number; retries?: number } = {}
  ): Promise<Response> {
    const { timeout = 10000, retries = 3 } = options;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'OMM-Bot/1.0'
          }
        });

        clearTimeout(timeoutId);
        return response;
      } catch (error: any) {
        if (attempt === retries) {
          throw error;
        }
        logger.debug(`Fetch attempt ${attempt} failed, retrying...`);
        await this.sleep(1000 * attempt);
      }
    }

    throw new Error('Max retries exceeded');
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
        { limit: 100 },
        'confirmed'
      );

      if (signatures.length < 10) return false; // Not enough data

      let quickSellCount = 0;
      let totalTrades = 0;
      let sandwichPatterns = 0;
      let frontrunPatterns = 0;
      let atomicArbPatterns = 0;

      // Track buy/sell pairs for quick sell detection
      const tokenBuys: Map<string, number> = new Map(); // token -> buyTime
      const slotCounts: Map<number, number> = new Map(); // slot -> txCount

      // Analyze transaction patterns
      for (const sig of signatures.slice(0, 50)) {
        const tx = await this.connection.getParsedTransaction(
          sig.signature,
          { maxSupportedTransactionVersion: 0 }
        );

        if (!tx || !tx.meta) continue;

        const slot = tx.slot;
        slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);

        // Check for atomic arbitrage (multiple DEX interactions in one tx)
        const innerInstructions = tx.meta.innerInstructions || [];
        const programIds = new Set<string>();

        for (const inner of innerInstructions) {
          for (const instruction of inner.instructions) {
            if ('programId' in instruction) {
              programIds.add(instruction.programId.toBase58());
            }
          }
        }

        // Known DEX program IDs
        const dexPrograms = [
          '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
          'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpools
          'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
        ];

        const dexInteractions = dexPrograms.filter(p => programIds.has(p)).length;
        if (dexInteractions >= 2) {
          atomicArbPatterns++;
        }

        // Check token balance changes for buy/sell detection
        const preBalances = tx.meta.preTokenBalances || [];
        const postBalances = tx.meta.postTokenBalances || [];

        for (const post of postBalances) {
          if (!post.mint || !post.owner) continue;

          const pre = preBalances.find(
            p => p.accountIndex === post.accountIndex
          );

          const preAmount = parseInt(pre?.uiTokenAmount?.amount || '0');
          const postAmount = parseInt(post.uiTokenAmount?.amount || '0');

          if (postAmount > preAmount) {
            // Buy detected
            tokenBuys.set(post.mint, sig.blockTime || Date.now() / 1000);
          } else if (preAmount > postAmount && sig.blockTime) {
            // Sell detected - check if quick sell
            const buyTime = tokenBuys.get(post.mint);
            if (buyTime && (sig.blockTime - buyTime) < 300) { // < 5 minutes
              quickSellCount++;
            }
          }
        }

        totalTrades++;
      }

      // Detect sandwich attack pattern: multiple txs in same slot
      for (const [, count] of slotCounts) {
        if (count >= 2) {
          sandwichPatterns++;
        }
      }

      // Detect frontrunning: consistently enters 1-2 slots before large trades
      // Check for abnormally high frequency trading
      const avgTxPerSlot = signatures.length / slotCounts.size;
      if (avgTxPerSlot > 1.5) {
        frontrunPatterns = Math.floor(avgTxPerSlot);
      }

      // If more than 80% are quick sells, likely a dump bot
      const quickSellRate = quickSellCount / Math.max(totalTrades, 1);
      if (quickSellRate > 0.8) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... identified as dump bot (${(quickSellRate * 100).toFixed(0)}% quick sells)`);
        return true;
      }

      // If atomic arbitrage pattern detected frequently
      if (atomicArbPatterns >= 3) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... identified as atomic arb bot (${atomicArbPatterns} patterns)`);
        return true;
      }

      // If sandwich patterns detected
      if (sandwichPatterns >= 5) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... identified as sandwich bot (${sandwichPatterns} patterns)`);
        return true;
      }

      // If high frequency trading pattern
      if (frontrunPatterns >= 3 && totalTrades > 30) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... identified as frontrun bot (${frontrunPatterns} avg tx/slot)`);
        return true;
      }

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
      for (const buyer of buyers) {
        // Check if wallet already exists in smart_wallets table
        const existingResult = await query<{ address: string; tokens_entered: number }>(
          `SELECT address, tokens_entered FROM smart_wallets WHERE address = $1`,
          [buyer.walletAddress]
        );

        if (existingResult.rows.length > 0) {
          // Update existing wallet - increment tokens count and update last active
          await query(
            `UPDATE smart_wallets
             SET tokens_entered = tokens_entered + 1,
                 last_active = NOW(),
                 updated_at = NOW()
             WHERE address = $1`,
            [buyer.walletAddress]
          );
        } else {
          // Insert new wallet as Tier 3 (unproven, needs scoring)
          await query(
            `INSERT INTO smart_wallets
             (address, tier, score, win_rate, average_return, tokens_entered, last_active, total_trades, successful_trades, average_hold_time, is_active)
             VALUES ($1, 3, 0, 0, 0, 1, NOW(), 0, 0, 0, true)
             ON CONFLICT (address) DO UPDATE
             SET tokens_entered = smart_wallets.tokens_entered + 1,
                 last_active = NOW(),
                 updated_at = NOW()`,
            [buyer.walletAddress]
          );
        }

        // Also cache the discovery event for later analysis
        await query(
          `INSERT INTO cache (key, value, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '30 days')
           ON CONFLICT (key) DO UPDATE
           SET value = $2, expires_at = NOW() + INTERVAL '30 days'`,
          [
            `alpha_discovery:${buyer.walletAddress}:${buyer.tokenAddress}`,
            JSON.stringify({
              walletAddress: buyer.walletAddress,
              tokenAddress: buyer.tokenAddress,
              buyTime: buyer.buyTime,
              secondsAfterLaunch: buyer.secondsAfterLaunch,
              discoveredAt: Date.now()
            })
          ]
        );
      }

      logger.info(`✅ Cached ${buyers.length} alpha wallets to database`);

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
