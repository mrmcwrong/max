import { buildMarketBundle } from '../../server/marketBundle.js'

type NetlifyEvent = {
  httpMethod: string
  body?: string | null
}

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST required' }) }
  }

  try {
    const body = JSON.parse(event.body ?? '{}') as Parameters<typeof buildMarketBundle>[0]
    const bundle = await buildMarketBundle(body)

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=60',
      },
      body: JSON.stringify(bundle),
    }
  } catch {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Market bundle failed' }),
    }
  }
}
