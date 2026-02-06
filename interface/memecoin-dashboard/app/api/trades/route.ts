import { NextRequest, NextResponse } from 'next/server';
import { fetchFromBackend, backendUnavailableResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    // Fetch both trades and stats from backend
    const [tradesRes, statsRes] = await Promise.all([
      fetchFromBackend('/api/trades/recent?limit=50', {
        cache: 'no-store',
        timeout: 10000,
      }),
      fetchFromBackend('/api/trades/stats', {
        cache: 'no-store',
        timeout: 10000,
      }),
    ]);

    if (tradesRes.ok && statsRes.ok) {
      const tradesData = await tradesRes.json();
      const statsData = await statsRes.json();

      // Transform backend format to frontend format
      const trades = (tradesData.data || []).map((t: any) => ({
        id: t.id,
        tokenAddress: t.tokenAddress,
        tokenName: t.tokenName || 'Unknown',
        tokenSymbol: t.tokenSymbol || 'UNK',
        entryPrice: t.entry?.price || 0,
        exitPrice: t.exit?.price || 0,
        quantity: t.entry?.amount || 0,
        entryTime: t.entry?.time || new Date().toISOString(),
        exitTime: t.exit?.time || null,
        pnl: t.profitLoss || 0,
        pnlPercent: t.profitLossPercent || 0,
        exitReason: t.exit?.reason || t.outcome || 'UNKNOWN',
        convictionScore: t.convictionScore || 0,
        smartWalletCount: 0,
      }));

      const stats = statsData.data || {};

      return NextResponse.json({
        success: true,
        data: {
          trades,
          stats: {
            totalTrades: stats.totalTrades || 0,
            winRate: stats.winRate ? stats.winRate / 100 : 0,
            totalPnL: stats.totalPnL?.usd || 0,
            avgWin: stats.avgWinner || 0,
            avgLoss: stats.avgLoser ? -stats.avgLoser : 0,
            profitFactor: stats.profitFactor || 0,
            bestTrade: 0,
            worstTrade: 0,
          },
        },
      });
    }

    return NextResponse.json({
      ...backendUnavailableResponse('Backend returned error'),
      status: tradesRes.status,
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
