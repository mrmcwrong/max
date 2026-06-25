import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleNewsFeed } from '../server/yahooProxy.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await handleNewsFeed(req, res)
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'News feed proxy failed' }))
  }
}
