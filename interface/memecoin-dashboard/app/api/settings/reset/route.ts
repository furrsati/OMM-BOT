import { NextResponse } from 'next/server';
import { fetchFromBackend, backendUnavailableResponse } from '@/lib/api';

export async function POST() {
  try {
    const response = await fetchFromBackend('/api/settings/reset', {
      method: 'POST',
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
