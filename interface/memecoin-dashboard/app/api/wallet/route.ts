import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

const getMockWalletData = () => ({
  address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  balance: {
    sol: 12.5432,
    solUsd: 2508.64,
    tokens: [
      {
        mint: 'mock1...xyz',
        symbol: 'MOCK',
        name: 'MockCoin',
        balance: 1000000,
        valueUsd: 145.60,
        priceUsd: 0.0001456,
        change24h: 18.0,
      },
      {
        mint: 'mock2...abc',
        symbol: 'TEST',
        name: 'TestToken',
        balance: 5000000,
        valueUsd: 256.00,
        priceUsd: 0.0000512,
        change24h: -9.7,
      },
    ],
    totalValueUsd: 2910.24,
  },
  dailyPnL: 125.50,
  weeklyPnL: 342.80,
  allTimePnL: 1250.75,
  recentTransactions: [
    {
      signature: '5xYz...abc123',
      type: 'trade' as const,
      amount: 0.5,
      token: 'SOL',
      timestamp: new Date(Date.now() - 600000).toISOString(),
      status: 'success' as const,
    },
    {
      signature: '3wXy...def456',
      type: 'receive' as const,
      amount: 145.60,
      token: 'MOCK',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      status: 'success' as const,
    },
    {
      signature: '8zAb...ghi789',
      type: 'send' as const,
      amount: 2.0,
      token: 'SOL',
      timestamp: new Date(Date.now() - 86400000).toISOString(),
      status: 'success' as const,
    },
  ],
});

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/wallet`, {
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
    data: getMockWalletData(),
  });
}
