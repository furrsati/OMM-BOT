import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3002';

const getMockAlerts = () => [
  {
    id: '1',
    level: 'critical' as const,
    title: 'Daily Loss Limit Approaching',
    message: 'Current daily loss is -6.5%, approaching -8% limit',
    category: 'Risk Management',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    acknowledged: false,
  },
  {
    id: '2',
    level: 'warning' as const,
    title: 'Smart Wallet Crowding Detected',
    message: 'Wallet 7xKXtg...AsU showing signs of crowding - other bots copying',
    category: 'Alpha Engine',
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    acknowledged: false,
  },
  {
    id: '3',
    level: 'info' as const,
    title: 'Learning Engine Optimization Complete',
    message: 'Weight adjustments applied: Smart Wallet Signal +2%, Social Signals -2%',
    category: 'Learning Engine',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    acknowledged: true,
  },
  {
    id: '4',
    level: 'error' as const,
    title: 'RPC Node Failover',
    message: 'Primary RPC (Helius) unresponsive, switched to backup (Triton)',
    category: 'Infrastructure',
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    acknowledged: true,
  },
];

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/alerts`, {
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
    data: getMockAlerts(),
  });
}
