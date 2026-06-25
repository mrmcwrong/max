import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleMovers } from '../../server/yahooProxy.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await handleMovers(req, res)
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Yahoo movers proxy failed' }))
  }
}
