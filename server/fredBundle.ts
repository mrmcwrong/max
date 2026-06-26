import type { IncomingMessage, ServerResponse } from 'node:http'
import { fetchFredHistory, FRED_SERIES_IDS, isAllowedFredSeries, type FredHistory } from './fredProxy.js'

const FETCH_CONCURRENCY = 8
const FUNCTION_BUDGET_MS = 9_000

type FredBundleRequest = {
  series?: string[]
}

type FredBundleResponse = {
  histories: Record<string, FredHistory>
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  deadlineMs = Number.POSITIVE_INFINITY,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const deadline = Date.now() + deadlineMs

  async function run() {
    while (cursor < items.length) {
      if (Date.now() >= deadline) {
        return
      }

      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

export async function buildFredBundle(request: FredBundleRequest = {}): Promise<FredBundleResponse> {
  const requested = [...new Set((request.series ?? [...FRED_SERIES_IDS]).filter(Boolean))]
  const seriesIds = requested.filter((seriesId) => isAllowedFredSeries(seriesId))
  const histories: Record<string, FredHistory> = {}

  const results = await mapWithConcurrency(
    seriesIds,
    FETCH_CONCURRENCY,
    async (seriesId) => ({
      seriesId,
      history: await fetchFredHistory(seriesId),
    }),
    FUNCTION_BUDGET_MS,
  )

  for (const { history } of results) {
    if (history) {
      histories[history.symbol] = history
    }
  }

  return { histories }
}

async function readJsonBody(req: IncomingMessage): Promise<FredBundleRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as FredBundleRequest
  } catch {
    return {}
  }
}

export async function handleFredBundle(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'POST required' }))
    return
  }

  try {
    const body = await readJsonBody(req)
    const bundle = await buildFredBundle(body)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.end(JSON.stringify(bundle))
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'FRED bundle failed' }))
  }
}
