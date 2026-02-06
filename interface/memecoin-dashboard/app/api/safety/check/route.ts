import { NextRequest, NextResponse } from 'next/server';
import { fetchFromBackend, backendUnavailableResponse, CRITICAL_API_TIMEOUT } from '@/lib/api';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetchFromBackend('/api/safety/check', {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: CRITICAL_API_TIMEOUT,
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({
      ...backendUnavailableResponse('Backend returned error'),
      status: response.status,
      isOffline: true,
    }, { status: 503 });
  } catch (error) {
    console.error('Backend connection failed:', error);
    return NextResponse.json({
      ...backendUnavailableResponse(),
      isOffline: true,
    }, { status: 503 });
  }
}
