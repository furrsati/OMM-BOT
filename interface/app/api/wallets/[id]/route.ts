import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const res = await fetch(`${API_URL}/api/smart-wallets/${params.id}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': API_KEY || '',
      },
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to delete wallet' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Delete wallet API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()

    const res = await fetch(`${API_URL}/api/smart-wallets/${params.id}`, {
      method: 'PATCH',
      headers: {
        'X-API-Key': API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to update wallet' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Update wallet API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
