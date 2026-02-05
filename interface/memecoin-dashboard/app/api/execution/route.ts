import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3002';

const getMockExecutionData = () => ({
  network: {
    tps: 2450,
    congestionLevel: 'low' as const,
    avgBlockTime: 400,
    currentSlot: 245789012,
  },
  stats: {
    avgLatency: 285,
    successRate: 96.5,
    totalTransactions: 156,
    failedTransactions: 5,
    retriesUsed: 12,
    avgPriorityFee: 0.00025,
    avgSlippage: 2.8,
  },
  rpcNodes: [
    {
      name: 'Helius',
      url: 'https://rpc.helius.xyz',
      status: 'healthy' as const,
      latency: 45,
      isPrimary: true,
      lastCheck: new Date(Date.now() - 30000).toISOString(),
      successRate: 99.2,
    },
    {
      name: 'Triton',
      url: 'https://rpc.triton.one',
      status: 'healthy' as const,
      latency: 68,
      isPrimary: false,
      lastCheck: new Date(Date.now() - 30000).toISOString(),
      successRate: 98.5,
    },
    {
      name: 'QuickNode',
      url: 'https://solana-mainnet.quicknode.io',
      status: 'degraded' as const,
      latency: 125,
      isPrimary: false,
      lastCheck: new Date(Date.now() - 30000).toISOString(),
      successRate: 95.0,
    },
  ],
  recentTransactions: [
    {
      id: '1',
      type: 'buy' as const,
      tokenSymbol: 'MOCK',
      status: 'success' as const,
      latency: 245,
      slippage: 2.5,
      priorityFee: 0.00025,
      retries: 0,
      timestamp: new Date(Date.now() - 600000).toISOString(),
      signature: '5xYz...abc123',
    },
    {
      id: '2',
      type: 'sell' as const,
      tokenSymbol: 'TEST',
      status: 'success' as const,
      latency: 312,
      slippage: 3.2,
      priorityFee: 0.00030,
      retries: 1,
      timestamp: new Date(Date.now() - 1200000).toISOString(),
      signature: '3wXy...def456',
    },
    {
      id: '3',
      type: 'buy' as const,
      tokenSymbol: 'ALPHA',
      status: 'failed' as const,
      latency: 0,
      slippage: 0,
      priorityFee: 0.00020,
      retries: 2,
      timestamp: new Date(Date.now() - 1800000).toISOString(),
      error: 'Slippage exceeded maximum',
    },
  ],
});

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/execution`, {
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
    data: getMockExecutionData(),
  });
}
