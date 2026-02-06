const API_URL = process.env.API_URL || 'https://omm-bot.onrender.com'
const API_KEY = process.env.API_KEY

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/logs/categories`, {
      headers: {
        'X-API-Key': API_KEY || '',
      },
      cache: 'no-store',
    })

    const data = await res.json()
    return Response.json(data)
  } catch (error) {
    return Response.json(
      { success: false, error: 'Failed to fetch categories' },
      { status: 500 }
    )
  }
}
