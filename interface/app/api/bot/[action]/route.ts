import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

// Map frontend actions to backend endpoints
const ACTION_MAP: Record<string, string> = {
  'start': 'start',
  'stop': 'stop',
  'pause': 'pause',
  'resume': 'resume',
  'kill': 'kill',
  'kill-switch': 'kill', // alias
}

export async function POST(
  request: Request,
  { params }: { params: { action: string } }
) {
  const { action } = params
  const backendAction = ACTION_MAP[action]

  if (!backendAction) {
    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(`${API_URL}/api/bot/${backendAction}`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY || '',
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.error || `Failed to ${action} bot`, ...errorData },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error(`Bot ${action} API error:`, error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
