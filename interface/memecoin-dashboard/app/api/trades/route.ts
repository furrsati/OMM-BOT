import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

const getMockTrades = () => ({
  trades: [
    {
      id: '1',
      tokenAddress: 'trade1...xyz',
      tokenName: 'WinCoin',
      tokenSymbol: 'WIN',
      entryPrice: 0.00001000,
      exitPrice: 0.00001350,
      quantity: 1000000,
      entryTime: new Date(Date.now() - 86400000).toISOString(),
      exitTime: new Date(Date.now() - 82800000).toISOString(),
      pnl: 35.00,
      pnlPercent: 35.0,
      exitReason: 'TAKE_PROFIT',
      convictionScore: 88,
      smartWalletCount: 4,
    },
    {
      id: '2',
      tokenAddress: 'trade2...abc',
      tokenName: 'LossCoin',
      tokenSymbol: 'LOSS',
      entryPrice: 0.00002000,
      exitPrice: 0.00001500,
      quantity: 500000,
      entryTime: new Date(Date.now() - 172800000).toISOString(),
      exitTime: new Date(Date.now() - 169200000).toISOString(),
      pnl: -25.00,
      pnlPercent: -25.0,
      exitReason: 'STOP_LOSS',
      convictionScore: 72,
      smartWalletCount: 2,
    },
  ],
  stats: {
    totalTrades: 45,
    winRate: 0.42,
    totalPnL: 1250.75,
    avgWin: 52.30,
    avgLoss: -22.50,
    profitFactor: 1.85,
    bestTrade: 245.00,
    worstTrade: -45.00,
  },
});

export async function GET(_request: NextRequest) {
  try {
    // Fetch both trades and stats from backend
    const [tradesRes, statsRes] = await Promise.all([
      fetch(`${BOT_API_URL}/api/trades/recent?limit=50`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${BOT_API_URL}/api/trades/stats`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(5000),
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
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    data: getMockTrades(),
  });
}
