import { NextResponse } from 'next/server';
import { fetchFromBackend, BOT_API_URL } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Lightweight health check endpoint
 * Used by dashboard to quickly verify backend connectivity
 * Shorter timeout than other endpoints for fast fail
 */
export async function GET() {
  const startTime = Date.now();

  try {
    const response = await fetchFromBackend('/api/status/health', {
      timeout: 3000, // Very short timeout for quick health check
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        success: true,
        backend: 'online',
        latency,
        backendUrl: BOT_API_URL,
        services: data.data?.services || {},
      });
    }

    return NextResponse.json({
      success: false,
      backend: 'degraded',
      latency,
      backendUrl: BOT_API_URL,
      status: response.status,
    }, { status: 503 });
  } catch (error: any) {
    const latency = Date.now() - startTime;

    return NextResponse.json({
      success: false,
      backend: 'offline',
      latency,
      backendUrl: BOT_API_URL,
      error: error.name === 'AbortError' ? 'timeout' : 'connection_failed',
    }, { status: 503 });
  }
}
