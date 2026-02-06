/**
 * Smart Wallet Scanner
 *
 * Discovers alpha wallets by:
 * 1. Scanning for tokens that achieved 5×–50× gains
 * 2. Identifying wallets that bought within first 5 minutes
 * 3. Removing deployer-connected wallets (2-hop on-chain analysis)
 * 4. Filtering out MEV bots, dump bots, and insider wallets
 *
 * FIXED: Now properly queries DEX pools and parses swap transactions
 * instead of incorrectly querying token mint addresses.
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { query } from '../db/postgres';
import { rateLimitedRPC } from '../utils/rate-limiter';

interface TokenPerformance {
  address: string;
  launchTime: number;
  peakPrice: number;
  launchPrice: number;
  multiplier: number;
  pairAddress?: string; // DEX pool address for querying transactions
  dexId?: string;
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

// Known DEX program IDs for Solana
const DEX_PROGRAMS = {
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  PUMP_FUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
};

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
      // Process only top 10 tokens to avoid excessive RPC usage
      let totalEarlyBuyers = 0;
      const tokensToProcess = winningTokens.slice(0, 10);
      logger.info(`Processing ${tokensToProcess.length} of ${winningTokens.length} winning tokens`);

      for (const token of tokensToProcess) {
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

        // Add delay between tokens to give RPC a break
        await this.sleep(2000);
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
   * IMPROVED: Now also captures pair address for transaction querying
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

      // Find the main SOL pair (usually first, prefer Raydium)
      const mainPair = pairs.find((p: any) =>
        p.chainId === 'solana' &&
        p.quoteToken?.symbol === 'SOL' &&
        (p.dexId === 'raydium' || p.dexId === 'orca')
      ) || pairs.find((p: any) =>
        p.chainId === 'solana' && p.quoteToken?.symbol === 'SOL'
      ) || pairs[0];

      if (!mainPair) return null;

      // Calculate performance metrics
      const priceChange24h = parseFloat(mainPair.priceChange?.h24 || '0');
      const currentPrice = parseFloat(mainPair.priceUsd || '0');

      // Use creation timestamp if available
      const pairCreatedAt = mainPair.pairCreatedAt || Date.now();
      const ageInDays = (Date.now() - pairCreatedAt) / (1000 * 60 * 60 * 24);

      // Only consider tokens less than 7 days old
      if (ageInDays > 7) return null;

      // Calculate multiplier from price changes
      const priceMultiplier24h = 1 + (priceChange24h / 100);

      // Rough multiplier estimation - be more lenient to catch more tokens
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
        if (fdvToLiquidityRatio > 5) {
          estimatedMultiplier = Math.max(estimatedMultiplier, Math.sqrt(fdvToLiquidityRatio));
        }
      }

      // RELAXED: Accept tokens with 3x-100x multipliers (was 5-50x)
      // This catches more potential winners
      if (estimatedMultiplier < 3 || estimatedMultiplier > 100) {
        return null;
      }

      const launchPrice = currentPrice / estimatedMultiplier;

      return {
        address: tokenAddress,
        launchTime: Math.floor(pairCreatedAt / 1000),
        launchPrice,
        peakPrice: currentPrice,
        multiplier: estimatedMultiplier,
        pairAddress: mainPair.pairAddress, // IMPORTANT: Capture pool address
        dexId: mainPair.dexId
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
   * Supports both GET and POST requests
   */
  private async fetchWithRetry(
    url: string,
    options: { timeout?: number; retries?: number; method?: string; body?: string; headers?: Record<string, string> } = {}
  ): Promise<Response> {
    const { timeout = 10000, retries = 3, method = 'GET', body, headers = {} } = options;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method,
          body,
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'OMM-Bot/1.0',
            ...headers
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
   * FIXED: Now properly queries DEX pool transactions and parses swap events
   */
  private async findEarlyBuyers(token: TokenPerformance): Promise<EarlyBuyer[]> {
    logger.info(`🔍 Finding early buyers for ${token.address.slice(0, 8)}... (${token.multiplier.toFixed(1)}x token)`);

    const earlyBuyers: EarlyBuyer[] = [];
    const seenWallets = new Set<string>();

    try {
      // Method 1: Query the DEX pool address if available (most reliable)
      if (token.pairAddress) {
        const poolBuyers = await this.findBuyersFromPool(token);
        for (const buyer of poolBuyers) {
          if (!seenWallets.has(buyer.walletAddress)) {
            seenWallets.add(buyer.walletAddress);
            earlyBuyers.push(buyer);
          }
        }
      }

      // Method 2: Use Helius DAS API to get token holders (if available)
      const heliusApiKey = this.getHeliusApiKey();
      if (heliusApiKey && earlyBuyers.length < 5) {
        const holderBuyers = await this.findBuyersFromHelius(token, heliusApiKey);
        for (const buyer of holderBuyers) {
          if (!seenWallets.has(buyer.walletAddress)) {
            seenWallets.add(buyer.walletAddress);
            earlyBuyers.push(buyer);
          }
        }
      }

      // Method 3: Fallback - query recent token transfers (less accurate but works)
      if (earlyBuyers.length < 3) {
        const transferBuyers = await this.findBuyersFromTransfers(token);
        for (const buyer of transferBuyers) {
          if (!seenWallets.has(buyer.walletAddress)) {
            seenWallets.add(buyer.walletAddress);
            earlyBuyers.push(buyer);
          }
        }
      }

      logger.info(`Found ${earlyBuyers.length} early buyers for ${token.address.slice(0, 8)}...`);
      return earlyBuyers;

    } catch (error: any) {
      logger.error('Error finding early buyers', {
        token: token.address,
        error: error.message
      });
      return earlyBuyers; // Return what we found so far
    }
  }

  /**
   * Find buyers by querying DEX pool transactions
   * This is the most accurate method as it directly finds swap transactions
   */
  private async findBuyersFromPool(token: TokenPerformance): Promise<EarlyBuyer[]> {
    const earlyBuyers: EarlyBuyer[] = [];

    try {
      if (!token.pairAddress) {
        logger.debug(`[Method 1: Pool] No pairAddress for ${token.address.slice(0, 8)}... - skipping`);
        return [];
      }

      logger.debug(`[Method 1: Pool] Querying pool ${token.pairAddress.slice(0, 8)}... for ${token.address.slice(0, 8)}...`);

      const poolPubkey = new PublicKey(token.pairAddress);
      const launchTime = token.launchTime;
      const fiveMinutesAfterLaunch = launchTime + 300;

      // Get signatures for the pool address (increased limit for better coverage)
      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(
          poolPubkey,
          { limit: 1000 },
          'confirmed'
        ),
        2 // Higher priority for pool queries
      );

      logger.debug(`Pool ${token.pairAddress.slice(0, 8)}... has ${signatures.length} signatures`);

      // Filter to first 5 minutes after launch (increased limit for better coverage)
      const relevantSigs = signatures.filter(sig => {
        if (!sig.blockTime) return false;
        return sig.blockTime >= launchTime && sig.blockTime <= fiveMinutesAfterLaunch;
      }).slice(0, 100); // Check up to 100 early transactions

      logger.debug(`Found ${relevantSigs.length} transactions in first 5 minutes`);

      // Parse each transaction to find buyers
      for (const sig of relevantSigs) {
        try {
          const tx = await rateLimitedRPC(
            () => this.connection.getParsedTransaction(
              sig.signature,
              { maxSupportedTransactionVersion: 0 }
            ),
            1
          );

          if (!tx || !tx.meta || tx.meta.err) continue;

          // Extract buyers from this swap transaction
          const buyers = this.extractBuyersFromSwap(tx, token.address);

          for (const buyerAddress of buyers) {
            earlyBuyers.push({
              walletAddress: buyerAddress,
              tokenAddress: token.address,
              buyTime: sig.blockTime!,
              buyPrice: token.launchPrice,
              secondsAfterLaunch: sig.blockTime! - launchTime
            });
          }
        } catch (error: any) {
          logger.debug(`Error parsing pool tx: ${error.message}`);
        }
      }

    } catch (error: any) {
      logger.debug(`[Method 1: Pool] Error: ${error.message}`);
    }

    logger.debug(`[Method 1: Pool] Found ${earlyBuyers.length} early buyers for ${token.address.slice(0, 8)}...`);
    return earlyBuyers;
  }

  /**
   * Extract buyer wallet addresses from a DEX swap transaction
   * Looks for wallets that had token balance increases
   */
  private extractBuyersFromSwap(tx: ParsedTransactionWithMeta, tokenAddress: string): string[] {
    const buyers: string[] = [];

    try {
      const postBalances = tx.meta?.postTokenBalances || [];
      const preBalances = tx.meta?.preTokenBalances || [];

      // Get the fee payer (transaction initiator) - this is usually the buyer
      const feePayer = tx.transaction.message.accountKeys[0]?.pubkey.toBase58();

      for (const postBalance of postBalances) {
        if (postBalance.mint !== tokenAddress) continue;

        const preBalance = preBalances.find(
          pre => pre.accountIndex === postBalance.accountIndex
        );

        const preAmount = preBalance?.uiTokenAmount?.uiAmount || 0;
        const postAmount = postBalance.uiTokenAmount?.uiAmount || 0;

        // Balance increased = this account received tokens (potential buyer)
        if (postAmount > preAmount) {
          const owner = postBalance.owner;

          // Skip if owner is a known program/pool address
          if (owner && !this.isKnownProgramAddress(owner)) {
            // Prefer the fee payer as the buyer, as they initiated the transaction
            if (feePayer && !buyers.includes(feePayer)) {
              buyers.push(feePayer);
            } else if (!buyers.includes(owner)) {
              buyers.push(owner);
            }
          }
        }
      }

      // If we didn't find buyers from token balances, use the fee payer
      if (buyers.length === 0 && feePayer && !this.isKnownProgramAddress(feePayer)) {
        buyers.push(feePayer);
      }

    } catch (error: any) {
      logger.debug('Error extracting buyers from swap', { error: error.message });
    }

    return buyers;
  }

  /**
   * Check if an address is a known program or pool address (not a user wallet)
   */
  private isKnownProgramAddress(address: string): boolean {
    const knownPrograms = [
      DEX_PROGRAMS.RAYDIUM_AMM,
      DEX_PROGRAMS.RAYDIUM_CLMM,
      DEX_PROGRAMS.ORCA_WHIRLPOOL,
      DEX_PROGRAMS.JUPITER_V6,
      DEX_PROGRAMS.PUMP_FUN,
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
      '11111111111111111111111111111111', // System Program
      'So11111111111111111111111111111111111111112', // Wrapped SOL
    ];

    return knownPrograms.includes(address);
  }

  /**
   * Find buyers using Helius DAS API (Digital Asset Standard)
   * This gets current token holders and checks when they first acquired
   */
  private async findBuyersFromHelius(token: TokenPerformance, apiKey: string): Promise<EarlyBuyer[]> {
    const earlyBuyers: EarlyBuyer[] = [];

    logger.debug(`[Method 2: Helius] Querying token holders for ${token.address.slice(0, 8)}...`);

    try {
      // Get token holders using Helius DAS API
      const response = await this.fetchWithRetry(
        `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
        {
          timeout: 15000,
          method: 'POST',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'helius-holders',
            method: 'getTokenAccounts',
            params: {
              mint: token.address,
              limit: 100,
            }
          }),
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (!response.ok) {
        logger.debug('Helius API request failed');
        return [];
      }

      const data = await response.json() as any;
      const tokenAccounts = data.result?.token_accounts || [];

      logger.debug(`Found ${tokenAccounts.length} token holders via Helius`);

      // For each holder, check when they first acquired the token (increased from 20 to 50)
      for (const account of tokenAccounts.slice(0, 50)) {
        const ownerAddress = account.owner;

        // Get the owner's transaction history for this token
        const ownerPubkey = new PublicKey(ownerAddress);
        const ownerSigs = await rateLimitedRPC(
          () => this.connection.getSignaturesForAddress(
            ownerPubkey,
            { limit: 50 },
            'confirmed'
          ),
          0
        );

        // Find their first transaction within 5 minutes of launch
        const earlyTx = ownerSigs.find(sig => {
          if (!sig.blockTime) return false;
          const secondsAfterLaunch = sig.blockTime - token.launchTime;
          return secondsAfterLaunch >= 0 && secondsAfterLaunch <= 300;
        });

        if (earlyTx && earlyTx.blockTime) {
          earlyBuyers.push({
            walletAddress: ownerAddress,
            tokenAddress: token.address,
            buyTime: earlyTx.blockTime,
            buyPrice: token.launchPrice,
            secondsAfterLaunch: earlyTx.blockTime - token.launchTime
          });
        }
      }

    } catch (error: any) {
      logger.debug(`[Method 2: Helius] Error: ${error.message}`);
    }

    logger.debug(`[Method 2: Helius] Found ${earlyBuyers.length} early buyers for ${token.address.slice(0, 8)}...`);
    return earlyBuyers;
  }

  /**
   * Fallback: Find buyers by looking for token transfer transactions
   * Less accurate but works without specific pool address
   */
  private async findBuyersFromTransfers(token: TokenPerformance): Promise<EarlyBuyer[]> {
    const earlyBuyers: EarlyBuyer[] = [];

    logger.debug(`[Method 3: Transfers] Querying largest holders for ${token.address.slice(0, 8)}...`);

    try {
      // Get DexScreener data again to find any available transaction info
      const response = await this.fetchWithRetry(
        `https://api.dexscreener.com/latest/dex/tokens/${token.address}`,
        { timeout: 10000 }
      );

      if (!response.ok) return [];

      const data = await response.json() as { pairs?: any[] };
      const mainPair = data.pairs?.[0];

      if (!mainPair) return [];

      // Try to get transactions from the pair's txns data
      const txns = mainPair.txns?.h24 || {};
      const buyCount = txns.buys || 0;

      logger.debug(`DexScreener shows ${buyCount} buys in 24h for ${token.address.slice(0, 8)}...`);

      // If there are recent buys, query the token mint for recent large holder activity
      const tokenPubkey = new PublicKey(token.address);

      // Get largest accounts for this token
      const largestAccounts = await rateLimitedRPC(
        () => this.connection.getTokenLargestAccounts(tokenPubkey),
        1
      );

      // Check each large holder for early entry (increased from 10 to 30)
      for (const account of largestAccounts.value.slice(0, 30)) {
        try {
          // Get the token account info to find the owner
          const accountInfo = await rateLimitedRPC(
            () => this.connection.getParsedAccountInfo(account.address),
            0
          );

          const parsedData = (accountInfo.value?.data as any)?.parsed;
          const owner = parsedData?.info?.owner;

          if (!owner || this.isKnownProgramAddress(owner)) continue;

          // Check if this owner made early transactions
          const ownerPubkey = new PublicKey(owner);
          const ownerSigs = await rateLimitedRPC(
            () => this.connection.getSignaturesForAddress(
              ownerPubkey,
              { limit: 30 },
              'confirmed'
            ),
            0
          );

          // Find early transaction
          const earlyTx = ownerSigs.find(sig => {
            if (!sig.blockTime) return false;
            const secondsAfterLaunch = sig.blockTime - token.launchTime;
            return secondsAfterLaunch >= 0 && secondsAfterLaunch <= 300;
          });

          if (earlyTx && earlyTx.blockTime) {
            earlyBuyers.push({
              walletAddress: owner,
              tokenAddress: token.address,
              buyTime: earlyTx.blockTime,
              buyPrice: token.launchPrice,
              secondsAfterLaunch: earlyTx.blockTime - token.launchTime
            });
          }
        } catch (error: any) {
          logger.debug(`Error checking holder: ${error.message}`);
        }
      }

    } catch (error: any) {
      logger.debug(`[Method 3: Transfers] Error: ${error.message}`);
    }

    logger.debug(`[Method 3: Transfers] Found ${earlyBuyers.length} early buyers for ${token.address.slice(0, 8)}...`);
    return earlyBuyers;
  }


  /**
   * Filter out wallets connected to token deployer (1-hop analysis only)
   * RELAXED: Now only checks direct deployer connections (1 hop instead of 2)
   * to avoid false positives from common funding sources
   *
   * Removes wallets that:
   * - Are the deployer
   * - Received SOL/tokens DIRECTLY from deployer
   */
  private async filterDeployerConnectedWallets(
    buyers: EarlyBuyer[],
    tokenAddress: string
  ): Promise<EarlyBuyer[]> {
    logger.debug(`Filtering deployer-connected wallets (${buyers.length} buyers)`);

    // If we have very few buyers, skip filtering to preserve data
    if (buyers.length <= 3) {
      logger.debug('Skipping deployer filter - too few buyers to filter');
      return buyers;
    }

    try {
      // Get token deployer address
      const deployer = await this.getTokenDeployer(tokenAddress);
      if (!deployer) {
        logger.debug('Could not identify deployer, skipping deployer filter');
        return buyers;
      }

      // RELAXED: Only check 1 hop (direct connection) instead of 2
      const connectionGraph = await this.buildConnectionGraph(deployer, 1);

      // Filter out directly connected wallets AND the deployer
      const cleanBuyers = buyers.filter(buyer => {
        const isConnected = connectionGraph.has(buyer.walletAddress);
        const isDeployer = buyer.walletAddress === deployer;
        // Keep wallets that are NOT connected AND NOT the deployer
        return !isConnected && !isDeployer;
      });

      const removedCount = buyers.length - cleanBuyers.length;
      if (removedCount > 0) {
        logger.info(`Removed ${removedCount} deployer-connected wallets`);
      }

      // SAFETY: Never remove more than 50% of buyers
      if (cleanBuyers.length < buyers.length * 0.5) {
        logger.warn('Deployer filter removed too many - keeping more buyers');
        return buyers.slice(0, Math.max(cleanBuyers.length, Math.ceil(buyers.length * 0.5)));
      }

      return cleanBuyers;

    } catch (error: any) {
      logger.error('Error filtering deployer connections', { error: error.message });
      return buyers; // Return all on error (fail safe)
    }
  }

  /**
   * Get the deployer address for a token
   * Rate-limited to avoid overwhelming RPC
   */
  private async getTokenDeployer(tokenAddress: string): Promise<string | null> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);

      // Get token account creation signature (increased for better deployer detection)
      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(
          tokenPubkey,
          { limit: 300 },
          'confirmed'
        ),
        1 // Medium priority
      );

      if (signatures.length === 0) return null;

      // Oldest signature is likely the creation transaction
      const creationSig = signatures[signatures.length - 1];
      const tx = await rateLimitedRPC(
        () => this.connection.getParsedTransaction(
          creationSig.signature,
          { maxSupportedTransactionVersion: 0 }
        ),
        1 // Medium priority
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
   * Rate-limited and capped to avoid excessive RPC calls
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

    // Cap total wallets to check to avoid runaway RPC calls
    const maxWalletsToCheck = 20;
    let walletsChecked = 0;

    while (queue.length > 0 && walletsChecked < maxWalletsToCheck) {
      const current = queue.shift()!;

      if (current.depth >= maxDepth) continue;

      walletsChecked++;

      // Get wallets this wallet has sent SOL/tokens to
      const recipients = await this.getWalletRecipients(current.wallet);

      // Limit recipients per wallet to avoid explosion
      for (const recipient of recipients.slice(0, 10)) {
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
   * Rate-limited and reduced to avoid overwhelming RPC
   */
  private async getWalletRecipients(walletAddress: string): Promise<string[]> {
    try {
      const pubkey = new PublicKey(walletAddress);
      const recipients = new Set<string>();

      // Get recent signatures (increased for better connection detection)
      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(
          pubkey,
          { limit: 100 },
          'confirmed'
        ),
        0 // Lower priority
      );

      // Check first 25 transactions for connection detection
      for (const sig of signatures.slice(0, 25)) {
        try {
          const tx = await rateLimitedRPC(
            () => this.connection.getParsedTransaction(
              sig.signature,
              { maxSupportedTransactionVersion: 0 }
            ),
            0 // Lower priority
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
        } catch (error: any) {
          logger.debug(`Error parsing recipient tx: ${error.message}`);
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
   * RELAXED: Less aggressive detection to avoid false positives
   * Only flags OBVIOUS bots - errs on side of keeping wallets
   */
  private async isBotWallet(walletAddress: string): Promise<boolean> {
    try {
      const pubkey = new PublicKey(walletAddress);

      // Get recent transaction history
      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(
          pubkey,
          { limit: 30 },
          'confirmed'
        ),
        0 // Lower priority
      );

      // RELAXED: Need more data to make bot determination
      if (signatures.length < 15) return false;

      let quickSellCount = 0;
      let totalTrades = 0;
      let atomicArbPatterns = 0;

      // Track buy/sell pairs for quick sell detection
      const tokenBuys: Map<string, number> = new Map();
      const slotCounts: Map<number, number> = new Map();

      // Analyze fewer transactions to reduce RPC load
      for (const sig of signatures.slice(0, 10)) {
        try {
          const tx = await rateLimitedRPC(
            () => this.connection.getParsedTransaction(
              sig.signature,
              { maxSupportedTransactionVersion: 0 }
            ),
            0
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
            DEX_PROGRAMS.RAYDIUM_AMM,
            DEX_PROGRAMS.ORCA_WHIRLPOOL,
            DEX_PROGRAMS.JUPITER_V6,
          ];

          const dexInteractions = dexPrograms.filter(p => programIds.has(p)).length;
          if (dexInteractions >= 3) { // RAISED threshold from 2 to 3
            atomicArbPatterns++;
          }

          // Check token balance changes
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
              tokenBuys.set(post.mint, sig.blockTime || Date.now() / 1000);
            } else if (preAmount > postAmount && sig.blockTime) {
              const buyTime = tokenBuys.get(post.mint);
              // RELAXED: Only count as quick sell if < 2 minutes (was 5)
              if (buyTime && (sig.blockTime - buyTime) < 120) {
                quickSellCount++;
              }
            }
          }

          totalTrades++;
        } catch (error: any) {
          logger.debug(`Error parsing bot check tx: ${error.message}`);
        }
      }

      // RELAXED thresholds - only flag OBVIOUS bots

      // If more than 90% are quick sells (was 80%), likely a dump bot
      const quickSellRate = quickSellCount / Math.max(totalTrades, 1);
      if (quickSellRate > 0.9 && quickSellCount >= 5) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... flagged as dump bot (${(quickSellRate * 100).toFixed(0)}% quick sells)`);
        return true;
      }

      // If atomic arbitrage detected very frequently (raised from 2 to 4)
      if (atomicArbPatterns >= 4) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... flagged as atomic arb bot (${atomicArbPatterns} patterns)`);
        return true;
      }

      // REMOVED: Sandwich and frontrun detection - too many false positives
      // Regular traders can have multiple txs in same slot legitimately

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
             (id, address, tier, score, win_rate, average_return, tokens_entered, last_active, total_trades, successful_trades, average_hold_time, is_active, created_at, updated_at)
             VALUES ($1, $2, 3, 0, 0, 0, 1, NOW(), 0, 0, 0, true, NOW(), NOW())
             ON CONFLICT (address) DO UPDATE
             SET tokens_entered = smart_wallets.tokens_entered + 1,
                 last_active = NOW(),
                 updated_at = NOW()`,
            [randomUUID(), buyer.walletAddress]
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

  /**
   * Get Helius API key from environment
   * Checks HELIUS_API_KEY first, then extracts from SOLANA_RPC_PRIMARY URL
   */
  private getHeliusApiKey(): string | null {
    // Check explicit HELIUS_API_KEY first
    if (process.env.HELIUS_API_KEY) {
      return process.env.HELIUS_API_KEY;
    }

    // Try to extract from RPC URLs
    const rpcUrls = [
      process.env.SOLANA_RPC_PRIMARY,
      process.env.SOLANA_RPC_SECONDARY,
      process.env.SOLANA_RPC_TERTIARY,
    ];

    for (const url of rpcUrls) {
      if (url && url.includes('helius')) {
        // Extract api-key from URL like: https://mainnet.helius-rpc.com/?api-key=xxx
        const match = url.match(/api-key=([a-zA-Z0-9-]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }

    return null;
  }
}
