/**
 * LEARNING ENGINE UTILITIES
 *
 * Helper functions for pattern matching, statistical analysis, and distance calculations
 */

import type { TradeFingerprint } from '../types';

/**
 * Calculate cosine similarity between two trade fingerprints
 * Returns value between 0 (completely different) and 1 (identical)
 */
export function cosineSimilarity(fp1: TradeFingerprint, fp2: TradeFingerprint): number {
  const vec1 = fingerprintToVector(fp1);
  const vec2 = fingerprintToVector(fp2);

  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));

  if (magnitude1 === 0 || magnitude2 === 0) return 0;

  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Calculate Euclidean distance between two trade fingerprints
 * Returns value >= 0, where smaller = more similar
 */
export function euclideanDistance(fp1: TradeFingerprint, fp2: TradeFingerprint): number {
  const vec1 = fingerprintToVector(fp1);
  const vec2 = fingerprintToVector(fp2);

  const sumSquaredDiff = vec1.reduce((sum, val, i) => {
    const diff = val - vec2[i];
    return sum + diff * diff;
  }, 0);

  return Math.sqrt(sumSquaredDiff);
}

/**
 * Convert a trade fingerprint to a normalized vector for distance calculations
 */
export function fingerprintToVector(fp: TradeFingerprint): number[] {
  const vector: number[] = [
    // Smart Wallets (3 dimensions)
    normalize(fp.smartWallets.count, 0, 10),
    fp.smartWallets.tiers.length > 0 ? fp.smartWallets.tiers[0] / 3 : 0,
    fp.smartWallets.tiers.length > 1 ? fp.smartWallets.tiers[1] / 3 : 0,

    // Token Safety (6 dimensions)
    fp.tokenSafety.overallScore / 100,
    fp.tokenSafety.liquidityLocked ? 1 : 0,
    normalize(fp.tokenSafety.liquidityDepth, 0, 200000),
    fp.tokenSafety.honeypotRisk ? 1 : 0,
    fp.tokenSafety.mintAuthority ? 1 : 0,
    fp.tokenSafety.freezeAuthority ? 1 : 0,

    // Market Conditions (6 dimensions)
    normalize(fp.marketConditions.solPrice, 0, 300),
    trendToNumber(fp.marketConditions.solTrend),
    trendToNumber(fp.marketConditions.btcTrend),
    regimeToNumber(fp.marketConditions.regime),
    fp.marketConditions.timeOfDay / 24,
    fp.marketConditions.dayOfWeek / 7,

    // Social Signals (3 dimensions)
    normalize(fp.socialSignals.twitterFollowers, 0, 10000),
    normalize(fp.socialSignals.telegramMembers, 0, 5000),
    normalize(fp.socialSignals.mentionVelocity, 0, 100),

    // Entry Quality (5 dimensions)
    normalize(fp.entryQuality.dipDepth, 0, 50),
    normalize(fp.entryQuality.distanceFromATH, 0, 100),
    normalize(fp.entryQuality.tokenAge, 0, 14400), // 4 hours in seconds
    normalize(fp.entryQuality.buySellRatio, 0, 10),
    hypePhaseToNumber(fp.entryQuality.hypePhase)
  ];

  return vector;
}

/**
 * Normalize a value to 0-1 range
 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized)); // Clamp to [0, 1]
}

/**
 * Normalize an array of values to 0-1 range
 */
export function normalizeVector(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map(v => normalize(v, min, max));
}

/**
 * Convert trend string to number for vector representation
 */
function trendToNumber(trend: 'up' | 'stable' | 'down'): number {
  switch (trend) {
    case 'up': return 1;
    case 'stable': return 0.5;
    case 'down': return 0;
  }
}

/**
 * Convert market regime to number for vector representation
 */
function regimeToNumber(regime: string): number {
  switch (regime) {
    case 'FULL': return 1;
    case 'CAUTIOUS': return 0.66;
    case 'DEFENSIVE': return 0.33;
    case 'PAUSE': return 0;
    default: return 0.5;
  }
}

/**
 * Convert hype phase to number for vector representation
 */
function hypePhaseToNumber(phase: string): number {
  switch (phase) {
    case 'DISCOVERY': return 0.2;
    case 'EARLY_FOMO': return 0.4;
    case 'PEAK_FOMO': return 0.6;
    case 'DISTRIBUTION': return 0.8;
    case 'DUMP': return 1;
    default: return 0.5;
  }
}

/**
 * Calculate Pearson correlation coefficient between two arrays
 */
export function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Calculate p-value for correlation coefficient
 * Tests statistical significance of correlation
 */
export function calculatePValue(correlation: number, n: number): number {
  if (n < 3) return 1; // Not enough data

  const df = n - 2;
  const t = correlation * Math.sqrt(df / (1 - correlation * correlation));

  // Simplified p-value approximation
  // For production, use a proper t-distribution library
  const p = 2 * (1 - normalCDF(Math.abs(t)));

  return p;
}

/**
 * Standard normal cumulative distribution function
 * Approximation for p-value calculation
 */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

  return x > 0 ? 1 - prob : prob;
}

/**
 * Apply exponential decay for recency weighting
 * More recent trades are weighted more heavily
 *
 * @param daysAgo - Number of days since the trade
 * @param halfLife - Half-life in days (default 30)
 * @returns Weight between 0 and 1
 */
export function exponentialDecay(daysAgo: number, halfLife: number = 30): number {
  return Math.pow(2, -daysAgo / halfLife);
}

/**
 * Calculate days between two dates
 */
export function daysBetween(date1: Date, date2: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return diffMs / msPerDay;
}

/**
 * Calculate mean of an array
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate standard deviation of an array
 */
export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(val => Math.pow(val - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

/**
 * Check if a difference is statistically significant
 * Uses a simple threshold approach
 */
export function isSignificantDifference(
  value1: number,
  value2: number,
  threshold: number = 0.05
): boolean {
  const diff = Math.abs(value1 - value2);
  const avg = (value1 + value2) / 2;
  if (avg === 0) return false;

  const percentDiff = diff / avg;
  return percentDiff >= threshold;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Round to specified decimal places
 */
export function roundTo(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Calculate Kelly Criterion for optimal position sizing
 *
 * @param winRate - Win rate (0-1)
 * @param avgWin - Average win amount
 * @param avgLoss - Average loss amount
 * @returns Optimal fraction of bankroll to risk
 */
export function kellyPosition(
  winRate: number,
  avgWin: number,
  avgLoss: number
): number {
  if (avgLoss === 0) return 0;

  const lossRate = 1 - winRate;
  const winLossRatio = avgWin / Math.abs(avgLoss);
  const kelly = (winRate * winLossRatio - lossRate) / winLossRatio;

  // Use fractional Kelly (0.5x) for safety
  return Math.max(0, kelly * 0.5);
}

/**
 * Safely parse JSONB field from database
 */
export function safeParseJSON<T>(jsonString: any, defaultValue: T): T {
  if (typeof jsonString === 'object') {
    return jsonString as T;
  }

  if (typeof jsonString !== 'string') {
    return defaultValue;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return defaultValue;
  }
}
