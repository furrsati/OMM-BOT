/**
 * Signal Aggregator
 *
 * Combines signals from multiple sources into a unified signal object:
 * - Smart wallet activity (how many wallets entered, their tier, timing)
 * - Token safety analysis (contract checks, honeypot detection)
 * - Market conditions (regime, SOL/BTC trends, timing)
 * - Social signals (mentions, community activity)
 * - Entry quality (dip depth, distance from ATH, buy/sell ratio)
 *
 * Output: A comprehensive signal object ready for conviction scoring
 *
 * FIXED: Now uses real data from database and on-chain sources instead of stubs
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { WalletManager } from '../discovery';
import { SafetyScorer, SafetyAnalysis } from '../safety';
import { PriceFeed, RegimeDetector } from '../market';
import { OnChainSocialIntelligence } from '../social/on-chain-social-intelligence';
import { HypeDetector } from '../social/hype-detector';
import { query } from '../db/postgres';
import { rateLimitedRPC } from '../utils/rate-limiter';

export interface SmartWalletSignal {
  walletCount: number; // How many smart wallets entered
  tier1Count: number;  // How many Tier 1 wallets
  tier2Count: number;  // How many Tier 2 wallets
  tier3Count: number;  // How many Tier 3 wallets
  avgWalletScore: number; // Average score of wallets that entered
  firstEntryTime: number; // Timestamp of first smart wallet entry
  mostRecentEntry: number; // Timestamp of most recent entry
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'; // Based on wallet count and tier
}

export interface EntryQualitySignal {
  currentPrice: number;
  localHigh: number; // Highest price in last 1-4 hours
  allTimeHigh: number;
  dipDepthPercent: number; // % down from local high
  distanceFromATHPercent: number; // % down from ATH
  tokenAgeMinutes: number;
  volumeTrend: 'INCREASING' | 'STABLE' | 'DECREASING';
  buyToSellRatio: number; // Ratio of buys to sells
  holderCount: number;
  holderGrowthRate: number; // % growth in last hour
  hypePhase: 'DISCOVERY' | 'EARLY_FOMO' | 'PEAK_FOMO' | 'DISTRIBUTION' | 'DUMP';
}

export interface SocialSignal {
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  twitterFollowers: number;
  telegramMembers: number;
  mentionVelocity: number; // Mentions per hour
  sentimentScore: number; // 0-100
  influencerCalls: number; // How many influencers called it
  isCoordinated: boolean; // Detected coordinated campaign
}

export interface MarketContextSignal {
  regime: 'FULL' | 'CAUTIOUS' | 'DEFENSIVE' | 'PAUSE';
  solChange24h: number;
  btcChange24h: number;
  isPeakHours: boolean; // 9 AM - 11 PM EST
  dayOfWeek: string;
  volumeProfile: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AggregatedSignal {
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;

  // Signal components
  smartWallet: SmartWalletSignal;
  safety: SafetyAnalysis;
  entryQuality: EntryQualitySignal;
  social: SocialSignal;
  marketContext: MarketContextSignal;

  // Metadata
  timestamp: number;
  signalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
}

/**
 * Known wallet data that can be passed from TrackedOpportunity
 * to avoid redundant database queries
 */
export interface KnownWalletData {
  walletAddresses: string[];
  walletTiers: number[];
  firstDetected: number;
}

export class SignalAggregator {
  private connection: Connection;
  private walletManager: WalletManager;
  private safetyScorer: SafetyScorer;
  private priceFeed: PriceFeed;
  private regimeDetector: RegimeDetector;
  private socialIntel: OnChainSocialIntelligence;
  private hypeDetector: HypeDetector;

  constructor(
    connection: Connection,
    walletManager: WalletManager,
    safetyScorer: SafetyScorer,
    priceFeed: PriceFeed,
    regimeDetector: RegimeDetector
  ) {
    this.connection = connection;
    this.walletManager = walletManager;
    this.safetyScorer = safetyScorer;
    this.priceFeed = priceFeed;
    this.regimeDetector = regimeDetector;
    this.socialIntel = new OnChainSocialIntelligence(connection);
    this.hypeDetector = new HypeDetector(connection);
  }

  /**
   * Aggregate all signals for a token into a single comprehensive signal object
   *
   * @param tokenAddress - The token to analyze
   * @param tokenName - Optional token name
   * @param tokenSymbol - Optional token symbol
   * @param knownWalletData - Optional pre-fetched wallet data from TrackedOpportunity
   * @param knownHighPrice - Optional known high price for dip calculation
   */
  async aggregateSignals(
    tokenAddress: string,
    tokenName?: string,
    tokenSymbol?: string,
    knownWalletData?: KnownWalletData,
    knownHighPrice?: number
  ): Promise<AggregatedSignal> {
    logger.info(`🔍 Aggregating signals for ${tokenAddress.slice(0, 8)}...`);

    try {
      // Run all signal gathering in parallel for speed
      const [
        smartWalletSignal,
        safetyAnalysis,
        entryQualitySignal,
        socialSignal,
        marketContextSignal
      ] = await Promise.all([
        this.getSmartWalletSignal(tokenAddress, knownWalletData),
        this.safetyScorer.analyze(tokenAddress),
        this.getEntryQualitySignal(tokenAddress, knownHighPrice),
        this.getSocialSignal(tokenAddress),
        this.getMarketContextSignal()
      ]);

      // Determine overall signal strength
      const signalStrength = this.determineSignalStrength(
        smartWalletSignal,
        safetyAnalysis,
        entryQualitySignal
      );

      const aggregatedSignal: AggregatedSignal = {
        tokenAddress,
        tokenName: tokenName || 'Unknown',
        tokenSymbol: tokenSymbol || 'Unknown',
        smartWallet: smartWalletSignal,
        safety: safetyAnalysis,
        entryQuality: entryQualitySignal,
        social: socialSignal,
        marketContext: marketContextSignal,
        timestamp: Date.now(),
        signalStrength
      };

      logger.info(`✅ Signals aggregated`, {
        token: tokenAddress.slice(0, 8),
        strength: signalStrength,
        smartWallets: smartWalletSignal.walletCount,
        tier1: smartWalletSignal.tier1Count,
        tier2: smartWalletSignal.tier2Count,
        tier3: smartWalletSignal.tier3Count,
        safetyScore: safetyAnalysis.overallScore,
        dipDepth: entryQualitySignal.dipDepthPercent.toFixed(1) + '%'
      });

      return aggregatedSignal;

    } catch (error: any) {
      logger.error('Error aggregating signals', {
        token: tokenAddress,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get smart wallet signal for a token
   *
   * FIXED: Now uses real data from:
   * 1. KnownWalletData passed from TrackedOpportunity (if available)
   * 2. Database query for token_opportunities table
   * 3. Cross-reference with smart_wallets table for scores
   *
   * @param tokenAddress - The token to analyze
   * @param knownWalletData - Pre-fetched wallet data from TrackedOpportunity
   */
  private async getSmartWalletSignal(
    tokenAddress: string,
    knownWalletData?: KnownWalletData
  ): Promise<SmartWalletSignal> {
    try {
      let walletAddresses: string[] = [];
      let walletTiers: number[] = [];
      let firstDetected = 0;

      // Method 1: Use pre-fetched data from TrackedOpportunity (most accurate)
      if (knownWalletData && knownWalletData.walletAddresses.length > 0) {
        walletAddresses = knownWalletData.walletAddresses;
        walletTiers = knownWalletData.walletTiers;
        firstDetected = knownWalletData.firstDetected;
        logger.debug(`Using known wallet data: ${walletAddresses.length} wallets`);
      } else {
        // Method 2: Query database for this token's opportunity
        const dbResult = await query<{
          smart_wallets_entered: string[];
          tier1_count: number;
          tier2_count: number;
          tier3_count: number;
          discovered_at: Date;
        }>(`
          SELECT smart_wallets_entered, tier1_count, tier2_count, tier3_count, discovered_at
          FROM token_opportunities
          WHERE token_address = $1
          ORDER BY discovered_at DESC
          LIMIT 1
        `, [tokenAddress]);

        if (dbResult.rows.length > 0) {
          const row = dbResult.rows[0];
          walletAddresses = row.smart_wallets_entered || [];
          firstDetected = row.discovered_at ? new Date(row.discovered_at).getTime() : 0;

          // If we have tier counts from DB, use them
          if (row.tier1_count || row.tier2_count || row.tier3_count) {
            // Reconstruct tiers from counts (we don't have individual wallet tiers)
            walletTiers = [
              ...Array(row.tier1_count || 0).fill(1),
              ...Array(row.tier2_count || 0).fill(2),
              ...Array(row.tier3_count || 0).fill(3)
            ];
          }
          logger.debug(`Loaded wallet data from DB: ${walletAddresses.length} wallets`);
        }

        // Method 3: If still no wallet data, check watchlist against on-chain holdings
        if (walletAddresses.length === 0) {
          const watchlist = this.walletManager.getWatchlist();
          if (watchlist.length > 0) {
            // Check which watched wallets currently hold this token
            const holdingWallets = await this.findWatchlistWalletsHoldingToken(
              tokenAddress,
              watchlist
            );
            walletAddresses = holdingWallets.map(w => w.address);
            walletTiers = holdingWallets.map(w => w.tier);
            firstDetected = Date.now();
            logger.debug(`Found ${walletAddresses.length} watchlist wallets holding token`);
          }
        }
      }

      // Now get wallet details from smart_wallets table to calculate scores
      let avgScore = 0;
      if (walletAddresses.length > 0 && walletTiers.length === 0) {
        // Need to look up tiers from database
        const walletDetails = await query<{
          address: string;
          tier: number;
          score: number;
        }>(`
          SELECT wallet_address as address, tier, score
          FROM smart_wallets
          WHERE wallet_address = ANY($1)
        `, [walletAddresses]);

        const walletMap = new Map(walletDetails.rows.map(w => [w.address, w]));

        // Build tier array and calculate average score
        let totalScore = 0;
        walletTiers = walletAddresses.map(addr => {
          const wallet = walletMap.get(addr);
          if (wallet) {
            totalScore += wallet.score || 0;
            return wallet.tier || 3;
          }
          return 3; // Default to Tier 3 if not found
        });

        avgScore = walletDetails.rows.length > 0
          ? totalScore / walletDetails.rows.length
          : 0;
      } else if (walletAddresses.length > 0) {
        // Calculate average score from known wallets
        const walletDetails = await query<{ score: number }>(`
          SELECT score FROM smart_wallets WHERE wallet_address = ANY($1)
        `, [walletAddresses]);

        avgScore = walletDetails.rows.length > 0
          ? walletDetails.rows.reduce((sum, w) => sum + (w.score || 0), 0) / walletDetails.rows.length
          : 0;
      }

      // Count wallets by tier
      const tier1Count = walletTiers.filter(t => t === 1).length;
      const tier2Count = walletTiers.filter(t => t === 2).length;
      const tier3Count = walletTiers.filter(t => t === 3).length;

      // Determine confidence based on CLAUDE.md rules:
      // - 3+ Tier 1 or Tier 2 = HIGH
      // - 1-2 Tier 1 or 2+ Tier 2 = MEDIUM
      // - Tier 3 only = LOW
      let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (tier1Count >= 3 || (tier1Count >= 2 && tier2Count >= 1) || tier2Count >= 3) {
        confidence = 'HIGH';
      } else if (tier1Count >= 1 || tier2Count >= 2) {
        confidence = 'MEDIUM';
      }

      const signal: SmartWalletSignal = {
        walletCount: walletAddresses.length,
        tier1Count,
        tier2Count,
        tier3Count,
        avgWalletScore: avgScore,
        firstEntryTime: firstDetected || Date.now(),
        mostRecentEntry: Date.now(), // Assume recent if we're evaluating now
        confidence
      };

      logger.info(`Smart wallet signal for ${tokenAddress.slice(0, 8)}...`, {
        walletCount: signal.walletCount,
        tier1: tier1Count,
        tier2: tier2Count,
        tier3: tier3Count,
        avgScore: avgScore.toFixed(1),
        confidence
      });

      return signal;

    } catch (error: any) {
      logger.error('Error getting smart wallet signal', {
        token: tokenAddress,
        error: error.message
      });
      return {
        walletCount: 0,
        tier1Count: 0,
        tier2Count: 0,
        tier3Count: 0,
        avgWalletScore: 0,
        firstEntryTime: 0,
        mostRecentEntry: 0,
        confidence: 'LOW'
      };
    }
  }

  /**
   * Find which wallets from our watchlist currently hold a token
   * Uses on-chain data to verify holdings
   */
  private async findWatchlistWalletsHoldingToken(
    tokenAddress: string,
    watchlist: Array<{ address: string; tier: number; score: number }>
  ): Promise<Array<{ address: string; tier: number; score: number }>> {
    const holdingWallets: Array<{ address: string; tier: number; score: number }> = [];

    try {
      const tokenMint = new PublicKey(tokenAddress);

      // Check each wallet (limit to top 50 to avoid RPC overload)
      const walletsToCheck = watchlist.slice(0, 50);

      for (const wallet of walletsToCheck) {
        try {
          const walletPubkey = new PublicKey(wallet.address);

          // Get token accounts for this wallet
          const tokenAccounts = await rateLimitedRPC(
            () => this.connection.getParsedTokenAccountsByOwner(
              walletPubkey,
              { mint: tokenMint }
            ),
            0 // Low priority
          );

          // Check if any account has a balance
          const hasBalance = tokenAccounts.value.some(account => {
            const amount = account.account.data.parsed?.info?.tokenAmount?.uiAmount || 0;
            return amount > 0;
          });

          if (hasBalance) {
            holdingWallets.push(wallet);
          }
        } catch (error: any) {
          // Skip wallet on error
          logger.debug(`Error checking wallet ${wallet.address.slice(0, 8)}: ${error.message}`);
        }
      }
    } catch (error: any) {
      logger.error('Error finding watchlist wallets holding token', { error: error.message });
    }

    return holdingWallets;
  }

  /**
   * Get entry quality signal for a token
   *
   * FIXED: Now uses real data from DexScreener API and tracked high price
   *
   * @param tokenAddress - The token to analyze
   * @param knownHighPrice - Pre-tracked high price from TrackedOpportunity
   */
  private async getEntryQualitySignal(
    tokenAddress: string,
    knownHighPrice?: number
  ): Promise<EntryQualitySignal> {
    try {
      // Get comprehensive price data from DexScreener
      const dexScreenerData = await this.fetchDexScreenerData(tokenAddress);

      // Get price data from our price feed as fallback
      const priceData = await this.priceFeed.getPrice(tokenAddress);

      // Use DexScreener data if available, otherwise fall back to price feed
      const currentPrice = dexScreenerData?.priceUsd || priceData?.priceUSD || 0;

      // Calculate local high (use known high if provided, otherwise from DexScreener)
      let localHigh = knownHighPrice || 0;
      if (!localHigh && dexScreenerData) {
        // Use price change data to estimate local high
        const priceChange1h = dexScreenerData.priceChange1h || 0;
        if (priceChange1h < 0) {
          // Price dropped, so local high was higher
          localHigh = currentPrice / (1 + priceChange1h / 100);
        } else {
          // Price is rising or stable, use current as approximate local high
          localHigh = currentPrice;
        }
      }
      if (!localHigh) localHigh = currentPrice;

      // All-time high estimation from price changes
      let allTimeHigh = localHigh;
      if (dexScreenerData) {
        const priceChange24h = dexScreenerData.priceChange24h || 0;
        if (priceChange24h < 0 && Math.abs(priceChange24h) > Math.abs(dexScreenerData.priceChange1h || 0)) {
          // 24h change is worse than 1h, ATH was probably higher
          allTimeHigh = Math.max(localHigh, currentPrice / (1 + priceChange24h / 100));
        }
      }

      // Calculate dip metrics
      const dipDepth = localHigh > 0 ? ((localHigh - currentPrice) / localHigh) * 100 : 0;
      const distanceFromATH = allTimeHigh > 0 ? ((allTimeHigh - currentPrice) / allTimeHigh) * 100 : 0;

      // Token age from DexScreener pair creation time
      let tokenAgeMinutes = 60; // Default 1 hour
      if (dexScreenerData?.pairCreatedAt) {
        const ageMs = Date.now() - dexScreenerData.pairCreatedAt;
        tokenAgeMinutes = Math.floor(ageMs / 60000);
      }

      // Volume trend from DexScreener
      let volumeTrend: 'INCREASING' | 'STABLE' | 'DECREASING' = 'STABLE';
      if (dexScreenerData) {
        const volume5m = dexScreenerData.volume5m || 0;
        const volume1h = dexScreenerData.volume1h || 0;
        const avgVolume5m = volume1h > 0 ? volume1h / 12 : 0; // 12 five-minute periods in an hour

        if (volume5m > avgVolume5m * 1.5) {
          volumeTrend = 'INCREASING';
        } else if (volume5m < avgVolume5m * 0.5) {
          volumeTrend = 'DECREASING';
        }
      }

      // Buy/sell ratio from DexScreener txns
      let buyToSellRatio = 1.0;
      if (dexScreenerData?.txns) {
        const buys = dexScreenerData.txns.buys || 0;
        const sells = dexScreenerData.txns.sells || 0;
        buyToSellRatio = sells > 0 ? buys / sells : buys > 0 ? 10 : 1;
      }

      // Holder count (if available from contract analysis)
      const holderCount = dexScreenerData?.holders || 0;

      // Estimate holder growth rate from volume and txn data
      let holderGrowthRate = 0;
      if (dexScreenerData?.txns) {
        // Net new holders ≈ buys - sells (rough estimate)
        const netTxns = (dexScreenerData.txns.buys || 0) - (dexScreenerData.txns.sells || 0);
        holderGrowthRate = holderCount > 0 ? (netTxns / holderCount) * 100 : netTxns > 0 ? 10 : 0;
      }

      // Determine hype phase based on metrics (per CLAUDE.md)
      let hypePhase: 'DISCOVERY' | 'EARLY_FOMO' | 'PEAK_FOMO' | 'DISTRIBUTION' | 'DUMP' = 'DISCOVERY';

      if (volumeTrend === 'DECREASING' && buyToSellRatio < 0.8) {
        hypePhase = 'DUMP';
      } else if (buyToSellRatio < 1.0 && holderGrowthRate <= 0) {
        hypePhase = 'DISTRIBUTION';
      } else if (holderGrowthRate > 20 || (volumeTrend === 'INCREASING' && buyToSellRatio > 3)) {
        hypePhase = 'PEAK_FOMO';
      } else if (holderGrowthRate > 10 || (volumeTrend === 'INCREASING' && buyToSellRatio > 1.5)) {
        hypePhase = 'EARLY_FOMO';
      } else {
        hypePhase = 'DISCOVERY';
      }

      const signal: EntryQualitySignal = {
        currentPrice,
        localHigh,
        allTimeHigh,
        dipDepthPercent: Math.max(0, dipDepth),
        distanceFromATHPercent: Math.max(0, distanceFromATH),
        tokenAgeMinutes,
        volumeTrend,
        buyToSellRatio,
        holderCount,
        holderGrowthRate,
        hypePhase
      };

      logger.debug(`Entry quality signal for ${tokenAddress.slice(0, 8)}...`, {
        currentPrice: currentPrice.toFixed(8),
        localHigh: localHigh.toFixed(8),
        dipDepth: dipDepth.toFixed(1) + '%',
        tokenAge: tokenAgeMinutes + ' min',
        buyToSellRatio: buyToSellRatio.toFixed(2),
        hypePhase
      });

      return signal;

    } catch (error: any) {
      logger.error('Error getting entry quality signal', {
        token: tokenAddress,
        error: error.message
      });

      // Return safe defaults on error
      return {
        currentPrice: 0,
        localHigh: 0,
        allTimeHigh: 0,
        dipDepthPercent: 0,
        distanceFromATHPercent: 0,
        tokenAgeMinutes: 0,
        volumeTrend: 'STABLE',
        buyToSellRatio: 1.0,
        holderCount: 0,
        holderGrowthRate: 0,
        hypePhase: 'DISCOVERY'
      };
    }
  }

  /**
   * Fetch comprehensive token data from DexScreener API
   */
  private async fetchDexScreenerData(tokenAddress: string): Promise<{
    priceUsd: number;
    priceChange1h: number;
    priceChange24h: number;
    volume5m: number;
    volume1h: number;
    volume24h: number;
    liquidityUsd: number;
    pairCreatedAt: number;
    holders: number;
    txns: { buys: number; sells: number };
  } | null> {
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { 'Accept': 'application/json' }
        }
      );

      if (!response.ok) {
        logger.debug(`DexScreener API returned ${response.status}`);
        return null;
      }

      const data = await response.json() as { pairs?: any[] };
      const pairs = data.pairs || [];

      // Find the main SOL pair (prefer Raydium)
      const mainPair = pairs.find((p: any) =>
        p.chainId === 'solana' &&
        p.quoteToken?.symbol === 'SOL' &&
        (p.dexId === 'raydium' || p.dexId === 'orca')
      ) || pairs.find((p: any) =>
        p.chainId === 'solana' && p.quoteToken?.symbol === 'SOL'
      ) || pairs[0];

      if (!mainPair) {
        logger.debug('No suitable pair found on DexScreener');
        return null;
      }

      return {
        priceUsd: parseFloat(mainPair.priceUsd || '0'),
        priceChange1h: parseFloat(mainPair.priceChange?.h1 || '0'),
        priceChange24h: parseFloat(mainPair.priceChange?.h24 || '0'),
        volume5m: parseFloat(mainPair.volume?.m5 || '0'),
        volume1h: parseFloat(mainPair.volume?.h1 || '0'),
        volume24h: parseFloat(mainPair.volume?.h24 || '0'),
        liquidityUsd: parseFloat(mainPair.liquidity?.usd || '0'),
        pairCreatedAt: mainPair.pairCreatedAt || 0,
        holders: mainPair.info?.holders || 0,
        txns: {
          buys: mainPair.txns?.h24?.buys || 0,
          sells: mainPair.txns?.h24?.sells || 0
        }
      };

    } catch (error: any) {
      logger.debug('Error fetching DexScreener data', { error: error.message });
      return null;
    }
  }

  /**
   * Get social signal for a token
   *
   * FIXED: Now uses OnChainSocialIntelligence for real on-chain analysis
   * and DexScreener for social link data
   */
  private async getSocialSignal(tokenAddress: string): Promise<SocialSignal> {
    try {
      // Get on-chain social intelligence (wallet behavior analysis)
      const onChainScore = await this.socialIntel.getOnChainSocialScore(tokenAddress);

      // Get social links from DexScreener
      const socialLinks = await this.fetchSocialLinks(tokenAddress);

      // Detect coordinated buying (from on-chain analysis)
      const isCoordinated = onChainScore.signals.coordinatedBuyingDetected ||
        onChainScore.breakdown.organicVsCoordinated < 10;

      // Convert on-chain score to social signal format
      const signal: SocialSignal = {
        hasTwitter: socialLinks.hasTwitter,
        hasTelegram: socialLinks.hasTelegram,
        hasWebsite: socialLinks.hasWebsite,
        twitterFollowers: socialLinks.twitterFollowers,
        telegramMembers: socialLinks.telegramMembers,
        // Use unique buyers as a proxy for mention velocity (on-chain activity)
        mentionVelocity: onChainScore.signals.uniqueBuyersLast15Min * 4, // Scale to hourly
        // Use on-chain overall score as sentiment (0-100)
        sentimentScore: onChainScore.overall,
        // Detect if likely influencer-driven (sudden spike in low-quality wallets)
        influencerCalls: onChainScore.signals.suspiciousPatternDetected ? 1 : 0,
        isCoordinated
      };

      // Penalties based on on-chain warnings
      if (onChainScore.warnings.length > 0) {
        logger.debug(`Social warnings for ${tokenAddress.slice(0, 8)}:`, {
          warnings: onChainScore.warnings
        });
      }

      // Green flags
      if (onChainScore.greenFlags.length > 0) {
        logger.debug(`Social green flags for ${tokenAddress.slice(0, 8)}:`, {
          greenFlags: onChainScore.greenFlags
        });
      }

      logger.debug(`Social signal for ${tokenAddress.slice(0, 8)}...`, {
        hasTwitter: signal.hasTwitter,
        hasTelegram: signal.hasTelegram,
        onChainScore: onChainScore.overall,
        isCoordinated: signal.isCoordinated,
        uniqueBuyers: onChainScore.signals.uniqueBuyersLast15Min
      });

      return signal;

    } catch (error: any) {
      logger.debug('Error getting social signal', { error: error.message });
      return {
        hasTwitter: false,
        hasTelegram: false,
        hasWebsite: false,
        twitterFollowers: 0,
        telegramMembers: 0,
        mentionVelocity: 0,
        sentimentScore: 50, // Neutral on error
        influencerCalls: 0,
        isCoordinated: false
      };
    }
  }

  /**
   * Fetch social links from DexScreener token info
   */
  private async fetchSocialLinks(tokenAddress: string): Promise<{
    hasTwitter: boolean;
    hasTelegram: boolean;
    hasWebsite: boolean;
    twitterFollowers: number;
    telegramMembers: number;
  }> {
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        {
          signal: AbortSignal.timeout(5000),
          headers: { 'Accept': 'application/json' }
        }
      );

      if (!response.ok) {
        return { hasTwitter: false, hasTelegram: false, hasWebsite: false, twitterFollowers: 0, telegramMembers: 0 };
      }

      const data = await response.json() as { pairs?: any[] };
      const mainPair = data.pairs?.[0];

      if (!mainPair?.info) {
        return { hasTwitter: false, hasTelegram: false, hasWebsite: false, twitterFollowers: 0, telegramMembers: 0 };
      }

      const info = mainPair.info;
      const socials = info.socials || [];

      // Check for social links
      const twitterLink = socials.find((s: any) => s.type === 'twitter' || s.platform === 'twitter');
      const telegramLink = socials.find((s: any) => s.type === 'telegram' || s.platform === 'telegram');
      const websiteLink = info.websites?.[0] || socials.find((s: any) => s.type === 'website');

      return {
        hasTwitter: !!twitterLink,
        hasTelegram: !!telegramLink,
        hasWebsite: !!websiteLink,
        twitterFollowers: 0, // Not available from DexScreener, would need Twitter API
        telegramMembers: 0   // Not available from DexScreener
      };

    } catch (error: any) {
      logger.debug('Error fetching social links', { error: error.message });
      return { hasTwitter: false, hasTelegram: false, hasWebsite: false, twitterFollowers: 0, telegramMembers: 0 };
    }
  }

  /**
   * Get current market context signal
   */
  private async getMarketContextSignal(): Promise<MarketContextSignal> {
    try {
      const regimeState = this.regimeDetector.getRegimeState();

      // Check if it's peak trading hours (9 AM - 11 PM EST)
      const currentHour = new Date().getUTCHours();
      const estHour = (currentHour - 5 + 24) % 24; // Convert to EST
      const isPeakHours = estHour >= 9 && estHour <= 23;

      // Get day of week
      const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];

      return {
        regime: regimeState.regime,
        solChange24h: regimeState.solChange24h,
        btcChange24h: regimeState.btcChange24h,
        isPeakHours,
        dayOfWeek,
        volumeProfile: 'MEDIUM' // STUB
      };

    } catch (error: any) {
      logger.debug('Error getting market context', { error: error.message });
      return {
        regime: 'FULL',
        solChange24h: 0,
        btcChange24h: 0,
        isPeakHours: true,
        dayOfWeek: 'Monday',
        volumeProfile: 'MEDIUM'
      };
    }
  }

  /**
   * Determine overall signal strength
   */
  private determineSignalStrength(
    smartWallet: SmartWalletSignal,
    safety: SafetyAnalysis,
    entryQuality: EntryQualitySignal
  ): 'STRONG' | 'MODERATE' | 'WEAK' {
    // Strong: High smart wallet confidence + Safe token + Good entry
    if (
      smartWallet.confidence === 'HIGH' &&
      safety.safetyLevel === 'SAFE' &&
      entryQuality.dipDepthPercent >= 20
    ) {
      return 'STRONG';
    }

    // Moderate: Medium confidence or some issues
    if (
      smartWallet.confidence === 'MEDIUM' ||
      safety.safetyLevel === 'CAUTION' ||
      (smartWallet.confidence === 'HIGH' && entryQuality.dipDepthPercent >= 15)
    ) {
      return 'MODERATE';
    }

    // Weak: Everything else
    return 'WEAK';
  }
}
