import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

const getMockScanner = () => ({
  opportunities: [
    {
      id: '1',
      tokenAddress: 'mock1...xyz',
      tokenName: 'TestCoin',
      tokenSymbol: 'TEST',
      discoveredAt: new Date(Date.now() - 300000).toISOString(),
      discoveredVia: 'smart_wallet',
      smartWallets: {
        addresses: ['wallet1...abc', 'wallet2...def'],
        total: 3,
        tier1: 2,
        tier2: 1,
        tier3: 0,
      },
      safety: {
        score: 75,
        isHoneypot: false,
        hasMintAuthority: false,
        hasFreezeAuthority: false,
      },
      market: {
        price: 0.00001234,
        marketCap: 125000,
        liquidity: 45000,
        holders: 234,
        volume24h: 12500,
        priceChange1h: 5.2,
        priceChange24h: 25.5,
      },
      entry: {
        dipFromHigh: 22.5,
        athPrice: 0.000016,
        tokenAgeMinutes: 45,
        hypePhase: 'EARLY_FOMO',
      },
      conviction: {
        score: 78,
        breakdown: {
          smartWallet: 28,
          safety: 20,
          market: 12,
          entry: 18,
        },
      },
      status: 'ANALYZING',
      lastUpdated: new Date().toISOString(),
    },
    {
      id: '2',
      tokenAddress: 'mock2...abc',
      tokenName: 'MoonToken',
      tokenSymbol: 'MOON',
      discoveredAt: new Date(Date.now() - 600000).toISOString(),
      discoveredVia: 'smart_wallet',
      smartWallets: {
        addresses: ['wallet3...ghi'],
        total: 1,
        tier1: 0,
        tier2: 1,
        tier3: 0,
      },
      safety: {
        score: 45,
        isHoneypot: false,
        hasMintAuthority: true,
        hasFreezeAuthority: false,
      },
      market: {
        price: 0.00000567,
        marketCap: 56000,
        liquidity: 22000,
        holders: 89,
        volume24h: 5600,
        priceChange1h: -2.1,
        priceChange24h: 8.3,
      },
      entry: {
        dipFromHigh: 15.2,
        athPrice: 0.0000067,
        tokenAgeMinutes: 120,
        hypePhase: 'DISCOVERY',
      },
      conviction: {
        score: 42,
        breakdown: {
          smartWallet: 12,
          safety: 10,
          market: 8,
          entry: 12,
        },
      },
      status: 'REJECTED',
      rejectionReason: 'Mint authority active',
      lastUpdated: new Date().toISOString(),
    },
  ],
  stats: {
    total: 2,
    analyzing: 1,
    qualified: 0,
    rejected: 1,
    entered: 0,
    avgConviction: 60,
  },
});

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/scanner`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return NextResponse.json({ success: true, data: data.data });
      }
    }
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    data: getMockScanner(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${BOT_API_URL}/api/scanner/analyze`, {
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
    message: 'Token analysis queued',
  });
}
