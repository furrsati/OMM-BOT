import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

// Mock data for when backend is not available
const getMockStatus = () => ({
  bot: {
    isRunning: true,
    isPaused: false,
    tradingEnabled: true,
    paperTradingMode: true,
    uptime: 3600,
    startTime: new Date(Date.now() - 3600000).toISOString(),
  },
  market: {
    regime: 'FULL',
    reason: 'SOL stable, BTC stable',
    solChange24h: 2.5,
    btcChange24h: 1.2,
  },
  trading: {
    dailyPnL: 125.50,
    openPositions: 2,
    losingStreak: 0,
    cooldownActive: false,
  },
  positions: {
    open: 2,
    totalTrades: 45,
    winRate: 0.42,
    totalPnL: 1250.75,
  },
});

export async function GET() {
  try {
    // Try to fetch from actual backend
    const response = await fetch(`${BOT_API_URL}/api/status`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ success: true, data });
    }
  } catch {
    // Backend not available, return mock data
  }

  // Return mock data
  return NextResponse.json({
    success: true,
    data: getMockStatus(),
  });
}
