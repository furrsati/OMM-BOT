import { NextResponse } from 'next/server';
import { fetchFromBackend, backendUnavailableResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Fetch all learning data from multiple endpoints
    const [weightsRes, parametersRes, patternsRes, snapshotsRes, statsRes] = await Promise.all([
      fetchFromBackend('/api/learning/weights', {
        cache: 'no-store',
        timeout: 10000,
      }),
      fetchFromBackend('/api/learning/parameters', {
        cache: 'no-store',
        timeout: 10000,
      }),
      fetchFromBackend('/api/learning/patterns', {
        cache: 'no-store',
        timeout: 10000,
      }),
      fetchFromBackend('/api/learning/snapshots?limit=1', {
        cache: 'no-store',
        timeout: 10000,
      }),
      fetchFromBackend('/api/learning/stats', {
        cache: 'no-store',
        timeout: 10000,
      }).catch(() => null), // Stats endpoint might not exist yet
    ]);

    if (weightsRes.ok && parametersRes.ok && patternsRes.ok) {
      const weightsData = await weightsRes.json();
      const parametersData = await parametersRes.json();
      const patternsData = await patternsRes.json();
      const snapshotsData = snapshotsRes.ok ? await snapshotsRes.json() : { data: [] };
      const statsData = statsRes?.ok ? await statsRes.json() : null;

      // Transform weights to frontend format
      const weights = Array.isArray(weightsData.data) ? weightsData.data : [];

      // Transform patterns to frontend format
      const winPatternsRaw = patternsData.data?.winPatterns || { top: [], count: 0 };
      const dangerPatternsRaw = patternsData.data?.dangerPatterns || { top: [], count: 0 };

      const winPatterns = (winPatternsRaw.top || []).map((p: any) => ({
        pattern: p.id || `Pattern ${p.occurrences}`,
        matchCount: p.occurrences || 0,
        winRate: 0.7, // Default since not in backend
        avgReturn: p.avgReturn || 0,
      }));

      const dangerPatterns = (dangerPatternsRaw.top || []).map((p: any) => ({
        pattern: p.id || `Pattern ${p.occurrences}`,
        matchCount: p.occurrences || 0,
        winRate: 0.3, // Default since not in backend
        avgReturn: -(p.confidence || 0),
      }));

      // Transform parameters to frontend format (convert from object to array)
      const paramsObj = parametersData.data || {};
      const parameters = [
        { name: 'Stop Loss %', category: 'Exit', currentValue: paramsObj.stopLossPercent || 25, defaultValue: 25, minValue: 10, maxValue: 40, lastAdjusted: null, adjustmentReason: null, isLocked: false },
        { name: 'Max Open Positions', category: 'Entry', currentValue: paramsObj.maxOpenPositions || 5, defaultValue: 5, minValue: 1, maxValue: 10, lastAdjusted: null, adjustmentReason: null, isLocked: false },
        { name: 'Max Daily Loss %', category: 'Risk', currentValue: paramsObj.maxDailyLoss || 8, defaultValue: 8, minValue: 3, maxValue: 15, lastAdjusted: null, adjustmentReason: null, isLocked: false },
        { name: 'Max Daily Profit %', category: 'Risk', currentValue: paramsObj.maxDailyProfit || 15, defaultValue: 15, minValue: 5, maxValue: 30, lastAdjusted: null, adjustmentReason: null, isLocked: false },
      ];

      // Calculate stats from available data
      const latestSnapshot = snapshotsData.data?.[0];
      const stats = statsData?.data || {
        totalTrades: latestSnapshot?.tradeCount || 0,
        tradesAnalyzed: latestSnapshot?.tradeCount || 0,
        lastOptimization: latestSnapshot?.createdAt || null,
        nextOptimization: 50, // Default
        totalAdjustments: latestSnapshot?.version || 0,
        driftFromBaseline: 0,
        learningMode: 'active' as const,
      };

      return NextResponse.json({
        success: true,
        data: {
          stats,
          weights,
          parameters,
          winPatterns,
          dangerPatterns,
        },
      });
    }

    return NextResponse.json({
      ...backendUnavailableResponse('Backend returned error'),
      status: weightsRes.status,
      isOffline: true,
    }, { status: 503 });
  } catch (error) {
    console.error('Backend connection failed:', error);
    return NextResponse.json({
      ...backendUnavailableResponse(),
      isOffline: true,
    }, { status: 503 });
  }
}
