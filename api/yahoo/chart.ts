import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleYahooChart } from '../../server/yahooProxy.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await handleYahooChart(req, res)
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Yahoo chart proxy failed' }))
  }
}
