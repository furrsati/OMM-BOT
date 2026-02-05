import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3002';

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
    const response = await fetch(`${BOT_API_URL}/api/positions`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ success: true, data });
    }
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    data: getMockPositions(),
  });
}
