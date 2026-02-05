import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

export async function GET(_request: NextRequest) {
  try {
    // Fetch both trades and stats from backend
    const [tradesRes, statsRes] = await Promise.all([
      fetch(`${BOT_API_URL}/api/trades/recent?limit=50`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`${BOT_API_URL}/api/trades/stats`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(10000),
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
      success: false,
      error: 'Backend returned error',
      status: tradesRes.status,
      backendUrl: BOT_API_URL,
      isOffline: true,
    }, { status: 503 });
  } catch (error) {
    console.error('Backend connection failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Backend unavailable',
      message: 'Cannot connect to trading bot backend. Ensure BOT_API_URL is set correctly in Render environment variables.',
      backendUrl: BOT_API_URL,
      isOffline: true,
    }, { status: 503 });
  }
}
