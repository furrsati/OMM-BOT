import { logger } from '../utils/logger';
import { query } from '../db/postgres';
import type { Trade, TradeFingerprint } from '../types';

/**
 * LEARNING ENGINE - LEVEL 3: PARAMETER TUNING
 *
 * "Learn the optimal numbers"
 *
 * This module optimizes numerical trading parameters based on historical
 * performance data. It adjusts entry thresholds, exit levels, position sizes,
 * and timing windows to find optimal values.
 *
 * From CLAUDE.MD Category 15:
 * "Track optimal DIP DEPTH for entries, SMART WALLET COUNT threshold,
 * TAKE-PROFIT LEVELS, STOP-LOSS LEVELS, POSITION SIZES, etc."
 */

interface ParameterAnalysis {
  parameter: string;
  currentValue: number | { min: number; max: number };
  optimalValue: number | { min: number; max: number };
  confidence: number;
  sampleSize: number;
  avgReturnAtOptimal: number;
  winRateAtOptimal: number;
  recommendation: 'increase' | 'decrease' | 'keep' | 'widen' | 'narrow';
}

interface BucketStats {
  bucket: string;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
}

// Default parameters from CLAUDE.MD
const DEFAULT_PARAMETERS = {
  dipEntryRange: { min: 20, max: 30 },
  smartWalletCountThreshold: 2, // LOWERED from 3 for limited wallet pool
  tokenAgeMin: 10, // minutes
  tokenAgeMax: 240, // minutes
  stopLossPercent: 25,
  earlyDiscoveryStopLoss: 15,
  trailingStopDistances: { tier1: 15, tier2: 12, tier3: 10 },
  takeProfitLevels: [
    { target: 30, sellPercent: 20 },
    { target: 60, sellPercent: 25 },
    { target: 100, sellPercent: 25 },
    { target: 200, sellPercent: 15 }
  ],
  timeBasedStopHours: 4,
  positionSizes: { high: 5, medium: 3, low: 1 },
  marketRegimeThresholds: {
    cautious: 3, // SOL down 3%
    defensive: 7, // SOL down 7%
    pause: 15    // SOL down 15%
  },
  peakTradingHours: { start: 9, end: 23 } // EST
};

// Hard limits for safety
const PARAMETER_LIMITS = {
  stopLossPercent: { min: 12, max: 35 },
  trailingStop: { min: 5, max: 20 },
  takeProfitTarget: { min: 15, max: 300 },
  positionSize: { min: 0.5, max: 5 },
  dipEntryRange: { min: 10, max: 50 },
  timeBasedStop: { min: 2, max: 8 },
  maxAdjustmentPerCycle: 2 // Max 2% or 2 units per cycle
};

export class ParameterTuner {
  private readonly MIN_TRADES_FOR_TUNING = 30;
  private readonly MAX_ADJUSTMENT_PER_CYCLE = PARAMETER_LIMITS.maxAdjustmentPerCycle;

  /**
   * Optimize entry parameters
   */
  async optimizeEntryParameters(trades: Trade[]): Promise<ParameterAnalysis[]> {
    logger.info('🎯 Optimizing entry parameters', {
      tradeCount: trades.length
    });

    if (trades.length < this.MIN_TRADES_FOR_TUNING) {
      logger.warn('Insufficient trades for entry optimization');
      return [];
    }

    const analyses: ParameterAnalysis[] = [];

    // Optimize dip depth
    const dipAnalysis = await this.optimizeDipDepth(trades);
    if (dipAnalysis) analyses.push(dipAnalysis);

    // Optimize smart wallet count threshold
    const walletAnalysis = await this.optimizeWalletCountThreshold(trades);
    if (walletAnalysis) analyses.push(walletAnalysis);

    // Optimize token age
    const ageAnalysis = await this.optimizeTokenAge(trades);
    if (ageAnalysis) analyses.push(ageAnalysis);

    return analyses;
  }

  /**
   * Optimize dip depth entry range
   */
  private async optimizeDipDepth(trades: Trade[]): Promise<ParameterAnalysis | null> {
    logger.debug('Analyzing optimal dip depth');

    // Get current parameters
    const currentParams = await this.getCurrentParameters();
    const currentRange = currentParams.dipEntryRange || DEFAULT_PARAMETERS.dipEntryRange;

    // Bucket trades by dip depth
    const buckets: Record<string, BucketStats> = {};
    const bucketSize = 5; // 5% buckets

    for (const trade of trades) {
      const dipDepth = trade.fingerprint?.entryQuality?.dipDepth || 0;
      const bucketKey = `${Math.floor(dipDepth / bucketSize) * bucketSize}-${Math.floor(dipDepth / bucketSize) * bucketSize + bucketSize}`;

      if (!buckets[bucketKey]) {
        buckets[bucketKey] = {
          bucket: bucketKey,
          count: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          avgReturn: 0,
          totalReturn: 0
        };
      }

      buckets[bucketKey].count++;
      if (trade.outcome === 'WIN') {
        buckets[bucketKey].wins++;
      } else if (trade.outcome === 'LOSS' || trade.outcome === 'RUG') {
        buckets[bucketKey].losses++;
      }
      buckets[bucketKey].totalReturn += trade.profitLossPercent || 0;
    }

    // Calculate stats per bucket
    for (const key of Object.keys(buckets)) {
      const bucket = buckets[key];
      bucket.winRate = bucket.wins / Math.max(1, bucket.count);
      bucket.avgReturn = bucket.totalReturn / Math.max(1, bucket.count);
    }

    // Find optimal bucket (highest risk-adjusted return)
    const sortedBuckets = Object.values(buckets)
      .filter(b => b.count >= 5) // Minimum sample size
      .sort((a, b) => {
        // Score = winRate * avgReturn (risk-adjusted)
        const scoreA = a.winRate * Math.max(0, a.avgReturn);
        const scoreB = b.winRate * Math.max(0, b.avgReturn);
        return scoreB - scoreA;
      });

    if (sortedBuckets.length === 0) {
      return null;
    }

    const optimalBucket = sortedBuckets[0];
    const [optMin, optMax] = optimalBucket.bucket.split('-').map(Number);

    // Calculate adjustment (limited by MAX_ADJUSTMENT_PER_CYCLE)
    const newMin = this.limitAdjustment(
      currentRange.min,
      optMin,
      PARAMETER_LIMITS.dipEntryRange.min,
      PARAMETER_LIMITS.dipEntryRange.max - 10
    );
    const newMax = this.limitAdjustment(
      currentRange.max,
      optMax,
      PARAMETER_LIMITS.dipEntryRange.min + 10,
      PARAMETER_LIMITS.dipEntryRange.max
    );

    const recommendation = this.determineRangeRecommendation(
      currentRange,
      { min: newMin, max: newMax }
    );

    return {
      parameter: 'dipEntryRange',
      currentValue: currentRange,
      optimalValue: { min: newMin, max: newMax },
      confidence: Math.min(1, sortedBuckets[0].count / 20),
      sampleSize: trades.length,
      avgReturnAtOptimal: optimalBucket.avgReturn,
      winRateAtOptimal: optimalBucket.winRate,
      recommendation
    };
  }

  /**
   * Optimize smart wallet count threshold
   */
  private async optimizeWalletCountThreshold(trades: Trade[]): Promise<ParameterAnalysis | null> {
    logger.debug('Analyzing optimal wallet count threshold');

    const currentParams = await this.getCurrentParameters();
    const currentThreshold = currentParams.smartWalletCountThreshold || DEFAULT_PARAMETERS.smartWalletCountThreshold;

    // Bucket trades by wallet count
    const buckets: Record<number, BucketStats> = {};

    for (const trade of trades) {
      const walletCount = trade.fingerprint?.smartWallets?.count || 0;

      if (!buckets[walletCount]) {
        buckets[walletCount] = {
          bucket: String(walletCount),
          count: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          avgReturn: 0,
          totalReturn: 0
        };
      }

      buckets[walletCount].count++;
      if (trade.outcome === 'WIN') {
        buckets[walletCount].wins++;
      } else if (trade.outcome === 'LOSS' || trade.outcome === 'RUG') {
        buckets[walletCount].losses++;
      }
      buckets[walletCount].totalReturn += trade.profitLossPercent || 0;
    }

    // Calculate stats
    for (const key of Object.keys(buckets)) {
      const bucket = buckets[Number(key)];
      bucket.winRate = bucket.wins / Math.max(1, bucket.count);
      bucket.avgReturn = bucket.totalReturn / Math.max(1, bucket.count);
    }

    // Find minimum wallet count that maintains good win rate
    // (We want to enter early but not too early)
    let optimalThreshold = currentThreshold;
    let bestScore = 0;

    for (let threshold = 1; threshold <= 5; threshold++) {
      // Calculate aggregate stats for trades with >= threshold wallets
      let totalWins = 0;
      let totalReturn = 0;
      let totalCount = 0;

      for (const [count, stats] of Object.entries(buckets)) {
        if (Number(count) >= threshold) {
          totalWins += stats.wins;
          totalReturn += stats.totalReturn;
          totalCount += stats.count;
        }
      }

      if (totalCount < 5) continue;

      const winRate = totalWins / Math.max(1, totalCount);
      const avgReturn = totalReturn / Math.max(1, totalCount);
      const score = winRate * Math.max(0, avgReturn) * Math.log(totalCount + 1); // Volume bonus

      if (score > bestScore) {
        bestScore = score;
        optimalThreshold = threshold;
      }
    }

    const newThreshold = this.limitAdjustment(currentThreshold, optimalThreshold, 2, 5);
    const recommendation = newThreshold > currentThreshold ? 'increase' :
      newThreshold < currentThreshold ? 'decrease' : 'keep';

    const optimalStats = buckets[optimalThreshold] || { winRate: 0, avgReturn: 0, count: 0 };

    return {
      parameter: 'smartWalletCountThreshold',
      currentValue: currentThreshold,
      optimalValue: newThreshold,
      confidence: Math.min(1, Object.values(buckets).reduce((s, b) => s + b.count, 0) / 50),
      sampleSize: trades.length,
      avgReturnAtOptimal: optimalStats.avgReturn,
      winRateAtOptimal: optimalStats.winRate,
      recommendation
    };
  }

  /**
   * Optimize token age at entry
   */
  private async optimizeTokenAge(trades: Trade[]): Promise<ParameterAnalysis | null> {
    logger.debug('Analyzing optimal token age');

    const currentParams = await this.getCurrentParameters();
    const currentMin = currentParams.tokenAgeMin || DEFAULT_PARAMETERS.tokenAgeMin;

    // Bucket trades by token age (in minutes)
    const buckets: Record<string, BucketStats> = {
      '0-30': { bucket: '0-30', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      '30-60': { bucket: '30-60', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      '60-120': { bucket: '60-120', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      '120-240': { bucket: '120-240', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      '240+': { bucket: '240+', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 }
    };

    for (const trade of trades) {
      const tokenAge = trade.fingerprint?.entryQuality?.tokenAge || 0;

      let bucketKey: string;
      if (tokenAge < 30) bucketKey = '0-30';
      else if (tokenAge < 60) bucketKey = '30-60';
      else if (tokenAge < 120) bucketKey = '60-120';
      else if (tokenAge < 240) bucketKey = '120-240';
      else bucketKey = '240+';

      buckets[bucketKey].count++;
      if (trade.outcome === 'WIN') {
        buckets[bucketKey].wins++;
      } else if (trade.outcome === 'LOSS' || trade.outcome === 'RUG') {
        buckets[bucketKey].losses++;
      }
      buckets[bucketKey].totalReturn += trade.profitLossPercent || 0;
    }

    // Calculate stats
    for (const key of Object.keys(buckets)) {
      const bucket = buckets[key];
      bucket.winRate = bucket.wins / Math.max(1, bucket.count);
      bucket.avgReturn = bucket.totalReturn / Math.max(1, bucket.count);
    }

    // Find optimal bucket
    const sortedBuckets = Object.values(buckets)
      .filter(b => b.count >= 3)
      .sort((a, b) => {
        const scoreA = a.winRate * Math.max(0, a.avgReturn);
        const scoreB = b.winRate * Math.max(0, b.avgReturn);
        return scoreB - scoreA;
      });

    if (sortedBuckets.length === 0) return null;

    const optimalBucket = sortedBuckets[0];
    const optimalMin = parseInt(optimalBucket.bucket.split('-')[0]) || 0;

    const newMin = this.limitAdjustment(currentMin, optimalMin, 5, 60);
    const recommendation = newMin > currentMin ? 'increase' :
      newMin < currentMin ? 'decrease' : 'keep';

    return {
      parameter: 'tokenAgeMin',
      currentValue: currentMin,
      optimalValue: newMin,
      confidence: Math.min(1, sortedBuckets[0].count / 15),
      sampleSize: trades.length,
      avgReturnAtOptimal: optimalBucket.avgReturn,
      winRateAtOptimal: optimalBucket.winRate,
      recommendation
    };
  }

  /**
   * Optimize exit parameters (stop-loss, take-profit, trailing)
   */
  async optimizeExitParameters(trades: Trade[]): Promise<ParameterAnalysis[]> {
    logger.info('📤 Optimizing exit parameters', {
      tradeCount: trades.length
    });

    if (trades.length < this.MIN_TRADES_FOR_TUNING) {
      return [];
    }

    const analyses: ParameterAnalysis[] = [];

    // Optimize stop-loss
    const stopLossAnalysis = await this.optimizeStopLossLevels(trades);
    if (stopLossAnalysis) analyses.push(stopLossAnalysis);

    // Optimize take-profit
    const takeProfitAnalysis = await this.optimizeTakeProfitLevels(trades);
    analyses.push(...takeProfitAnalysis);

    // Optimize time-based stop
    const timeStopAnalysis = await this.optimizeTimeBasedStop(trades);
    if (timeStopAnalysis) analyses.push(timeStopAnalysis);

    return analyses;
  }

  /**
   * Optimize stop-loss levels based on recovery rate analysis
   */
  private async optimizeStopLossLevels(trades: Trade[]): Promise<ParameterAnalysis | null> {
    logger.debug('Analyzing optimal stop-loss levels');

    const currentParams = await this.getCurrentParameters();
    const currentStopLoss = currentParams.stopLossPercent || DEFAULT_PARAMETERS.stopLossPercent;

    // Find trades that hit stop loss
    const stopLossTrades = trades.filter(t =>
      t.exitReason === 'stop_loss' || t.exitReason === 'trailing_stop'
    );

    if (stopLossTrades.length < 10) {
      return null;
    }

    // Calculate recovery rate: how often would price have recovered if we held longer?
    // We approximate this by looking at the distribution of loss percentages
    const lossPercentages = stopLossTrades
      .map(t => Math.abs(t.profitLossPercent || 0))
      .sort((a, b) => a - b);

    // If many stops triggered at close to the stop level, it might be too tight
    const avgLoss = lossPercentages.reduce((s, l) => s + l, 0) / lossPercentages.length;
    void avgLoss; // Used for analysis context

    // Count trades that stopped out very close to the stop level
    const tightStops = stopLossTrades.filter(t => {
      const loss = Math.abs(t.profitLossPercent || 0);
      return loss >= currentStopLoss - 2 && loss <= currentStopLoss + 2;
    }).length;

    const tightStopRate = tightStops / stopLossTrades.length;

    // If more than 40% of stops trigger right at the level, might be too tight
    // If less than 10%, might be too loose
    let newStopLoss = currentStopLoss;
    let recommendation: 'increase' | 'decrease' | 'keep' = 'keep';

    if (tightStopRate > 0.4) {
      // Stop might be too tight - widen
      newStopLoss = Math.min(
        currentStopLoss + this.MAX_ADJUSTMENT_PER_CYCLE,
        PARAMETER_LIMITS.stopLossPercent.max
      );
      recommendation = 'increase';
    } else if (tightStopRate < 0.1 && avgLoss < currentStopLoss - 5) {
      // Stop might be too loose - tighten
      newStopLoss = Math.max(
        currentStopLoss - this.MAX_ADJUSTMENT_PER_CYCLE,
        PARAMETER_LIMITS.stopLossPercent.min
      );
      recommendation = 'decrease';
    }

    return {
      parameter: 'stopLossPercent',
      currentValue: currentStopLoss,
      optimalValue: newStopLoss,
      confidence: Math.min(1, stopLossTrades.length / 30),
      sampleSize: stopLossTrades.length,
      avgReturnAtOptimal: -avgLoss,
      winRateAtOptimal: 1 - tightStopRate, // Inverse of tight stop rate
      recommendation
    };
  }

  /**
   * Optimize take-profit levels
   */
  private async optimizeTakeProfitLevels(trades: Trade[]): Promise<ParameterAnalysis[]> {
    logger.debug('Analyzing optimal take-profit levels');

    const analyses: ParameterAnalysis[] = [];
    const currentParams = await this.getCurrentParameters();
    const currentLevels = currentParams.takeProfitLevels || DEFAULT_PARAMETERS.takeProfitLevels;

    // Find winning trades
    const winningTrades = trades.filter(t => t.outcome === 'WIN');

    if (winningTrades.length < 10) {
      return [];
    }

    // Analyze max profit reached by each trade
    const profitDistribution = winningTrades
      .map(t => t.profitLossPercent || 0)
      .sort((a, b) => b - a);

    // Percentiles available for future detailed analysis:
    // p25, p50, p75, p90 of profit distribution

    // Analyze each take-profit level
    for (let i = 0; i < currentLevels.length; i++) {
      const level = currentLevels[i];
      const tradesReachingLevel = winningTrades.filter(t =>
        (t.profitLossPercent || 0) >= level.target
      ).length;

      const reachRate = tradesReachingLevel / winningTrades.length;

      // Optimal target: reached by ~50-70% of winning trades
      let newTarget = level.target;
      let recommendation: 'increase' | 'decrease' | 'keep' = 'keep';

      if (reachRate > 0.8) {
        // Target too low - increase
        newTarget = Math.min(
          level.target + 10,
          PARAMETER_LIMITS.takeProfitTarget.max
        );
        recommendation = 'increase';
      } else if (reachRate < 0.3 && i > 0) {
        // Target too high - decrease (except first level)
        newTarget = Math.max(
          level.target - 10,
          currentLevels[i - 1]?.target + 10 || PARAMETER_LIMITS.takeProfitTarget.min
        );
        recommendation = 'decrease';
      }

      analyses.push({
        parameter: `takeProfitLevel_${i + 1}`,
        currentValue: level.target,
        optimalValue: newTarget,
        confidence: Math.min(1, winningTrades.length / 30),
        sampleSize: winningTrades.length,
        avgReturnAtOptimal: profitDistribution.filter(p => p >= newTarget).reduce((s, p) => s + p, 0) /
          Math.max(1, profitDistribution.filter(p => p >= newTarget).length),
        winRateAtOptimal: reachRate,
        recommendation
      });
    }

    return analyses;
  }

  /**
   * Optimize time-based stop duration
   */
  private async optimizeTimeBasedStop(trades: Trade[]): Promise<ParameterAnalysis | null> {
    logger.debug('Analyzing optimal time-based stop duration');

    const currentParams = await this.getCurrentParameters();
    const currentHours = currentParams.timeBasedStopHours || DEFAULT_PARAMETERS.timeBasedStopHours;

    // Analyze all trades by duration
    const tradesByDuration: Record<string, BucketStats> = {
      '0-2h': { bucket: '0-2h', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      '2-4h': { bucket: '2-4h', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      '4-6h': { bucket: '4-6h', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      '6-8h': { bucket: '6-8h', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      '8h+': { bucket: '8h+', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 }
    };

    for (const trade of trades) {
      if (!trade.exitTime || !trade.entryTime) continue;

      const durationHours = (new Date(trade.exitTime).getTime() - new Date(trade.entryTime).getTime()) / (1000 * 60 * 60);

      let bucketKey: string;
      if (durationHours < 2) bucketKey = '0-2h';
      else if (durationHours < 4) bucketKey = '2-4h';
      else if (durationHours < 6) bucketKey = '4-6h';
      else if (durationHours < 8) bucketKey = '6-8h';
      else bucketKey = '8h+';

      tradesByDuration[bucketKey].count++;
      if (trade.outcome === 'WIN') {
        tradesByDuration[bucketKey].wins++;
      } else {
        tradesByDuration[bucketKey].losses++;
      }
      tradesByDuration[bucketKey].totalReturn += trade.profitLossPercent || 0;
    }

    // Calculate stats
    for (const key of Object.keys(tradesByDuration)) {
      const bucket = tradesByDuration[key];
      bucket.winRate = bucket.wins / Math.max(1, bucket.count);
      bucket.avgReturn = bucket.totalReturn / Math.max(1, bucket.count);
    }

    // Find optimal cutoff - where holding longer starts to hurt
    const bucketOrder = ['0-2h', '2-4h', '4-6h', '6-8h', '8h+'];
    let optimalHours = currentHours;
    let bestWinRate = 0;

    for (let i = 0; i < bucketOrder.length - 1; i++) {
      const bucket = tradesByDuration[bucketOrder[i]];
      if (bucket.count >= 5 && bucket.winRate > bestWinRate) {
        bestWinRate = bucket.winRate;
        optimalHours = [2, 4, 6, 8, 10][i];
      }
    }

    const newHours = this.limitAdjustment(
      currentHours,
      optimalHours,
      PARAMETER_LIMITS.timeBasedStop.min,
      PARAMETER_LIMITS.timeBasedStop.max
    );

    const recommendation = newHours > currentHours ? 'increase' :
      newHours < currentHours ? 'decrease' : 'keep';

    return {
      parameter: 'timeBasedStopHours',
      currentValue: currentHours,
      optimalValue: newHours,
      confidence: Math.min(1, trades.length / 50),
      sampleSize: trades.length,
      avgReturnAtOptimal: 0,
      winRateAtOptimal: bestWinRate,
      recommendation
    };
  }

  /**
   * Optimize position sizing using Kelly Criterion approximation
   */
  async optimizePositionSizes(trades: Trade[]): Promise<ParameterAnalysis[]> {
    logger.info('💰 Optimizing position sizes', {
      tradeCount: trades.length
    });

    if (trades.length < this.MIN_TRADES_FOR_TUNING) {
      return [];
    }

    const analyses: ParameterAnalysis[] = [];
    const currentParams = await this.getCurrentParameters();
    const currentSizes = currentParams.positionSizes || DEFAULT_PARAMETERS.positionSizes;

    // Calculate overall win rate and avg win/loss
    const wins = trades.filter(t => t.outcome === 'WIN');
    const losses = trades.filter(t => t.outcome === 'LOSS' || t.outcome === 'RUG');

    const winRate = wins.length / Math.max(1, trades.length);
    const avgWin = wins.length > 0
      ? wins.reduce((s, t) => s + (t.profitLossPercent || 0), 0) / wins.length
      : 0;
    const avgLoss = losses.length > 0
      ? Math.abs(losses.reduce((s, t) => s + (t.profitLossPercent || 0), 0) / losses.length)
      : 25;

    // Kelly Criterion: f* = (bp - q) / b
    // where b = odds (avgWin/avgLoss), p = win probability, q = 1 - p
    const b = avgWin / Math.max(1, avgLoss);
    const kellyFraction = (b * winRate - (1 - winRate)) / Math.max(0.01, b);

    // Use half-Kelly for safety
    const halfKelly = Math.max(0.5, Math.min(5, kellyFraction * 0.5 * 100));

    // Optimize each conviction tier
    const tiers: Array<{ name: 'high' | 'medium' | 'low'; factor: number }> = [
      { name: 'high', factor: 1.0 },
      { name: 'medium', factor: 0.6 },
      { name: 'low', factor: 0.3 }
    ];

    for (const tier of tiers) {
      const currentSize = currentSizes[tier.name];
      const optimalSize = Math.min(
        PARAMETER_LIMITS.positionSize.max,
        Math.max(
          PARAMETER_LIMITS.positionSize.min,
          halfKelly * tier.factor
        )
      );

      const newSize = this.limitAdjustment(
        currentSize,
        optimalSize,
        PARAMETER_LIMITS.positionSize.min,
        PARAMETER_LIMITS.positionSize.max
      );

      const recommendation = newSize > currentSize ? 'increase' :
        newSize < currentSize ? 'decrease' : 'keep';

      analyses.push({
        parameter: `positionSize_${tier.name}`,
        currentValue: currentSize,
        optimalValue: Math.round(newSize * 10) / 10,
        confidence: Math.min(1, trades.length / 50),
        sampleSize: trades.length,
        avgReturnAtOptimal: avgWin,
        winRateAtOptimal: winRate,
        recommendation
      });
    }

    return analyses;
  }

  /**
   * Optimize market regime thresholds
   */
  async optimizeMarketRegimeThresholds(trades: Trade[]): Promise<ParameterAnalysis[]> {
    logger.info('📊 Optimizing market regime thresholds', {
      tradeCount: trades.length
    });

    if (trades.length < this.MIN_TRADES_FOR_TUNING) {
      return [];
    }

    const analyses: ParameterAnalysis[] = [];

    // Group trades by market regime
    const regimeStats: Record<string, BucketStats> = {
      'FULL': { bucket: 'FULL', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      'CAUTIOUS': { bucket: 'CAUTIOUS', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      'DEFENSIVE': { bucket: 'DEFENSIVE', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 },
      'PAUSE': { bucket: 'PAUSE', count: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0 }
    };

    for (const trade of trades) {
      const regime = trade.fingerprint?.marketConditions?.regime || 'CAUTIOUS';

      regimeStats[regime].count++;
      if (trade.outcome === 'WIN') {
        regimeStats[regime].wins++;
      } else {
        regimeStats[regime].losses++;
      }
      regimeStats[regime].totalReturn += trade.profitLossPercent || 0;
    }

    // Calculate stats
    for (const key of Object.keys(regimeStats)) {
      const stat = regimeStats[key];
      stat.winRate = stat.wins / Math.max(1, stat.count);
      stat.avgReturn = stat.totalReturn / Math.max(1, stat.count);
    }

    // Log regime performance
    logger.info('Market regime performance', {
      FULL: { winRate: regimeStats.FULL.winRate, avgReturn: regimeStats.FULL.avgReturn },
      CAUTIOUS: { winRate: regimeStats.CAUTIOUS.winRate, avgReturn: regimeStats.CAUTIOUS.avgReturn },
      DEFENSIVE: { winRate: regimeStats.DEFENSIVE.winRate, avgReturn: regimeStats.DEFENSIVE.avgReturn }
    });

    // If CAUTIOUS performs nearly as well as FULL, thresholds might be too aggressive
    // If DEFENSIVE performs poorly, thresholds might not be aggressive enough

    return analyses;
  }

  /**
   * Optimize timing windows (peak hours)
   */
  async optimizeTimingWindows(trades: Trade[]): Promise<ParameterAnalysis | null> {
    logger.info('🕐 Optimizing timing windows', {
      tradeCount: trades.length
    });

    if (trades.length < this.MIN_TRADES_FOR_TUNING) {
      return null;
    }

    // Group trades by hour of day
    const hourStats: Record<number, BucketStats> = {};

    for (let h = 0; h < 24; h++) {
      hourStats[h] = {
        bucket: String(h),
        count: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgReturn: 0,
        totalReturn: 0
      };
    }

    for (const trade of trades) {
      const hour = trade.fingerprint?.marketConditions?.timeOfDay || new Date(trade.entryTime).getUTCHours();

      hourStats[hour].count++;
      if (trade.outcome === 'WIN') {
        hourStats[hour].wins++;
      } else {
        hourStats[hour].losses++;
      }
      hourStats[hour].totalReturn += trade.profitLossPercent || 0;
    }

    // Calculate stats
    for (let h = 0; h < 24; h++) {
      hourStats[h].winRate = hourStats[h].wins / Math.max(1, hourStats[h].count);
      hourStats[h].avgReturn = hourStats[h].totalReturn / Math.max(1, hourStats[h].count);
    }

    // Find peak hours (top performing)
    const sortedHours = Object.entries(hourStats)
      .filter(([_, stats]) => stats.count >= 3)
      .sort((a, b) => {
        const scoreA = a[1].winRate * Math.max(0, a[1].avgReturn);
        const scoreB = b[1].winRate * Math.max(0, b[1].avgReturn);
        return scoreB - scoreA;
      });

    if (sortedHours.length < 5) return null;

    // Find contiguous peak window
    const peakHours = sortedHours.slice(0, Math.ceil(sortedHours.length / 2)).map(([h]) => Number(h));
    const start = Math.min(...peakHours);
    const end = Math.max(...peakHours);

    const currentParams = await this.getCurrentParameters();
    const currentStart = currentParams.peakTradingHours?.start || DEFAULT_PARAMETERS.peakTradingHours.start;

    return {
      parameter: 'peakTradingHours',
      currentValue: { min: currentStart, max: currentParams.peakTradingHours?.end || 23 },
      optimalValue: { min: start, max: end },
      confidence: Math.min(1, trades.length / 100),
      sampleSize: trades.length,
      avgReturnAtOptimal: sortedHours[0][1].avgReturn,
      winRateAtOptimal: sortedHours[0][1].winRate,
      recommendation: 'keep'
    };
  }

  /**
   * Execute full parameter tuning cycle
   */
  async executeTuningCycle(): Promise<void> {
    logger.info('🔄 Executing parameter tuning cycle');

    const startTime = Date.now();
    let cycleId: string | null = null;

    try {
      // Record cycle start
      const cycleResult = await query<{ id: string }>(
        `INSERT INTO learning_cycles (cycle_number, cycle_type, trade_count_at_cycle, status)
         SELECT COALESCE(MAX(cycle_number), 0) + 1, 'parameter_tuning',
                (SELECT COUNT(*) FROM trades WHERE exit_time IS NOT NULL), 'running'
         FROM learning_cycles
         RETURNING id`
      );
      cycleId = cycleResult.rows[0].id;

      // Get recent trades
      const recentTrades = await this.getRecentTrades(100);

      if (recentTrades.length < this.MIN_TRADES_FOR_TUNING) {
        logger.warn('Skipping parameter tuning - insufficient data', {
          trades: recentTrades.length,
          required: this.MIN_TRADES_FOR_TUNING
        });

        await query(
          `UPDATE learning_cycles SET status = 'completed', completed_at = NOW(),
           duration_ms = $1, error_message = 'Insufficient trades'
           WHERE id = $2`,
          [Date.now() - startTime, cycleId]
        );
        return;
      }

      // Run all optimizations
      const entryAnalyses = await this.optimizeEntryParameters(recentTrades);
      const exitAnalyses = await this.optimizeExitParameters(recentTrades);
      const positionAnalyses = await this.optimizePositionSizes(recentTrades);
      const timingAnalysis = await this.optimizeTimingWindows(recentTrades);

      const allAnalyses = [
        ...entryAnalyses,
        ...exitAnalyses,
        ...positionAnalyses,
        ...(timingAnalysis ? [timingAnalysis] : [])
      ];

      // Apply adjustments
      const adjustmentsMade = await this.applyAnalyses(allAnalyses, recentTrades.length);

      // Update cycle status
      await query(
        `UPDATE learning_cycles
         SET status = 'completed', completed_at = NOW(),
             duration_ms = $1, adjustments_made = $2
         WHERE id = $3`,
        [Date.now() - startTime, adjustmentsMade, cycleId]
      );

      logger.info('✅ Parameter tuning cycle completed', {
        durationMs: Date.now() - startTime,
        analysesRun: allAnalyses.length,
        adjustmentsMade
      });

    } catch (error: any) {
      logger.error('Parameter tuning cycle failed', { error: error.message });

      if (cycleId) {
        await query(
          `UPDATE learning_cycles SET status = 'failed', completed_at = NOW(),
           duration_ms = $1, error_message = $2
           WHERE id = $3`,
          [Date.now() - startTime, error.message, cycleId]
        );
      }

      throw error;
    }
  }

  /**
   * Apply parameter analyses and save to database
   */
  private async applyAnalyses(analyses: ParameterAnalysis[], tradeCount: number): Promise<number> {
    let adjustmentsMade = 0;

    // Get frozen parameters
    const frozenParams = await this.getFrozenParameters();

    for (const analysis of analyses) {
      // Skip frozen parameters
      if (frozenParams.includes(analysis.parameter)) {
        logger.debug(`Skipping frozen parameter: ${analysis.parameter}`);
        continue;
      }

      // Skip if no change recommended
      if (analysis.recommendation === 'keep') {
        continue;
      }

      // Skip low confidence adjustments
      if (analysis.confidence < 0.3) {
        continue;
      }

      // Record the adjustment
      await query(
        `INSERT INTO learning_parameters
         (version, parameter_name, old_value, new_value, reason, trade_count)
         SELECT COALESCE(MAX(version), 0) + 1, $1, $2, $3, $4, $5
         FROM learning_parameters`,
        [
          analysis.parameter,
          JSON.stringify(analysis.currentValue),
          JSON.stringify(analysis.optimalValue),
          `${analysis.recommendation}: confidence ${(analysis.confidence * 100).toFixed(0)}%, win rate ${(analysis.winRateAtOptimal * 100).toFixed(1)}%`,
          tradeCount
        ]
      );

      adjustmentsMade++;

      logger.info('📝 Parameter adjusted', {
        parameter: analysis.parameter,
        old: analysis.currentValue,
        new: analysis.optimalValue,
        recommendation: analysis.recommendation
      });
    }

    return adjustmentsMade;
  }

  /**
   * Get current parameters from database
   */
  private async getCurrentParameters(): Promise<any> {
    try {
      const result = await query<{ parameters: any }>(
        `SELECT parameters FROM learning_snapshots ORDER BY version DESC LIMIT 1`
      );

      if (result.rows.length > 0) {
        return result.rows[0].parameters || {};
      }
    } catch (error: any) {
      logger.debug('Error fetching current parameters', { error: error.message });
    }

    return DEFAULT_PARAMETERS;
  }

  /**
   * Get list of frozen parameters
   */
  private async getFrozenParameters(): Promise<string[]> {
    try {
      const result = await query<{ parameter_name: string }>(
        `SELECT parameter_name FROM frozen_parameters WHERE parameter_name NOT LIKE 'weight_%'`
      );
      return result.rows.map(r => r.parameter_name);
    } catch (error: any) {
      logger.debug('Error fetching frozen parameters', { error: error.message });
      return [];
    }
  }

  /**
   * Get recent trades from database
   */
  private async getRecentTrades(limit: number): Promise<Trade[]> {
    try {
      const result = await query<{
        id: string;
        token_address: string;
        entry_price: string;
        entry_amount: string;
        entry_time: Date;
        exit_price: string | null;
        exit_time: Date | null;
        exit_reason: string | null;
        profit_loss_percent: string | null;
        conviction_score: string;
        fingerprint: TradeFingerprint;
        outcome: string | null;
      }>(
        `SELECT id, token_address, entry_price, entry_amount, entry_time,
                exit_price, exit_time, exit_reason, profit_loss_percent,
                conviction_score, fingerprint, outcome
         FROM trades
         WHERE exit_time IS NOT NULL AND outcome IS NOT NULL
         ORDER BY exit_time DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => ({
        id: row.id,
        tokenAddress: row.token_address,
        entryPrice: parseFloat(row.entry_price),
        entryAmount: parseFloat(row.entry_amount),
        entryTime: row.entry_time,
        exitPrice: row.exit_price ? parseFloat(row.exit_price) : undefined,
        exitTime: row.exit_time || undefined,
        exitReason: row.exit_reason as Trade['exitReason'],
        profitLossPercent: row.profit_loss_percent ? parseFloat(row.profit_loss_percent) : undefined,
        convictionScore: parseFloat(row.conviction_score),
        fingerprint: row.fingerprint,
        outcome: row.outcome as Trade['outcome']
      }));
    } catch (error: any) {
      logger.error('Error fetching recent trades', { error: error.message });
      return [];
    }
  }

  /**
   * Limit adjustment to MAX_ADJUSTMENT_PER_CYCLE
   */
  private limitAdjustment(current: number, optimal: number, min: number, max: number): number {
    const rawAdjustment = optimal - current;
    const limitedAdjustment = Math.sign(rawAdjustment) *
      Math.min(Math.abs(rawAdjustment), this.MAX_ADJUSTMENT_PER_CYCLE);

    return Math.max(min, Math.min(max, current + limitedAdjustment));
  }

  /**
   * Determine recommendation for range adjustments
   */
  private determineRangeRecommendation(
    current: { min: number; max: number },
    optimal: { min: number; max: number }
  ): 'increase' | 'decrease' | 'keep' | 'widen' | 'narrow' {
    const currentSpread = current.max - current.min;
    const optimalSpread = optimal.max - optimal.min;
    const centerShift = ((optimal.min + optimal.max) / 2) - ((current.min + current.max) / 2);

    if (Math.abs(centerShift) > 2 && centerShift > 0) return 'increase';
    if (Math.abs(centerShift) > 2 && centerShift < 0) return 'decrease';
    if (optimalSpread > currentSpread + 2) return 'widen';
    if (optimalSpread < currentSpread - 2) return 'narrow';
    return 'keep';
  }
}
