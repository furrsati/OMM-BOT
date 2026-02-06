import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = searchParams.get('limit') || '50'
    const offset = searchParams.get('offset') || '0'

    const res = await fetch(
      `${API_URL}/api/trades/recent?limit=${limit}&offset=${offset}`,
      {
        headers: {
          'X-API-Key': API_KEY || '',
        },
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch trades' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Trades API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
