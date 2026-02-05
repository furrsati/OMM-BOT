import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'https://omm-bot.onrender.com';

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
