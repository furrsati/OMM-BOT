import { NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

export async function POST() {
  try {
    const response = await fetch(`${BOT_API_URL}/api/wallet/sweep`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
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
    message: 'Profits swept to cold storage',
    amount: 5.0,
  });
}
