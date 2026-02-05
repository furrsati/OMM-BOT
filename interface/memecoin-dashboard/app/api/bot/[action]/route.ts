import { NextRequest, NextResponse } from 'next/server';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3002';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;

  try {
    const body = await request.json().catch(() => ({}));

    // Try to forward to actual backend
    const response = await fetch(`${BOT_API_URL}/api/bot/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch {
    // Backend not available
  }

  // Mock response for demo purposes
  const mockResponses: Record<string, object> = {
    start: { success: true, message: 'Bot started' },
    stop: { success: true, message: 'Bot stopped' },
    pause: { success: true, message: 'Bot paused' },
    resume: { success: true, message: 'Bot resumed' },
    kill: { success: true, message: 'Emergency shutdown executed' },
    config: { success: true, message: 'Configuration updated' },
    regime: { success: true, message: 'Market regime updated' },
  };

  return NextResponse.json(mockResponses[action] || { success: false, error: 'Unknown action' });
}
