import { collectUsEquityPrioritySymbols, collectFixedIncomeSymbols, type TimeFrame, type Unit } from './instrumentCatalog'
import { collectCountryIndexSymbols } from './barometer/countryIndexCatalog'

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

const frameDays: Record<TimeFrame, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '3M': 91,
  '1Y': 365,
}

const frameLookback: Record<TimeFrame, number> = {
  '1D': 5,
  '1W': 7,
  '1M': 22,
  '3M': 66,
  '1Y': 252,
}

const DAY_MS = 24 * 60 * 60 * 1000
const SESSION_CACHE_TTL_MS = 30 * 60 * 1000
const LOCAL_CACHE_TTL_MS = 4 * 60 * 60 * 1000
const BUNDLE_CHUNK_SIZE = 12
const LOCAL_CACHE_PREFIX = 'max:local:daily:v2:'
const SYMBOL_CACHE_PREFIX = 'max:sym:v1:'
const MAP_BUNDLE_CACHE_KEY = 'max:map:daily:v1:country-indexes'
const US_EQUITY_BUNDLE_CACHE_KEY = 'max:us-equity:daily:v1:priority'
const FIXED_INCOME_BUNDLE_CACHE_KEY = 'max:fixed-income:daily:v1'
const MIN_BUNDLE_COVERAGE = 0.6
const MIN_MAP_COVERAGE = 0.85
const MAX_CONCURRENT_BUNDLE_REQUESTS = 2

type MarketBundleRequest = {
  symbols: string[]
  intradayDate?: string
  intradaySymbols?: string[]
  skipDaily?: boolean
  force?: boolean
}

type MarketBundleResult = {
  histories: Map<string, SymbolHistory>
  intraday: Map<string, SymbolHistory>
}

type MarketBundleProgress = (bundle: MarketBundleResult) => void

type MarketBundleCache = {
  histories: Record<string, SymbolHistory>
  intraday: Record<string, SymbolHistory>
}

type CachedBundle = {
  expires: number
  data: MarketBundleCache
}

type SymbolCacheEntry = {
  expires: number
  history: SymbolHistory
}

let activeBundleRequests = 0
const bundleWaiters: Array<() => void> = []

function readSessionCache(key: string): MarketBundleCache | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as CachedBundle
    if (parsed.expires <= Date.now()) {
      sessionStorage.removeItem(key)
      return null
    }

    return parsed.data
  } catch {
    return null
  }
}

function writeSessionCache(key: string, data: MarketBundleCache, ttlMs = SESSION_CACHE_TTL_MS) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ expires: Date.now() + ttlMs, data }))
  } catch {
    // Ignore storage quota errors.
  }
}

function readLocalCache(key: string): CachedBundle | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_CACHE_PREFIX}${key}`)
    if (!raw) {
      return null
    }

    return JSON.parse(raw) as CachedBundle
  } catch {
    return null
  }
}

function writeLocalCache(key: string, data: MarketBundleCache) {
  try {
    localStorage.setItem(
      `${LOCAL_CACHE_PREFIX}${key}`,
      JSON.stringify({ expires: Date.now() + LOCAL_CACHE_TTL_MS, data }),
    )
  } catch {
    // Ignore storage quota errors.
  }
}

function readSymbolHistory(symbol: string): SymbolHistory | null {
  try {
    const raw = localStorage.getItem(`${SYMBOL_CACHE_PREFIX}${symbol}`)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as SymbolCacheEntry
    if (parsed.expires <= Date.now()) {
      return null
    }

    return parsed.history
  } catch {
    return null
  }
}

function writeSymbolHistory(history: SymbolHistory) {
  try {
    localStorage.setItem(
      `${SYMBOL_CACHE_PREFIX}${history.symbol}`,
      JSON.stringify({ expires: Date.now() + LOCAL_CACHE_TTL_MS, history }),
    )
  } catch {
    // Ignore storage quota errors.
  }
}

function readSymbolHistories(symbols: string[]) {
  const histories = new Map<string, SymbolHistory>()
  for (const symbol of symbols) {
    const history = readSymbolHistory(symbol)
    if (history) {
      histories.set(symbol, history)
    }
  }
  return histories
}

function writeSymbolHistories(histories: Record<string, SymbolHistory>) {
  for (const history of Object.values(histories)) {
    if (history?.symbol) {
      writeSymbolHistory(history)
    }
  }
}

function symbolsNeedingFetch(symbols: string[], force?: boolean) {
  if (force) {
    return symbols
  }

  return symbols.filter((symbol) => !readSymbolHistory(symbol))
}

async function withBundleSlot<T>(work: () => Promise<T>): Promise<T> {
  while (activeBundleRequests >= MAX_CONCURRENT_BUNDLE_REQUESTS) {
    await new Promise<void>((resolve) => bundleWaiters.push(resolve))
  }

  activeBundleRequests += 1
  try {
    return await work()
  } finally {
    activeBundleRequests -= 1
    const next = bundleWaiters.shift()
    if (next) {
      next()
    }
  }
}

function readCachedDaily(key: string) {
  const local = readLocalCache(key)
  if (local && local.expires > Date.now()) {
    return { data: local.data, fresh: true, source: 'local' as const }
  }

  const session = readSessionCache(key)
  if (session) {
    return { data: session, fresh: true, source: 'session' as const }
  }

  if (local) {
    return { data: local.data, fresh: false, source: 'local' as const }
  }

  return null
}

function writeDailyCache(key: string, data: MarketBundleCache) {
  writeSessionCache(key, data)
  writeLocalCache(key, data)
}

/** Hydrate the UI immediately from device cache before network requests finish. */
export function hydrateMarketCache(symbols: string[]): MarketBundleResult | null {
  const histories = readSymbolHistories(symbols)
  const cached = readCachedDaily(dailyCacheKey(symbols))

  if (cached) {
    for (const [symbol, history] of Object.entries(cached.data.histories)) {
      if (!histories.has(symbol)) {
        histories.set(symbol, history)
      }
    }
  }

  if (histories.size === 0) {
    return null
  }

  return { histories, intraday: new Map() }
}

export function hydrateCountryMapCache(): MarketBundleResult | null {
  const cached = readCachedDaily(MAP_BUNDLE_CACHE_KEY)
  if (!cached) {
    return null
  }

  return mapsFromCache(cached.data)
}

function pinnedCacheKey(symbols: string[]) {
  return `max:pinned:daily:v1:${[...symbols].sort().join('|')}`
}

export function hydratePinnedCache(symbols: string[]): MarketBundleResult | null {
  if (symbols.length === 0) {
    return null
  }

  const cached = readCachedDaily(pinnedCacheKey(symbols))
  if (!cached) {
    return null
  }

  return mapsFromCache(cached.data)
}

function dailyCacheKey(symbols: string[]) {
  return `max:daily:v7:${[...symbols].sort().join('|')}`
}

function bundleCoverage(symbols: string[], data: MarketBundleCache) {
  if (symbols.length === 0) {
    return 1
  }

  const hits = symbols.filter((symbol) => data.histories[symbol]).length
  return hits / symbols.length
}

function mergeBundleCaches(existing: MarketBundleCache, incoming: MarketBundleCache): MarketBundleCache {
  return {
    histories: { ...existing.histories, ...incoming.histories },
    intraday: { ...existing.intraday, ...incoming.intraday },
  }
}

function intradayCacheKey(date: string, symbols: string[]) {
  return `max:intraday:${date}:${[...symbols].sort().join('|')}`
}

function mapsFromCache(data: MarketBundleCache) {
  return {
    histories: new Map(Object.entries(data.histories)),
    intraday: new Map(Object.entries(data.intraday)),
  }
}

function chunkSymbols(symbols: string[]) {
  const unique = [...new Set(symbols.filter(Boolean))]
  const chunks: string[][] = []

  for (let index = 0; index < unique.length; index += BUNDLE_CHUNK_SIZE) {
    chunks.push(unique.slice(index, index + BUNDLE_CHUNK_SIZE))
  }

  return chunks
}

async function postMarketBundle(body: {
  symbols: string[]
  intradayDate?: string
  intradaySymbols?: string[]
  skipDaily?: boolean
}): Promise<MarketBundleCache> {
  return withBundleSlot(async () => {
    const response = await fetch('/api/markets/bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Market bundle request failed (${response.status})`)
    }

    const payload = (await response.json()) as MarketBundleCache
    if (!body.skipDaily) {
      writeSymbolHistories(payload.histories)
    }
    return payload
  })
}

function seedBundleFromCaches(
  symbols: string[],
  dailyKey: string,
  mergedHistories: Record<string, SymbolHistory>,
  mergedIntraday: Record<string, SymbolHistory>,
) {
  for (const [symbol, history] of readSymbolHistories(symbols)) {
    mergedHistories[symbol] = history
  }

  const existingDaily = readCachedDaily(dailyKey)?.data
  if (existingDaily) {
    Object.assign(mergedHistories, existingDaily.histories)
    Object.assign(mergedIntraday, existingDaily.intraday)
  }
}

function persistBundleProgress(
  symbols: string[],
  dailyKey: string,
  cachePayload: MarketBundleCache,
  existingDaily?: MarketBundleCache,
) {
  writeSymbolHistories(cachePayload.histories)

  if (bundleCoverage(symbols, cachePayload) >= MIN_BUNDLE_COVERAGE) {
    writeDailyCache(dailyKey, cachePayload)
    return
  }

  if (existingDaily) {
    writeDailyCache(dailyKey, mergeBundleCaches(existingDaily, cachePayload))
    return
  }

  writeDailyCache(dailyKey, cachePayload)
}

export async function fetchMarketBundle(request: MarketBundleRequest, onProgress?: MarketBundleProgress) {
  const requestedSymbols = [...new Set(request.symbols.filter(Boolean))]
  const symbolsToFetch = symbolsNeedingFetch(requestedSymbols, request.force)
  const dailyKey = dailyCacheKey(requestedSymbols)
  const intradayKey =
    request.intradayDate && request.intradaySymbols?.length
      ? intradayCacheKey(request.intradayDate, request.intradaySymbols)
      : null

  const cachedHistories = readSymbolHistories(requestedSymbols)
  if (cachedHistories.size > 0) {
    onProgress?.({ histories: cachedHistories, intraday: new Map() })
  }

  if (!request.force) {
    if (request.skipDaily && intradayKey) {
      const cachedIntraday = readSessionCache(intradayKey)
      if (cachedIntraday) {
        const result = {
          histories: cachedHistories,
          intraday: new Map(Object.entries(cachedIntraday.intraday)),
        }
        onProgress?.(result)
        return result
      }
    } else if (!request.skipDaily && !request.intradayDate) {
      const cachedDaily = readCachedDaily(dailyKey)
      if (cachedDaily) {
        const merged = new Map(cachedHistories)
        for (const [symbol, history] of Object.entries(cachedDaily.data.histories)) {
          merged.set(symbol, history)
        }
        const result = { histories: merged, intraday: new Map() }
        onProgress?.(result)
        const coverage = bundleCoverage(requestedSymbols, {
          histories: Object.fromEntries(merged),
          intraday: {},
        })
        if (cachedDaily.fresh && coverage >= MIN_BUNDLE_COVERAGE) {
          return result
        }
      }
    }
  }

  if (symbolsToFetch.length === 0 && !request.intradayDate) {
    return { histories: cachedHistories, intraday: new Map() }
  }

  const useSingleRequest =
    request.skipDaily || symbolsToFetch.length <= BUNDLE_CHUNK_SIZE

  if (useSingleRequest) {
    const payload = await postMarketBundle({
      symbols: symbolsToFetch,
      intradayDate: request.intradayDate,
      intradaySymbols: request.intradaySymbols,
      skipDaily: request.skipDaily ?? false,
    })

    if (request.skipDaily) {
      if (intradayKey) {
        writeSessionCache(intradayKey, { histories: {}, intraday: payload.intraday })
      }

      const result = {
        histories: cachedHistories,
        intraday: new Map(Object.entries(payload.intraday)),
      }
      onProgress?.(result)
      return result
    }

    const histories = new Map(cachedHistories)
    for (const [symbol, history] of Object.entries(payload.histories)) {
      histories.set(symbol, history)
    }

    const cachePayload = {
      histories: Object.fromEntries(histories),
      intraday: {},
    }
    persistBundleProgress(requestedSymbols, dailyKey, cachePayload)
    if (intradayKey && request.intradayDate) {
      writeSessionCache(intradayKey, { histories: {}, intraday: payload.intraday })
    }

    const result = { histories, intraday: new Map() }
    onProgress?.(result)
    return result
  }

  const chunks = chunkSymbols(symbolsToFetch)
  const mergedHistories: Record<string, SymbolHistory> = {}
  const mergedIntraday: Record<string, SymbolHistory> = {}
  let completedChunks = 0
  const existingDaily = readCachedDaily(dailyKey)?.data

  seedBundleFromCaches(requestedSymbols, dailyKey, mergedHistories, mergedIntraday)

  if (Object.keys(mergedHistories).length > 0) {
    onProgress?.({
      histories: new Map(Object.entries(mergedHistories)),
      intraday: new Map(Object.entries(mergedIntraday)),
    })
  }

  for (const symbols of chunks) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await postMarketBundle({ symbols, skipDaily: false })
        Object.assign(mergedHistories, payload.histories)
        completedChunks += 1
        onProgress?.({
          histories: new Map(Object.entries(mergedHistories)),
          intraday: new Map(Object.entries(mergedIntraday)),
        })
        persistBundleProgress(
          requestedSymbols,
          dailyKey,
          { histories: mergedHistories, intraday: mergedIntraday },
          existingDaily,
        )
        break
      } catch {
        if (attempt === 1) {
          // Keep partial results from successful chunks.
        }
      }
    }
  }

  if (completedChunks === 0 && Object.keys(mergedHistories).length === 0) {
    throw new Error('Market bundle request failed')
  }

  const result = {
    histories: new Map(Object.entries(mergedHistories)),
    intraday: new Map(Object.entries(mergedIntraday)),
  }
  onProgress?.(result)
  return result
}

async function fetchChunkedBundle(
  symbols: string[],
  cacheKey: string,
  minCoverage: number,
  onProgress?: MarketBundleProgress,
  options?: { force?: boolean },
): Promise<MarketBundleResult> {
  const cachedHistories = readSymbolHistories(symbols)
  if (cachedHistories.size > 0) {
    onProgress?.({ histories: cachedHistories, intraday: new Map() })
  }

  if (!options?.force) {
    const cached = readCachedDaily(cacheKey)
    if (cached) {
      const merged = new Map(cachedHistories)
      for (const [symbol, history] of Object.entries(cached.data.histories)) {
        merged.set(symbol, history)
      }
      onProgress?.({ histories: merged, intraday: new Map() })
      const coverage = bundleCoverage(symbols, {
        histories: Object.fromEntries(merged),
        intraday: {},
      })
      if (cached.fresh && coverage >= minCoverage) {
        return { histories: merged, intraday: new Map() }
      }
    }
  }

  const symbolsToFetch = symbolsNeedingFetch(symbols, options?.force)
  if (symbolsToFetch.length === 0) {
    return { histories: cachedHistories, intraday: new Map() }
  }

  const chunks = chunkSymbols(symbolsToFetch)
  const mergedHistories: Record<string, SymbolHistory> = Object.fromEntries(cachedHistories)
  let completedChunks = 0

  for (const chunk of chunks) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await postMarketBundle({ symbols: chunk, skipDaily: false })
        Object.assign(mergedHistories, payload.histories)
        completedChunks += 1
        onProgress?.({
          histories: new Map(Object.entries(mergedHistories)),
          intraday: new Map(),
        })
        persistBundleProgress(symbols, cacheKey, { histories: mergedHistories, intraday: {} })
        break
      } catch {
        if (attempt === 1) {
          // Keep partial results from successful chunks.
        }
      }
    }
  }

  if (completedChunks === 0 && Object.keys(mergedHistories).length === 0) {
    throw new Error('Market bundle request failed')
  }

  const result = {
    histories: new Map(Object.entries(mergedHistories)),
    intraday: new Map(),
  }
  onProgress?.(result)
  return result
}

export function hydrateUsEquityCache(): MarketBundleResult | null {
  const cached = readCachedDaily(US_EQUITY_BUNDLE_CACHE_KEY)
  if (!cached) {
    return null
  }

  return mapsFromCache(cached.data)
}

/** User-pinned tickers — fetched early so they are not stuck at the end of the main queue. */
export async function fetchPinnedBundle(
  symbols: string[],
  onProgress?: MarketBundleProgress,
  options?: { force?: boolean },
) {
  const unique = [...new Set(symbols.filter(Boolean))]
  if (unique.length === 0) {
    return { histories: new Map<string, SymbolHistory>(), intraday: new Map<string, SymbolHistory>() }
  }

  return fetchChunkedBundle(unique, pinnedCacheKey(unique), 0.85, onProgress, options)
}

/** US summary belt, style box, and treasury — small dedicated fetch that fits Netlify's 10s cap. */
export async function fetchUsEquityBundle(
  onProgress?: MarketBundleProgress,
  options?: { force?: boolean },
) {
  const symbols = collectUsEquityPrioritySymbols()
  return fetchChunkedBundle(symbols, US_EQUITY_BUNDLE_CACHE_KEY, 0.9, onProgress, options)
}

export function hydrateFixedIncomeCache(): MarketBundleResult | null {
  const symbols = collectFixedIncomeSymbols()
  const histories = readSymbolHistories(symbols)
  if (histories.size === 0) {
    return null
  }

  return { histories, intraday: new Map() }
}

/** Rates, sovereign yields, and bond ETFs — fetched before the long explorer queue. */
export async function fetchFixedIncomeBundle(
  onProgress?: MarketBundleProgress,
  options?: { force?: boolean },
) {
  const symbols = collectFixedIncomeSymbols()
  return fetchChunkedBundle(symbols, FIXED_INCOME_BUNDLE_CACHE_KEY, 0.85, onProgress, options)
}

/** Dedicated fetch for the global equity map — sequential chunks, isolated cache. */
export async function fetchCountryMapBundle(
  onProgress?: MarketBundleProgress,
  options?: { force?: boolean },
) {
  const symbols = collectCountryIndexSymbols()
  return fetchChunkedBundle(symbols, MAP_BUNDLE_CACHE_KEY, MIN_MAP_COVERAGE, onProgress, options)
}

export async function fetchAllHistories(symbols: string[]) {
  const bundle = await fetchMarketBundle({ symbols })
  return bundle.histories
}

export async function fetchIntradayForSymbols(symbols: string[], intradayDate: string) {
  const bundle = await fetchMarketBundle({
    symbols: [],
    intradayDate,
    intradaySymbols: symbols,
    skipDaily: true,
  })
  return bundle.intraday
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

function buildChartSeries(
  close: number[],
  startIndex: number,
  endIndex: number,
  timeFrame: TimeFrame,
): number[] {
  const windowSeries = close.slice(startIndex, endIndex + 1)
  if (windowSeries.length >= 2) {
    return windowSeries
  }

  const lookback = frameLookback[timeFrame]
  const trailing = close.slice(Math.max(endIndex - lookback + 1, 0), endIndex + 1)
  if (trailing.length >= 2) {
    return trailing
  }

  const tail = close.slice(Math.max(close.length - lookback, 0))
  if (tail.length >= 2) {
    return tail
  }

  return close.length >= 2 ? close : windowSeries
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
  const series = buildChartSeries(close, startIndex, endIndex, timeFrame)

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
    intradaySeries.length > 1
      ? intradaySeries
      : buildChartSeries(daily.close, startIndex, endIndex, timeFrame)

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

export async function fetchLiveHeadlines(date?: string, time?: string) {
  const params = new URLSearchParams()
  if (date) {
    params.set('date', date)
  }
  if (time) {
    params.set('time', time)
  }
  const query = params.toString() ? `?${params.toString()}` : ''
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

export async function fetchBreakingHeadlines() {
  const response = await fetch('/api/news?mode=breaking', { cache: 'no-store' })

  if (!response.ok) {
    throw new Error('Breaking news request failed')
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

const FRED_DISPLAY_SYMBOLS: Record<string, string> = {
  'fred:DFEDTARU': 'Fed',
  'fred:ECBDFR': 'ECB',
  'fred:IRSTCI01GBM156N': 'UK',
  'fred:IRSTCI01JPM156N': 'JP',
  'fred:INTDSRCNM193N': 'CN',
  'fred:IRSTCI01AUM156N': 'AU',
  'fred:IRSTCI01CAM156N': 'CA',
  'fred:IRSTCI01INM156N': 'IN',
  'fred:IRSTCI01KRM156N': 'KR',
  'fred:IRLTLT01GBM156N': 'UK 10Y',
  'fred:IRLTLT01DEM156N': 'DE 10Y',
  'fred:IRLTLT01FRM156N': 'FR 10Y',
  'fred:IRLTLT01ITM156N': 'IT 10Y',
  'fred:IRLTLT01ESM156N': 'ES 10Y',
  'fred:IRLTLT01JPM156N': 'JP 10Y',
  'fred:IRLTLT01AUM156N': 'AU 10Y',
  'fred:IRLTLT01CAM156N': 'CA 10Y',
  'fred:IRLTLT01CHM156N': 'CN 10Y',
  'fred:IRLTLT01KRM156N': 'KR 10Y',
  'fred:IRLTLT01MXM156N': 'MX 10Y',
}

export function formatDisplaySymbol(symbol: string) {
  const mapped = FRED_DISPLAY_SYMBOLS[symbol]
  if (mapped) {
    return mapped
  }

  if (symbol.startsWith('fred:')) {
    const seriesId = symbol.slice(5)
    return seriesId.length <= 10 ? seriesId : `${seriesId.slice(0, 8)}…`
  }

  return symbol
}

export function formatCompactChange(changePct: number, changeValue: number, unit: Unit) {
  const sign = changePct >= 0 ? '+' : ''
  const percent = `${sign}${changePct.toFixed(2)}%`

  if (unit === 'yield' || unit === 'rate') {
    return percent
  }

  return formatPercentWithAmount(changePct, changeValue, unit)
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

export function getNowEst() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

export function estDateTimeToMs(date: string, time: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/)
  if (!match || !timeMatch) {
    return Date.now()
  }

  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  }

  const base = Date.UTC(target.year, target.month - 1, target.day, target.hour + 5, target.minute)
  for (let delta = -3 * 60 * 60 * 1000; delta <= 3 * 60 * 60 * 1000; delta += 60 * 1000) {
    const candidate = base + delta
    const estParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(candidate))
    const get = (type: string) => estParts.find((part) => part.type === type)?.value ?? '00'
    if (
      Number(get('year')) === target.year &&
      Number(get('month')) === target.month &&
      Number(get('day')) === target.day &&
      Number(get('hour')) === target.hour &&
      Number(get('minute')) === target.minute
    ) {
      return candidate
    }
  }

  return base
}

export function snapshotTimeForMode(timeMode: TimeMode, customTime: string) {
  if (timeMode === 'open') {
    return '09:30'
  }
  if (timeMode === 'close') {
    return '16:00'
  }
  return customTime || '12:00'
}
