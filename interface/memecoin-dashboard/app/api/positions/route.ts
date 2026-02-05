import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

const getMockPositions = () => [
  {
    id: '1',
    tokenAddress: 'mock1...xyz',
    tokenName: 'MockCoin',
    tokenSymbol: 'MOCK',
    entryPrice: 0.00001234,
    currentPrice: 0.00001456,
    quantity: 1000000,
    entryTime: new Date(Date.now() - 3600000).toISOString(),
    pnl: 22.20,
    pnlPercent: 18.0,
    stopLoss: 0.00001050,
    takeProfit: [0.00001604, 0.00001975],
    convictionScore: 82,
    smartWalletCount: 3,
  },
  {
    id: '2',
    tokenAddress: 'mock2...abc',
    tokenName: 'TestToken',
    tokenSymbol: 'TEST',
    entryPrice: 0.00000567,
    currentPrice: 0.00000512,
    quantity: 5000000,
    entryTime: new Date(Date.now() - 7200000).toISOString(),
    pnl: -27.50,
    pnlPercent: -9.7,
    stopLoss: 0.00000425,
    takeProfit: [0.00000737, 0.00000908],
    convictionScore: 75,
    smartWalletCount: 2,
  },
];

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/positions/current`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      // Transform backend format to frontend format
      if (data.success && data.data?.positions) {
        const positions = data.data.positions.map((p: any) => ({
          id: p.id,
          tokenAddress: p.tokenAddress,
          tokenName: p.tokenName || 'Unknown',
          tokenSymbol: p.tokenSymbol || 'UNKNOWN',
          entryPrice: p.entry?.price || 0,
          currentPrice: p.current?.price || p.entry?.price || 0,
          quantity: p.remainingAmount || p.entry?.amount || 0,
          entryTime: p.entry?.time || new Date().toISOString(),
          pnl: p.pnl?.usd || 0,
          pnlPercent: p.pnl?.percent || 0,
          stopLoss: p.stopLoss?.price || 0,
          takeProfit: [],
          convictionScore: p.entry?.conviction || 0,
          smartWalletCount: p.smartWallets?.length || 0,
        }));
        return NextResponse.json({ success: true, data: positions });
      }
      return NextResponse.json({ success: true, data: [] });
    }
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    data: getMockPositions(),
  });
}
