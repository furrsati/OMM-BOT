import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const res = await fetch(`${API_URL}/api/bot/config`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.error || 'Failed to update config', ...errorData },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Bot config API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
