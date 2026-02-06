import { NextRequest, NextResponse } from 'next/server';
import { fetchFromBackend, backendUnavailableResponse } from '@/lib/api';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetchFromBackend('/api/execution/rpc/primary', {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: 10000,
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }
    return NextResponse.json({
      ...backendUnavailableResponse('Backend returned error'),
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
