import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'https://omm-bot.onrender.com';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/execution`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ success: true, data });
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
