/**
 * Conviction Scorer
 *
 * Calculates a 0-100 conviction score from aggregated signals using weighted scoring:
 * - Smart Wallet Signal: 30% (default, adjustable by learning engine)
 * - Token Safety: 25%
 * - Market Conditions: 15%
 * - Social Signals: 10%
 * - Entry Quality: 20%
 *
 * The conviction score determines position sizing:
 * - 85-100: HIGH CONVICTION → Full position (4-5%)
 * - 70-84: MEDIUM CONVICTION → Reduced position (2-3%)
 * - 50-69: LOW CONVICTION → Minimum position (1%)
 * - Below 50: REJECT → No entry
 *
 * Weights are automatically adjusted by the Learning Engine based on what
 * actually predicts winning trades.
 */

import { logger } from '../utils/logger';
import { AggregatedSignal } from './signal-aggregator';
import { WeightOptimizer } from '../learning/weight-optimizer';
import { PatternMatcher } from '../learning/pattern-matcher';

export interface ConvictionScore {
  // Overall score
  totalScore: number; // 0-100
  convictionLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECT';

  // Component scores (before weighting)
  smartWalletScore: number; // 0-100
  safetyScore: number; // 0-100
  marketScore: number; // 0-100
  socialScore: number; // 0-100
  entryQualityScore: number; // 0-100

  // Weighted contributions
  smartWalletContribution: number;
  safetyContribution: number;
  marketContribution: number;
  socialContribution: number;
  entryQualityContribution: number;

  // Current weights (from learning engine)
  weights: {
    smartWallet: number;
    tokenSafety: number;
    marketConditions: number;
    socialSignals: number;
    entryQuality: number;
  };

  // Adjustments
  patternMatchAdjustment: number; // -15 to +5 from Learning Engine
  regimeAdjustment: number; // -10 to 0 based on market regime

  // Position sizing recommendation
  recommendedPositionPercent: number; // % of wallet
  shouldEnter: boolean;

  // Metadata
  timestamp: number;
  reasoning: string;
}

export class ConvictionScorer {
  private weightOptimizer: WeightOptimizer;
  private patternMatcher: PatternMatcher;

  constructor() {
    this.weightOptimizer = new WeightOptimizer();
    this.patternMatcher = new PatternMatcher();
  }

  /**
   * Calculate conviction score from aggregated signals
   */
  async calculateConviction(signal: AggregatedSignal): Promise<ConvictionScore> {
    logger.info(`📊 Calculating conviction for ${signal.tokenAddress.slice(0, 8)}...`);

    try {
      // Get current category weights (may have been adjusted by Learning Engine)
      const weights = await this.weightOptimizer.getCurrentWeights();

      // Calculate component scores (0-100 for each category)
      const smartWalletScore = this.scoreSmartWalletSignal(signal.smartWallet);
      const safetyScore = this.scoreSafety(signal.safety);
      const marketScore = this.scoreMarketConditions(signal.marketContext);
      const socialScore = this.scoreSocialSignals(signal.social);
      const entryQualityScore = this.scoreEntryQuality(signal.entryQuality);

      // Apply weights to get contributions
      const smartWalletContribution = smartWalletScore * weights.smartWallet;
      const safetyContribution = safetyScore * weights.tokenSafety;
      const marketContribution = marketScore * weights.marketConditions;
      const socialContribution = socialScore * weights.socialSignals;
      const entryQualityContribution = entryQualityScore * weights.entryQuality;

      // Calculate base score (sum of weighted contributions)
      const baseScore =
        smartWalletContribution +
        safetyContribution +
        marketContribution +
        socialContribution +
        entryQualityContribution;

      // Apply pattern matching adjustment from Learning Engine
      const patternMatchAdjustment = await this.getPatternMatchAdjustment(signal);

      // Apply market regime adjustment
      const regimeAdjustment = this.getRegimeAdjustment(signal.marketContext.regime);

      // Calculate final score
      let totalScore = baseScore + patternMatchAdjustment + regimeAdjustment;
      totalScore = Math.max(0, Math.min(100, totalScore)); // Clamp to 0-100

      // Determine conviction level and position sizing
      const { convictionLevel, positionPercent, shouldEnter } = this.determineConvictionLevel(
        totalScore,
        signal.marketContext.regime
      );

      // Generate reasoning
      const reasoning = this.generateReasoning(
        signal,
        smartWalletScore,
        safetyScore,
        convictionLevel
      );

      const convictionScore: ConvictionScore = {
        totalScore,
        convictionLevel,
        smartWalletScore,
        safetyScore,
        marketScore,
        socialScore,
        entryQualityScore,
        smartWalletContribution,
        safetyContribution,
        marketContribution,
        socialContribution,
        entryQualityContribution,
        weights,
        patternMatchAdjustment,
        regimeAdjustment,
        recommendedPositionPercent: positionPercent,
        shouldEnter,
        timestamp: Date.now(),
        reasoning
      };

      logger.info(`✅ Conviction calculated: ${totalScore.toFixed(1)} (${convictionLevel})`, {
        token: signal.tokenAddress.slice(0, 8),
        shouldEnter,
        positionSize: `${positionPercent}%`
      });

      return convictionScore;

    } catch (error: any) {
      logger.error('Error calculating conviction', {
        token: signal.tokenAddress,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Score smart wallet signal (0-100)
   */
  private scoreSmartWalletSignal(signal: any): number {
    let score = 0;

    // Wallet count and tier scoring
    if (signal.tier1Count >= 3) score += 40; // 3+ Tier 1 wallets
    else if (signal.tier1Count >= 2) score += 30;
    else if (signal.tier1Count >= 1) score += 20;

    if (signal.tier2Count >= 3) score += 20;
    else if (signal.tier2Count >= 2) score += 15;
    else if (signal.tier2Count >= 1) score += 10;

    if (signal.tier3Count >= 2) score += 10;
    else if (signal.tier3Count >= 1) score += 5;

    // Average wallet score bonus
    if (signal.avgWalletScore >= 80) score += 20;
    else if (signal.avgWalletScore >= 70) score += 15;
    else if (signal.avgWalletScore >= 60) score += 10;

    // Recency bonus (more recent = better)
    const minutesSinceEntry = (Date.now() - signal.mostRecentEntry) / 60000;
    if (minutesSinceEntry < 10) score += 10;
    else if (minutesSinceEntry < 30) score += 5;

    return Math.min(100, score);
  }

  /**
   * Score token safety (0-100)
   */
  private scoreSafety(safety: any): number {
    // Safety score is already 0-100 from Safety Scorer
    return safety.overallScore;
  }

  /**
   * Score market conditions (0-100)
   */
  private scoreMarketConditions(market: any): number {
    let score = 50; // Start at neutral

    // Regime scoring
    if (market.regime === 'FULL') score += 25;
    else if (market.regime === 'CAUTIOUS') score += 10;
    else if (market.regime === 'DEFENSIVE') score += 0;
    else if (market.regime === 'PAUSE') score -= 50; // Should reject anyway

    // SOL trend scoring
    if (market.solChange24h > 5) score += 15;
    else if (market.solChange24h > 0) score += 10;
    else if (market.solChange24h > -3) score += 5;
    else if (market.solChange24h < -10) score -= 20;

    // Peak hours bonus
    if (market.isPeakHours) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Score social signals (0-100)
   */
  private scoreSocialSignals(social: any): number {
    let score = 0;

    // Has socials
    if (social.hasTwitter) score += 15;
    if (social.hasTelegram) score += 10;
    if (social.hasWebsite) score += 5;

    // Followers (scaled)
    if (social.twitterFollowers > 10000) score += 20;
    else if (social.twitterFollowers > 5000) score += 15;
    else if (social.twitterFollowers > 1000) score += 10;
    else if (social.twitterFollowers > 100) score += 5;

    // Mention velocity (organic growth indicator)
    if (social.mentionVelocity > 50 && !social.isCoordinated) score += 20;
    else if (social.mentionVelocity > 20 && !social.isCoordinated) score += 15;
    else if (social.mentionVelocity > 10) score += 10;

    // Penalties
    if (social.influencerCalls > 2) score -= 20; // Too many influencers = probably late
    if (social.isCoordinated) score -= 30; // Coordinated pump

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Score entry quality (0-100)
   */
  private scoreEntryQuality(entry: any): number {
    let score = 0;

    // Dip depth scoring (20-30% is optimal)
    if (entry.dipDepthPercent >= 25 && entry.dipDepthPercent <= 35) score += 30;
    else if (entry.dipDepthPercent >= 20 && entry.dipDepthPercent <= 40) score += 25;
    else if (entry.dipDepthPercent >= 15 && entry.dipDepthPercent <= 45) score += 15;
    else if (entry.dipDepthPercent < 10) score += 5; // Too early
    else if (entry.dipDepthPercent > 50) score -= 10; // Too late/risky

    // Distance from ATH (not buying near ATH)
    if (entry.distanceFromATHPercent > 50) score += 20;
    else if (entry.distanceFromATHPercent > 30) score += 15;
    else if (entry.distanceFromATHPercent > 20) score += 10;
    else if (entry.distanceFromATHPercent < 10) score -= 20; // Near ATH = risky

    // Token age (not too new, not too old)
    if (entry.tokenAgeMinutes > 30 && entry.tokenAgeMinutes < 240) score += 20;
    else if (entry.tokenAgeMinutes > 10 && entry.tokenAgeMinutes < 480) score += 10;
    else if (entry.tokenAgeMinutes < 10) score += 5; // Very new = risky

    // Buy/sell ratio
    if (entry.buyToSellRatio > 2.0) score += 15;
    else if (entry.buyToSellRatio > 1.5) score += 10;
    else if (entry.buyToSellRatio < 0.8) score -= 15;

    // Hype phase
    if (entry.hypePhase === 'DISCOVERY') score += 15;
    else if (entry.hypePhase === 'EARLY_FOMO') score += 5;
    else if (entry.hypePhase === 'PEAK_FOMO') score -= 20;
    else if (entry.hypePhase === 'DISTRIBUTION' || entry.hypePhase === 'DUMP') score -= 30;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get pattern matching adjustment from Learning Engine
   */
  private async getPatternMatchAdjustment(signal: AggregatedSignal): Promise<number> {
    try {
      // Create fingerprint from current signal
      const fingerprint = await this.patternMatcher.createFingerprint({
        tokenAddress: signal.tokenAddress,
        convictionScore: 0 // Will be calculated
      });

      // Find similar past trades
      const similarTrades = await this.patternMatcher.findSimilarTrades(fingerprint);

      // Get adjustment based on historical performance
      return this.patternMatcher.getPatternMatchAdjustment(similarTrades);

    } catch (error: any) {
      logger.debug('Error getting pattern match adjustment', { error: error.message });
      return 0; // No adjustment on error
    }
  }

  /**
   * Get market regime adjustment
   */
  private getRegimeAdjustment(regime: string): number {
    switch (regime) {
      case 'FULL': return 0;
      case 'CAUTIOUS': return -5;
      case 'DEFENSIVE': return -10;
      case 'PAUSE': return -20;
      default: return 0;
    }
  }

  /**
   * Determine conviction level and position sizing from score
   */
  private determineConvictionLevel(
    score: number,
    regime: string
  ): { convictionLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECT'; positionPercent: number; shouldEnter: boolean } {
    // Adjust thresholds based on market regime
    let highThreshold = 85;
    let mediumThreshold = 70;
    let lowThreshold = 50;

    if (regime === 'CAUTIOUS') {
      highThreshold = 90;
      mediumThreshold = 75;
      lowThreshold = 60;
    } else if (regime === 'DEFENSIVE') {
      highThreshold = 95;
      mediumThreshold = 85;
      lowThreshold = 70;
    }

    // Determine level and position size
    if (score >= highThreshold) {
      const positionPercent = regime === 'FULL' ? 5 : regime === 'CAUTIOUS' ? 2.5 : 1;
      return { convictionLevel: 'HIGH', positionPercent, shouldEnter: true };
    } else if (score >= mediumThreshold) {
      const positionPercent = regime === 'FULL' ? 3 : regime === 'CAUTIOUS' ? 1.5 : 1;
      return { convictionLevel: 'MEDIUM', positionPercent, shouldEnter: true };
    } else if (score >= lowThreshold) {
      const positionPercent = regime === 'FULL' ? 1 : 0.5;
      return { convictionLevel: 'LOW', positionPercent, shouldEnter: regime === 'FULL' };
    } else {
      return { convictionLevel: 'REJECT', positionPercent: 0, shouldEnter: false };
    }
  }

  /**
   * Generate human-readable reasoning for the conviction score
   */
  private generateReasoning(
    signal: AggregatedSignal,
    smartWalletScore: number,
    safetyScore: number,
    convictionLevel: string
  ): string {
    const reasons: string[] = [];

    // Smart wallet reasons
    if (signal.smartWallet.tier1Count >= 3) {
      reasons.push(`${signal.smartWallet.tier1Count} Tier 1 smart wallets entered`);
    } else if (signal.smartWallet.walletCount === 0) {
      reasons.push('No smart wallet activity detected');
    }

    // Safety reasons
    if (signal.safety.isHardRejected) {
      reasons.push(`HARD REJECT: ${signal.safety.rejectReason}`);
    } else if (safetyScore >= 85) {
      reasons.push('Token passes all safety checks');
    } else if (safetyScore < 50) {
      reasons.push('Token has safety concerns');
    }

    // Entry quality reasons
    if (signal.entryQuality.dipDepthPercent >= 20) {
      reasons.push(`Good entry: ${signal.entryQuality.dipDepthPercent.toFixed(0)}% dip`);
    } else if (signal.entryQuality.dipDepthPercent < 10) {
      reasons.push('No significant dip detected');
    }

    // Market regime
    if (signal.marketContext.regime !== 'FULL') {
      reasons.push(`Market regime: ${signal.marketContext.regime}`);
    }

    return reasons.join('; ');
  }
}
