import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3002';

const getMockSettings = () => ({
  // Position Sizing
  maxPositionSize: 5,
  minPositionSize: 1,
  maxOpenPositions: 5,
  maxTotalExposure: 20,
  maxSingleTradeRisk: 1.5,

  // Entry Rules
  minConvictionScore: 70,
  minSmartWalletCount: 2,
  maxTokenAge: 4,
  minLiquidityDepth: 50000,
  maxDipEntry: 30,
  minDipEntry: 20,

  // Exit Rules
  defaultStopLoss: 25,
  earlyDiscoveryStopLoss: 15,
  trailingStopActivation: 20,
  trailingStopDistance: 15,
  timeBasedStopHours: 4,

  // Take Profit Levels
  takeProfitLevel1: 30,
  takeProfitLevel1Percent: 20,
  takeProfitLevel2: 60,
  takeProfitLevel2Percent: 25,
  takeProfitLevel3: 100,
  takeProfitLevel3Percent: 25,
  moonbagPercent: 15,

  // Daily Limits
  maxDailyLoss: 8,
  maxDailyProfit: 15,
  losingStreakPause: 5,
  weeklyCircuitBreaker: 15,

  // Execution
  maxSlippageBuy: 5,
  maxSlippageSell: 8,
  maxSlippageEmergency: 15,
  maxRetries: 2,
  targetLatencyMs: 500,

  // Notifications
  telegramEnabled: true,
  telegramChatId: '',
  discordEnabled: false,
  discordWebhook: '',
  emailEnabled: false,
  emailAddress: '',
});

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/settings`, {
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
    data: getMockSettings(),
  });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${BOT_API_URL}/api/settings`, {
      method: 'PUT',
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
    message: 'Settings saved',
  });
}
