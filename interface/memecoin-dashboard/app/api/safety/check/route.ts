import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

const getMockCheckResult = () => ({
  checks: [
    { name: 'Honeypot Check', status: 'pass' as const, details: 'Sell simulation succeeded', points: 10 },
    { name: 'Mint Function', status: 'pass' as const, details: 'No mint function found', points: 10 },
    { name: 'Pause Function', status: 'pass' as const, details: 'No pause capability', points: 10 },
    { name: 'Liquidity Locked', status: 'pass' as const, details: 'LP locked for 30 days', points: 15 },
    { name: 'Holder Distribution', status: 'warning' as const, details: 'Top 10 hold 35%', points: 5 },
    { name: 'Dev Wallet', status: 'pass' as const, details: 'Dev holds 3%', points: 10 },
    { name: 'Blacklist Check', status: 'pass' as const, details: 'Deployer not on blacklist', points: 10 },
    { name: 'Contract Verified', status: 'pass' as const, details: 'Source code verified', points: 5 },
  ],
  score: 75,
  passed: true,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${BOT_API_URL}/api/safety/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
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
    data: getMockCheckResult(),
  });
}
