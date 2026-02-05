import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/positions/current`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      // Transform backend format to frontend format
      if (data.success && data.data?.positions) {
        const positions = data.data.positions.map((p: any) => ({
          id: p.id,
          tokenAddress: p.tokenAddress,
          tokenName: p.tokenName || 'Unknown',
          tokenSymbol: p.tokenSymbol || 'UNKNOWN',
          entryPrice: p.entry?.price || 0,
          currentPrice: p.current?.price || p.entry?.price || 0,
          quantity: p.remainingAmount || p.entry?.amount || 0,
          entryTime: p.entry?.time || new Date().toISOString(),
          pnl: p.pnl?.usd || 0,
          pnlPercent: p.pnl?.percent || 0,
          stopLoss: p.stopLoss?.price || 0,
          takeProfit: [],
          convictionScore: p.entry?.conviction || 0,
          smartWalletCount: p.smartWallets?.length || 0,
        }));
        return NextResponse.json({ success: true, data: positions });
      }
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json({
      success: false,
      error: 'Backend returned error',
      status: response.status,
      backendUrl: BOT_API_URL,
      isOffline: true,
    }, { status: 503 });
  } catch (error) {
    console.error('Backend connection failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Backend unavailable',
      message: 'Cannot connect to trading bot backend. Ensure BOT_API_URL is set correctly in Render environment variables.',
      backendUrl: BOT_API_URL,
      isOffline: true,
    }, { status: 503 });
  }
}
