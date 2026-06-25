import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleMarketBundle } from '../../server/marketBundle.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await handleMarketBundle(req, res)
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Market bundle failed' }))
  }
}
