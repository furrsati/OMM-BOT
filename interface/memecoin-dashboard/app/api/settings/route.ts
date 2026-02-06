import { NextRequest, NextResponse } from 'next/server';
import { fetchFromBackend, backendUnavailableResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await fetchFromBackend('/api/settings', {
      cache: 'no-store',
      timeout: 10000,
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

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetchFromBackend('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
      timeout: 10000,
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
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
