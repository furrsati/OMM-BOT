import { NextRequest, NextResponse } from 'next/server';
import { fetchFromBackend, backendUnavailableResponse, CRITICAL_API_TIMEOUT, CONTROL_API_TIMEOUT } from '@/lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;

  try {
    const body = await request.json().catch(() => ({}));

    // Kill switch needs longer timeout for emergency position exits
    // Other control actions use shorter timeout for better UX
    const timeoutMs = action === 'kill' ? CRITICAL_API_TIMEOUT : CONTROL_API_TIMEOUT;

    const response = await fetchFromBackend(`/api/bot/${action}`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: timeoutMs,
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({
      ...backendUnavailableResponse('Backend returned error'),
      action,
      status: response.status,
      isOffline: true,
    }, { status: 503 });
  } catch (error) {
    console.error('Backend connection failed:', error);
    return NextResponse.json({
      ...backendUnavailableResponse(),
      action,
      isOffline: true,
    }, { status: 503 });
  }
}
