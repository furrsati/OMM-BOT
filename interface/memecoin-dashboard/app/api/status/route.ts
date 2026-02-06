import { NextResponse } from 'next/server';
import {
  fetchFromBackend,
  backendUnavailableResponse,
  BOT_API_URL,
} from '@/lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const response = await fetchFromBackend('/api/status', {
      cache: 'no-store',
      timeout: 5000,
    });

    if (response.ok) {
      // Backend already returns { success: true, data: {...} }
      // Pass it through directly without double-wrapping
      const backendResponse = await response.json();
      return NextResponse.json(backendResponse);
    }

    // Backend returned an error
    return NextResponse.json({
      success: false,
      error: 'Backend returned error',
      status: response.status,
      backendUrl: BOT_API_URL,
      isOffline: true,
    }, { status: 503 });
  } catch (error) {
    // Backend not available
    console.error('Backend connection failed:', error);
    return NextResponse.json({
      ...backendUnavailableResponse('Cannot connect to trading bot backend. Ensure BOT_API_URL is set correctly.'),
      isOffline: true,
    }, { status: 503 });
  }
}
