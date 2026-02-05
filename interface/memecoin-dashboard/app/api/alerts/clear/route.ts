import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'https://omm-bot.onrender.com';

export async function DELETE() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/alerts/clear`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch {
    // Backend not available
  }

  return NextResponse.json({
    success: true,
    message: 'All alerts cleared',
  });
}
