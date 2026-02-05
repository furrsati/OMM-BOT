import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/scanner`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return NextResponse.json({ success: true, data: data.data });
      }
      return NextResponse.json({ success: true, data: { opportunities: [], stats: { total: 0, analyzing: 0, qualified: 0, rejected: 0, entered: 0, avgConviction: 0 } } });
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
      message: 'Cannot connect to trading bot backend.',
      backendUrl: BOT_API_URL,
      isOffline: true,
    }, { status: 503 });
  }
}
