import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const endpoint = searchParams.get('endpoint') || 'weights'

    const validEndpoints = ['weights', 'parameters', 'patterns', 'snapshots']
    if (!validEndpoints.includes(endpoint)) {
      return NextResponse.json(
        { error: 'Invalid endpoint' },
        { status: 400 }
      )
    }

    const res = await fetch(`${API_URL}/api/learning/${endpoint}`, {
      headers: {
        'X-API-Key': API_KEY || '',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch learning data' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Learning API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
