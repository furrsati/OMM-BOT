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
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { WalletManager } from '../discovery';
import { SafetyScorer, SafetyAnalysis } from '../safety';
import { PriceFeed, RegimeDetector } from '../market';
import { OnChainSocialIntelligence } from '../social/on-chain-social-intelligence';
import { HypeDetector } from '../social/hype-detector';

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
    this.hypeDetector = new HypeDetector();
  }

  /**
   * Aggregate all signals for a token into a single comprehensive signal object
   */
  async aggregateSignals(
    tokenAddress: string,
    tokenName?: string,
    tokenSymbol?: string
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
        this.getSmartWalletSignal(tokenAddress),
        this.safetyScorer.analyze(tokenAddress),
        this.getEntryQualitySignal(tokenAddress),
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
        safetyScore: safetyAnalysis.overallScore
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
   */
  private async getSmartWalletSignal(tokenAddress: string): Promise<SmartWalletSignal> {
    try {
      // Get all smart wallets that hold this token
      const watchlist = this.walletManager.getWatchlist();

      // STUB: In production, check on-chain which wallets actually hold this token
      // For now, simulate with empty data
      const holdingWallets: any[] = [];

      const tier1Wallets = holdingWallets.filter(w => w.tier === 1);
      const tier2Wallets = holdingWallets.filter(w => w.tier === 2);
      const tier3Wallets = holdingWallets.filter(w => w.tier === 3);

      const avgScore = holdingWallets.length > 0
        ? holdingWallets.reduce((sum, w) => sum + w.score, 0) / holdingWallets.length
        : 0;

      let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (tier1Wallets.length >= 3) confidence = 'HIGH';
      else if (tier1Wallets.length >= 2 || tier2Wallets.length >= 3) confidence = 'MEDIUM';

      return {
        walletCount: holdingWallets.length,
        tier1Count: tier1Wallets.length,
        tier2Count: tier2Wallets.length,
        tier3Count: tier3Wallets.length,
        avgWalletScore: avgScore,
        firstEntryTime: holdingWallets.length > 0 ? Date.now() - 3600000 : 0, // STUB
        mostRecentEntry: holdingWallets.length > 0 ? Date.now() - 300000 : 0, // STUB
        confidence
      };

    } catch (error: any) {
      logger.debug('Error getting smart wallet signal', { error: error.message });
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
   * Get entry quality signal for a token
   */
  private async getEntryQualitySignal(tokenAddress: string): Promise<EntryQualitySignal> {
    try {
      // Get price data from price feed
      const priceData = await this.priceFeed.getPrice(tokenAddress);

      // STUB: In production, fetch real price history and calculate these
      const currentPrice = priceData?.priceUSD || 0;
      const localHigh = currentPrice * 1.3; // STUB: 30% higher
      const allTimeHigh = currentPrice * 2.0; // STUB: 2x higher

      const dipDepth = ((localHigh - currentPrice) / localHigh) * 100;
      const distanceFromATH = ((allTimeHigh - currentPrice) / allTimeHigh) * 100;

      // Determine hype phase based on holder growth and volume
      let hypePhase: 'DISCOVERY' | 'EARLY_FOMO' | 'PEAK_FOMO' | 'DISTRIBUTION' | 'DUMP' = 'DISCOVERY';
      const holderGrowthRate = 5; // STUB: 5% growth per hour

      if (holderGrowthRate > 20) hypePhase = 'PEAK_FOMO';
      else if (holderGrowthRate > 10) hypePhase = 'EARLY_FOMO';
      else if (holderGrowthRate < -10) hypePhase = 'DUMP';
      else if (holderGrowthRate < 0) hypePhase = 'DISTRIBUTION';

      return {
        currentPrice,
        localHigh,
        allTimeHigh,
        dipDepthPercent: dipDepth,
        distanceFromATHPercent: distanceFromATH,
        tokenAgeMinutes: 60, // STUB: 1 hour old
        volumeTrend: 'STABLE',
        buyToSellRatio: 1.5, // STUB: More buys than sells
        holderCount: 500, // STUB
        holderGrowthRate,
        hypePhase
      };

    } catch (error: any) {
      logger.debug('Error getting entry quality signal', { error: error.message });
      throw error;
    }
  }

  /**
   * Get social signal for a token
   */
  private async getSocialSignal(tokenAddress: string): Promise<SocialSignal> {
    try {
      // STUB: In production, fetch real social data
      return {
        hasTwitter: true, // STUB
        hasTelegram: false,
        hasWebsite: false,
        twitterFollowers: 1000, // STUB
        telegramMembers: 0,
        mentionVelocity: 5, // STUB: 5 mentions per hour
        sentimentScore: 60, // STUB: Neutral-positive
        influencerCalls: 0,
        isCoordinated: false
      };

    } catch (error: any) {
      logger.debug('Error getting social signal', { error: error.message });
      return {
        hasTwitter: false,
        hasTelegram: false,
        hasWebsite: false,
        twitterFollowers: 0,
        telegramMembers: 0,
        mentionVelocity: 0,
        sentimentScore: 50,
        influencerCalls: 0,
        isCoordinated: false
      };
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
