import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'https://omm-bot.onrender.com';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const response = await fetch(`${BOT_API_URL}/api/safety/blacklist/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }
    return NextResponse.json({
      success: false,
      error: 'Backend returned error',
      isOffline: true,
    }, { status: 503 });
  } catch (error) {
    console.error('Backend connection failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Backend unavailable',
      message: 'Cannot connect to trading bot backend',
      isOffline: true,
    }, { status: 503 });
  }
}
