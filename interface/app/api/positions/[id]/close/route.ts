import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const res = await fetch(`${API_URL}/api/positions/${params.id}/close`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY || '',
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to close position' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Close position API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
