import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3002';

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filter = searchParams.get('filter') || 'all';
  const time = searchParams.get('time') || 'all';

  try {
    const response = await fetch(
      `${BOT_API_URL}/api/trades?filter=${filter}&time=${time}`,
      {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ success: true, data });
    }
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    data: getMockTrades(),
  });
}
