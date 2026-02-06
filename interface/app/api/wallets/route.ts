import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/smart-wallets`, {
      headers: {
        'X-API-Key': API_KEY || '',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch wallets' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Wallets API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const res = await fetch(`${API_URL}/api/smart-wallets`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to add wallet' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Add wallet API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
