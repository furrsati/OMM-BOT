import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

export async function POST(
  request: Request,
  { params }: { params: { tokenAddress: string } }
) {
  try {
    const res = await fetch(
      `${API_URL}/api/paper-trading/positions/${params.tokenAddress}/close`,
      {
        method: 'POST',
        headers: {
          'X-API-Key': API_KEY || '',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!res.ok) {
      const error = await res.json()
      return NextResponse.json(
        { error: error.error || 'Failed to close position' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Close paper position API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
