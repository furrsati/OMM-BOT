import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/trades/stats`, {
      headers: {
        'X-API-Key': API_KEY || '',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch trade stats' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Trade stats API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
