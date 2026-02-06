import { NextRequest, NextResponse } from 'next/server';
import { fetchFromBackend, backendUnavailableResponse } from '@/lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  try {
    const response = await fetchFromBackend(`/api/execution/rpc/${encodeURIComponent(name)}/test`, {
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
