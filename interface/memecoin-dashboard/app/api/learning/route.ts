import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

const getMockLearningData = () => ({
  stats: {
    totalTrades: 45,
    tradesAnalyzed: 42,
    lastOptimization: new Date(Date.now() - 172800000).toISOString(),
    nextOptimization: 8,
    totalAdjustments: 12,
    driftFromBaseline: 15.5,
    learningMode: 'active' as const,
  },
  weights: [
    { name: 'Smart Wallet Signal', weight: 32, defaultWeight: 30, predictivePower: 0.78, isLocked: false },
    { name: 'Token Safety', weight: 24, defaultWeight: 25, predictivePower: 0.65, isLocked: false },
    { name: 'Market Conditions', weight: 14, defaultWeight: 15, predictivePower: 0.52, isLocked: false },
    { name: 'Social Signals', weight: 8, defaultWeight: 10, predictivePower: 0.35, isLocked: true },
    { name: 'Entry Quality', weight: 22, defaultWeight: 20, predictivePower: 0.72, isLocked: false },
  ],
  parameters: [
    { name: 'Dip Entry Min', category: 'Entry', currentValue: 22, defaultValue: 20, minValue: 10, maxValue: 35, lastAdjusted: new Date(Date.now() - 86400000).toISOString(), adjustmentReason: 'Higher dip entries showed better R:R', isLocked: false },
    { name: 'Dip Entry Max', category: 'Entry', currentValue: 32, defaultValue: 30, minValue: 20, maxValue: 45, lastAdjusted: null, adjustmentReason: null, isLocked: false },
    { name: 'Stop Loss', category: 'Exit', currentValue: 23, defaultValue: 25, minValue: 12, maxValue: 35, lastAdjusted: new Date(Date.now() - 172800000).toISOString(), adjustmentReason: 'Tighter stops reduced avg loss', isLocked: false },
    { name: 'Trailing Stop', category: 'Exit', currentValue: 14, defaultValue: 15, minValue: 8, maxValue: 25, lastAdjusted: null, adjustmentReason: null, isLocked: false },
    { name: 'Min Conviction', category: 'Entry', currentValue: 72, defaultValue: 70, minValue: 50, maxValue: 90, lastAdjusted: new Date(Date.now() - 259200000).toISOString(), adjustmentReason: 'Slightly higher threshold improved win rate', isLocked: false },
    { name: 'Take Profit L1', category: 'Exit', currentValue: 32, defaultValue: 30, minValue: 15, maxValue: 60, lastAdjusted: null, adjustmentReason: null, isLocked: false },
  ],
  winPatterns: [
    { pattern: '3+ Tier 1 wallets + 25%+ dip', matchCount: 12, winRate: 0.83, avgReturn: 0.45 },
    { pattern: 'High conviction + low token age', matchCount: 8, winRate: 0.75, avgReturn: 0.38 },
    { pattern: 'FULL regime + morning entry', matchCount: 15, winRate: 0.67, avgReturn: 0.28 },
  ],
  dangerPatterns: [
    { pattern: 'Single wallet + high hype', matchCount: 6, winRate: 0.17, avgReturn: -0.22 },
    { pattern: 'Low liquidity + many holders', matchCount: 4, winRate: 0.25, avgReturn: -0.18 },
    { pattern: 'DEFENSIVE regime + chasing', matchCount: 3, winRate: 0.0, avgReturn: -0.31 },
  ],
});

export async function GET() {
  try {
    // Fetch all learning data from multiple endpoints
    const [weightsRes, parametersRes, patternsRes] = await Promise.all([
      fetch(`${BOT_API_URL}/api/learning/weights`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${BOT_API_URL}/api/learning/parameters`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${BOT_API_URL}/api/learning/patterns`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    if (weightsRes.ok && parametersRes.ok && patternsRes.ok) {
      const weightsData = await weightsRes.json();
      const parametersData = await parametersRes.json();
      const patternsData = await patternsRes.json();

      return NextResponse.json({
        success: true,
        data: {
          stats: {
            totalTrades: 0,
            tradesAnalyzed: 0,
            lastOptimization: null,
            nextOptimization: 0,
            totalAdjustments: 0,
            driftFromBaseline: 0,
            learningMode: 'active' as const,
          },
          weights: weightsData.data || [],
          parameters: parametersData.data || [],
          winPatterns: patternsData.data?.winPatterns || [],
          dangerPatterns: patternsData.data?.dangerPatterns || [],
        },
      });
    }
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    data: getMockLearningData(),
  });
}
