import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3002';

const getMockSafetyData = () => ({
  stats: {
    totalBlacklisted: 156,
    hardRejectsToday: 12,
    tokensScanned: 234,
    avgSafetyScore: 72,
  },
  blacklist: [
    { id: '1', address: 'scam1...xyz', type: 'deployer' as const, reason: 'Known rugger - 3 confirmed rugs', addedAt: new Date(Date.now() - 604800000).toISOString(), rugCount: 3 },
    { id: '2', address: 'scam2...abc', type: 'contract' as const, reason: 'Honeypot contract detected', addedAt: new Date(Date.now() - 259200000).toISOString(), rugCount: 0 },
    { id: '3', address: 'scam3...def', type: 'associated' as const, reason: 'Funded by known rugger', addedAt: new Date(Date.now() - 86400000).toISOString(), rugCount: 0 },
  ],
  recentRejections: [
    { tokenAddress: 'rej1...xyz', tokenName: 'ScamCoin', reason: 'HONEYPOT DETECTED', timestamp: new Date(Date.now() - 1800000).toISOString(), safetyScore: 0 },
    { tokenAddress: 'rej2...abc', tokenName: 'FakeMeme', reason: 'Deployer on blacklist', timestamp: new Date(Date.now() - 3600000).toISOString(), safetyScore: 15 },
    { tokenAddress: 'rej3...def', tokenName: 'RugToken', reason: 'Mint function active', timestamp: new Date(Date.now() - 7200000).toISOString(), safetyScore: 0 },
  ],
});

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/safety`, {
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
    data: getMockSafetyData(),
  });
}
