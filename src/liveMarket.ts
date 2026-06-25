import type { TimeFrame, Unit } from './instrumentCatalog'

export type TimeMode = 'open' | 'close' | 'custom'

export type SymbolHistory = {
  symbol: string
  timestamps: number[]
  open: number[]
  close: number[]
}

export type ComputedQuote = {
  value: number
  changePct: number
  changeValue: number
  series: number[]
}

const HISTORY_RANGE = '2y'

const frameDays: Record<TimeFrame, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '3M': 91,
  '1Y': 365,
}

const DAY_MS = 24 * 60 * 60 * 1000

type YahooChartResponse = {
  chart?: {
    result?: Array<{
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

function parseChartPayload(payload: YahooChartResponse, symbol: string): SymbolHistory | null {
  const result = payload.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const quote = result?.indicators?.quote?.[0]
  const open = quote?.open ?? []
  const close = quote?.close ?? []

  if (timestamps.length === 0 || close.length === 0) {
    return null
  }

  const cleanTimestamps: number[] = []
  const cleanOpen: number[] = []
  const cleanClose: number[] = []

  for (let index = 0; index < timestamps.length; index += 1) {
    const closeValue = close[index]
    if (closeValue == null) {
      continue
    }

    cleanTimestamps.push(timestamps[index])
    cleanClose.push(closeValue)
    cleanOpen.push(open[index] ?? closeValue)
  }

  if (cleanClose.length === 0) {
    return null
  }

  return { symbol, timestamps: cleanTimestamps, open: cleanOpen, close: cleanClose }
}

export async function fetchSymbolHistory(symbol: string): Promise<SymbolHistory | null> {
  if (symbol.startsWith('fred:')) {
    const seriesId = symbol.slice(5)
    const response = await fetch(
      `/api/fred/history?series=${encodeURIComponent(seriesId)}`,
      { cache: 'no-store' },
    )

    if (!response.ok) {
      throw new Error(`FRED history request failed for ${seriesId}`)
    }

    return (await response.json()) as SymbolHistory
  }

  const response = await fetch(
    `/api/yahoo/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(HISTORY_RANGE)}`,
    { cache: 'no-store' },
  )

  if (!response.ok) {
    throw new Error(`History request failed for ${symbol}`)
  }

  const payload = (await response.json()) as YahooChartResponse
  return parseChartPayload(payload, symbol)
}

export async function fetchIntradayHistory(
  symbol: string,
  dayStartMs: number,
): Promise<SymbolHistory | null> {
  if (symbol.startsWith('fred:')) {
    return null
  }

  const period1 = Math.floor(dayStartMs / 1000)
  const period2 = period1 + 24 * 60 * 60
  const response = await fetch(
    `/api/yahoo/chart?symbol=${encodeURIComponent(symbol)}&interval=60m&period1=${period1}&period2=${period2}`,
    { cache: 'no-store' },
  )

  if (!response.ok) {
    throw new Error(`Intraday request failed for ${symbol}`)
  }

  const payload = (await response.json()) as YahooChartResponse
  return parseChartPayload(payload, symbol)
}

async function fetchInBatches(
  symbols: string[],
  loader: (symbol: string) => Promise<SymbolHistory | null>,
): Promise<Map<string, SymbolHistory>> {
  const unique = [...new Set(symbols.filter(Boolean))]
  const map = new Map<string, SymbolHistory>()
  const batchSize = 8

  for (let index = 0; index < unique.length; index += batchSize) {
    const batch = unique.slice(index, index + batchSize)
    const results = await Promise.allSettled(batch.map((symbol) => loader(symbol)))

    results.forEach((result, offset) => {
      if (result.status === 'fulfilled' && result.value) {
        map.set(batch[offset], result.value)
      }
    })
  }

  return map
}

export async function fetchAllHistories(symbols: string[]): Promise<Map<string, SymbolHistory>> {
  return fetchInBatches(symbols, fetchSymbolHistory)
}

export async function fetchAllIntraday(
  symbols: string[],
  dayStartMs: number,
): Promise<Map<string, SymbolHistory>> {
  return fetchInBatches(symbols, (symbol) => fetchIntradayHistory(symbol, dayStartMs))
}

function indexAtOrBefore(timestamps: number[], targetMs: number, upperBound = timestamps.length - 1) {
  let found = -1

  for (let index = 0; index <= upperBound; index += 1) {
    if (timestamps[index] * 1000 <= targetMs) {
      found = index
    } else {
      break
    }
  }

  return found
}

export function computeQuote(
  history: SymbolHistory,
  snapshotDateMs: number,
  timeMode: TimeMode,
  timeFrame: TimeFrame,
): ComputedQuote | null {
  const { timestamps, open, close } = history

  let endIndex = indexAtOrBefore(timestamps, snapshotDateMs)
  if (endIndex < 0) {
    endIndex = 0
  }

  const value = (timeMode === 'open' ? open[endIndex] : close[endIndex]) ?? close[endIndex]

  let startIndex: number
  if (timeFrame === '1D') {
    startIndex = Math.max(endIndex - 1, 0)
  } else {
    const targetMs = (timestamps[endIndex] ?? snapshotDateMs / 1000) * 1000 - frameDays[timeFrame] * DAY_MS
    const located = indexAtOrBefore(timestamps, targetMs, endIndex)
    startIndex = located < 0 ? 0 : located
  }

  const previous = close[startIndex] ?? value
  const changeValue = value - previous
  const changePct = previous === 0 ? 0 : (changeValue / previous) * 100

  const windowSeries = close.slice(startIndex, endIndex + 1)
  const series = windowSeries.length > 1 ? windowSeries : close.slice(Math.max(endIndex - 24, 0), endIndex + 1)

  return { value, changePct, changeValue, series }
}

export function computeIntradayQuote(
  daily: SymbolHistory,
  intraday: SymbolHistory | undefined,
  snapshotDateMs: number,
  customMs: number,
  timeFrame: TimeFrame,
): ComputedQuote | null {
  let value: number | undefined
  let intradaySeries: number[] = []

  if (intraday && intraday.timestamps.length > 0) {
    const located = indexAtOrBefore(intraday.timestamps, customMs)
    const useIndex = located < 0 ? 0 : located
    value = intraday.close[useIndex]
    intradaySeries = intraday.close.slice(0, useIndex + 1)
  }

  let endIndex = indexAtOrBefore(daily.timestamps, snapshotDateMs)
  if (endIndex < 0) {
    endIndex = 0
  }

  if (value == null) {
    value = daily.close[endIndex]
  }
  if (value == null) {
    return null
  }

  let startIndex: number
  if (timeFrame === '1D') {
    startIndex = Math.max(endIndex - 1, 0)
  } else {
    const targetMs = (daily.timestamps[endIndex] ?? snapshotDateMs / 1000) * 1000 - frameDays[timeFrame] * DAY_MS
    const located = indexAtOrBefore(daily.timestamps, targetMs, endIndex)
    startIndex = located < 0 ? 0 : located
  }

  const previous = daily.close[startIndex] ?? value
  const changeValue = value - previous
  const changePct = previous === 0 ? 0 : (changeValue / previous) * 100

  const series =
    intradaySeries.length > 1 ? intradaySeries : daily.close.slice(startIndex, endIndex + 1)

  return { value, changePct, changeValue, series }
}

export function computeCurvePoint(history: SymbolHistory, snapshotDateMs: number) {
  const { timestamps, close } = history
  const currentIndex = Math.max(indexAtOrBefore(timestamps, snapshotDateMs), 0)
  const monthIndex = Math.max(indexAtOrBefore(timestamps, snapshotDateMs - 30 * DAY_MS, currentIndex), 0)
  const yearIndex = Math.max(indexAtOrBefore(timestamps, snapshotDateMs - 365 * DAY_MS, currentIndex), 0)

  return {
    current: close[currentIndex],
    oneMonthAgo: close[monthIndex],
    oneYearAgo: close[yearIndex],
  }
}

export async function fetchLiveHeadlines(date?: string) {
  const query = date ? `?date=${encodeURIComponent(date)}` : ''
  const response = await fetch(`/api/news${query}`, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error('News request failed')
  }

  return (await response.json()) as Array<{
    category: string
    title: string
    detail: string
    url?: string
  }>
}

export type MarketMover = {
  symbol: string
  name: string
  value: number
  changePct: number
  changeValue: number
}

export type MarketMovers = {
  gainers: MarketMover[]
  losers: MarketMover[]
  actives: MarketMover[]
}

export async function fetchMarketMovers(): Promise<MarketMovers> {
  const response = await fetch('/api/yahoo/movers', { cache: 'no-store' })

  if (!response.ok) {
    throw new Error('Movers request failed')
  }

  const payload = (await response.json()) as Partial<MarketMovers>
  return {
    gainers: payload.gainers ?? [],
    losers: payload.losers ?? [],
    actives: payload.actives ?? [],
  }
}

export function yahooQuoteUrl(symbol: string) {
  if (symbol.startsWith('fred:')) {
    return `https://fred.stlouisfed.org/series/${encodeURIComponent(symbol.slice(5))}`
  }

  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`
}

export function formatPercentWithAmount(changePct: number, changeValue: number, unit: Unit) {
  const sign = changePct >= 0 ? '+' : ''
  const percent = `${sign}${changePct.toFixed(2)}%`
  const amount = formatSignedAmount(changeValue, unit)

  return `${percent} (${amount})`
}

export function formatSignedAmount(value: number, unit: Unit) {
  const prefix = value >= 0 ? '+' : '-'
  const absolute = Math.abs(value)

  if (unit === 'yield' || unit === 'rate') {
    const basisPoints = Math.round(absolute * 100)
    return `${prefix}${basisPoints} bps`
  }

  if (unit === 'fx') {
    return `${prefix}${absolute.toFixed(4)}`
  }

  if (unit === 'price') {
    return absolute >= 1000 ? `${prefix}$${absolute.toFixed(0)}` : `${prefix}$${absolute.toFixed(2)}`
  }

  return absolute >= 1000 ? `${prefix}${absolute.toFixed(1)}` : `${prefix}${absolute.toFixed(2)}`
}
