const API_URL = process.env.API_URL || 'https://omm-bot.onrender.com'
const API_KEY = process.env.API_KEY

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const level = searchParams.get('level') || ''
  const category = searchParams.get('category') || ''
  const search = searchParams.get('search') || ''
  const limit = searchParams.get('limit') || '100'
  const offset = searchParams.get('offset') || '0'

  const params = new URLSearchParams()
  if (level) params.append('level', level)
  if (category) params.append('category', category)
  if (search) params.append('search', search)
  params.append('limit', limit)
  params.append('offset', offset)

  try {
    const res = await fetch(`${API_URL}/api/logs?${params.toString()}`, {
      headers: {
        'X-API-Key': API_KEY || '',
      },
      cache: 'no-store',
    })

    const data = await res.json()
    return Response.json(data)
  } catch (error) {
    return Response.json(
      { success: false, error: 'Failed to fetch logs' },
      { status: 500 }
    )
  }
}
