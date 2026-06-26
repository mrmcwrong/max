import type { IncomingMessage, ServerResponse } from 'node:http'
import { fetchFredHistory } from './fredProxy.js'

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const DAILY_CACHE_TTL_MS = 5 * 60 * 1000
const INTRADAY_CACHE_TTL_MS = 120_000
const FETCH_CONCURRENCY = 10
/** Return partial results before Netlify's hard kill (10s on free tier). */
const FUNCTION_BUDGET_MS = 9_000

const LONG_HISTORY_SYMBOLS = new Set(['^IRX', '2YY=F', '^FVX', '^TNX', '^TYX'])

export type SymbolHistory = {
  symbol: string
  timestamps: number[]
  open: number[]
  close: number[]
}

type CacheEntry = {
  expires: number
  value: SymbolHistory
}

const cache = new Map<string, CacheEntry>()

type YahooChartMeta = {
  regularMarketPrice?: number
  chartPreviousClose?: number
  previousClose?: number
  regularMarketTime?: number
}

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>
          close?: Array<number | null>
        }>
      }
    }>
  }
}

type BundleRequest = {
  symbols?: string[]
  intradayDate?: string
  intradaySymbols?: string[]
  skipDaily?: boolean
}

type BundleResponse = {
  histories: Record<string, SymbolHistory>
  intraday: Record<string, SymbolHistory>
}

function cacheKey(kind: 'daily' | 'intraday', symbol: string, extra = '') {
  return `${kind}:${symbol}:${extra}`
}

function readCache(key: string) {
  const entry = cache.get(key)
  if (!entry || entry.expires <= Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function writeCache(key: string, value: SymbolHistory, ttlMs: number) {
  cache.set(key, { value, expires: Date.now() + ttlMs })
}

function historyFromMeta(meta: YahooChartMeta | undefined, symbol: string): SymbolHistory | null {
  const value = meta?.regularMarketPrice
  const previous = meta?.chartPreviousClose ?? meta?.previousClose

  if (value == null || previous == null || !Number.isFinite(value) || !Number.isFinite(previous)) {
    return null
  }

  if (value <= 0 || previous <= 0) {
    return null
  }

  const now = meta?.regularMarketTime ?? Math.floor(Date.now() / 1000)
  const prior = now - 24 * 60 * 60

  return {
    symbol,
    timestamps: [prior, now],
    open: [previous, value],
    close: [previous, value],
  }
}

function parseChartPayload(payload: YahooChartResponse, symbol: string): SymbolHistory | null {
  const result = payload.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const quote = result?.indicators?.quote?.[0]
  const open = quote?.open ?? []
  const close = quote?.close ?? []

  const hasSeries = timestamps.length > 0 && close.some((value) => value != null)
  if (!hasSeries) {
    return historyFromMeta(result?.meta, symbol)
  }

  const history: SymbolHistory = {
    symbol,
    timestamps: [],
    open: [],
    close: [],
  }

  for (let index = 0; index < timestamps.length; index += 1) {
    const closeValue = close[index]
    if (closeValue == null) {
      continue
    }

    history.timestamps.push(timestamps[index])
    history.close.push(closeValue)
    history.open.push(open[index] ?? closeValue)
  }

  return history.close.length > 0 ? history : historyFromMeta(result?.meta, symbol)
}

async function fetchYahooChart(url: string): Promise<SymbolHistory | null> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': USER_AGENT,
    },
  })

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as YahooChartResponse
  const symbol = decodeURIComponent(url.match(/\/chart\/([^?]+)/)?.[1] ?? '')
  return parseChartPayload(payload, symbol)
}

async function fetchDailyHistory(symbol: string): Promise<SymbolHistory | null> {
  const key = cacheKey('daily', symbol)
  const cached = readCache(key)
  if (cached) {
    return cached
  }

  if (symbol.startsWith('fred:')) {
    const history = await fetchFredHistory(symbol.slice(5))
    if (history) {
      writeCache(key, history, DAILY_CACHE_TTL_MS)
    }
    return history
  }

  const range = LONG_HISTORY_SYMBOLS.has(symbol) ? '2y' : '1y'
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`
  const history = await fetchYahooChart(url)
  if (history) {
    writeCache(key, history, DAILY_CACHE_TTL_MS)
  }
  return history
}

async function fetchIntradayHistory(symbol: string, intradayDate: string): Promise<SymbolHistory | null> {
  if (symbol.startsWith('fred:')) {
    return null
  }

  const key = cacheKey('intraday', symbol, intradayDate)
  const cached = readCache(key)
  if (cached) {
    return cached
  }

  const dayStart = Date.parse(`${intradayDate}T12:00:00Z`) / 1000 - 12 * 60 * 60
  const period1 = Math.floor(dayStart)
  const period2 = period1 + 24 * 60 * 60
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=60m&includePrePost=false`
  const history = await fetchYahooChart(url)
  if (history) {
    writeCache(key, history, INTRADAY_CACHE_TTL_MS)
  }
  return history
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

export async function buildMarketBundle(request: BundleRequest): Promise<BundleResponse> {
  const symbols = [...new Set((request.symbols ?? []).filter(Boolean))]
  const intradaySymbols = [...new Set((request.intradaySymbols ?? []).filter(Boolean))]
  const histories: Record<string, SymbolHistory> = {}
  const intraday: Record<string, SymbolHistory> = {}

  if (!request.skipDaily && symbols.length > 0) {
    const dailyResults = await mapWithConcurrency(
      symbols,
      FETCH_CONCURRENCY,
      async (symbol) => ({
        symbol,
        history: await fetchDailyHistory(symbol),
      }),
      FUNCTION_BUDGET_MS,
    )

    for (const { symbol, history } of dailyResults) {
      if (history) {
        histories[symbol] = history
      }
    }
  }

  if (request.intradayDate && /^\d{4}-\d{2}-\d{2}$/.test(request.intradayDate) && intradaySymbols.length > 0) {
    const intradayResults = await mapWithConcurrency(intradaySymbols, FETCH_CONCURRENCY, async (symbol) => ({
      symbol,
      history: await fetchIntradayHistory(symbol, request.intradayDate!),
    }))

    for (const { symbol, history } of intradayResults) {
      if (history) {
        intraday[symbol] = history
      }
    }
  }

  return { histories, intraday }
}

async function readJsonBody(req: IncomingMessage): Promise<BundleRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BundleRequest
  } catch {
    return {}
  }
}

export async function handleMarketBundle(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'POST required' }))
    return
  }

  try {
    const body = await readJsonBody(req)
    const bundle = await buildMarketBundle(body)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.end(JSON.stringify(bundle))
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Market bundle failed' }))
  }
}
