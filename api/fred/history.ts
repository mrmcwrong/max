import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleFredHistory } from '../server/fredProxy.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await handleFredHistory(req, res)
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'FRED history proxy failed' }))
  }
}
