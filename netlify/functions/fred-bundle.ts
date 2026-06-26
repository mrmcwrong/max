import { buildFredBundle } from '../../server/fredBundle.js'

type NetlifyEvent = {
  httpMethod: string
  body?: string | null
}

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST required' }) }
  }

  try {
    const body = JSON.parse(event.body ?? '{}') as Parameters<typeof buildFredBundle>[0]
    const bundle = await buildFredBundle(body)

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=300',
      },
      body: JSON.stringify(bundle),
    }
  } catch {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'FRED bundle failed' }),
    }
  }
}
