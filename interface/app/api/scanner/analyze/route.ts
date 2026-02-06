const API_URL = process.env.API_URL || 'https://omm-bot.onrender.com'
const API_KEY = process.env.API_KEY

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const res = await fetch(`${API_URL}/api/scanner/analyze`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch (error) {
    return Response.json(
      { success: false, error: 'Failed to analyze token' },
      { status: 500 }
    )
  }
}
