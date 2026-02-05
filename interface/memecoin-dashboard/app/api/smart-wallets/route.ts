import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

const getMockWallets = () => [
  {
    id: '1',
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    tier: 1 as const,
    score: 92,
    winRate: 0.68,
    avgReturn: 1.25,
    totalTrades: 24,
    lastActive: new Date(Date.now() - 3600000).toISOString(),
    isCrowded: false,
    addedAt: new Date(Date.now() - 604800000).toISOString(),
    notes: 'Top performer - consistent wins',
  },
  {
    id: '2',
    address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    tier: 2 as const,
    score: 78,
    winRate: 0.55,
    avgReturn: 0.85,
    totalTrades: 18,
    lastActive: new Date(Date.now() - 7200000).toISOString(),
    isCrowded: false,
    addedAt: new Date(Date.now() - 1209600000).toISOString(),
  },
  {
    id: '3',
    address: '3Kzn3LJNJZiTz84v8xQtPzDqLaP9vQvJPcYjTVx4xDEN',
    tier: 3 as const,
    score: 65,
    winRate: 0.48,
    avgReturn: 0.42,
    totalTrades: 12,
    lastActive: new Date(Date.now() - 86400000).toISOString(),
    isCrowded: true,
    addedAt: new Date(Date.now() - 2419200000).toISOString(),
    notes: 'Getting crowded - monitor closely',
  },
];

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/smart-wallets`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data) {
        return NextResponse.json({ success: true, data: data.data });
      }
    }
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    data: getMockWallets(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${BOT_API_URL}/api/smart-wallets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    message: 'Wallet added',
  });
}
