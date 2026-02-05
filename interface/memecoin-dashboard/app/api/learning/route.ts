import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

export async function GET() {
  try {
    // Fetch all learning data from multiple endpoints
    const [weightsRes, parametersRes, patternsRes] = await Promise.all([
      fetch(`${BOT_API_URL}/api/learning/weights`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`${BOT_API_URL}/api/learning/parameters`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`${BOT_API_URL}/api/learning/patterns`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(10000),
      }),
    ]);

    if (weightsRes.ok && parametersRes.ok && patternsRes.ok) {
      const weightsData = await weightsRes.json();
      const parametersData = await parametersRes.json();
      const patternsData = await patternsRes.json();

      return NextResponse.json({
        success: true,
        data: {
          stats: {
            totalTrades: 0,
            tradesAnalyzed: 0,
            lastOptimization: null,
            nextOptimization: 0,
            totalAdjustments: 0,
            driftFromBaseline: 0,
            learningMode: 'active' as const,
          },
          weights: weightsData.data || [],
          parameters: parametersData.data || [],
          winPatterns: patternsData.data?.winPatterns || [],
          dangerPatterns: patternsData.data?.dangerPatterns || [],
        },
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Backend returned error',
      status: weightsRes.status,
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
