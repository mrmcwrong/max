import type { IncomingMessage, ServerResponse } from 'node:http'

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart'
const YAHOO_SCREENER = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved'
const NEWS_TOPICS = [
  '(Federal Reserve OR Fed OR FOMC OR interest rates OR Powell OR Treasury yields)',
  '(earnings OR corporate guidance OR revenue OR profit warning OR stress test)',
  '(oil OR crude oil OR OPEC OR inflation OR CPI OR jobs report)',
  '(tariffs OR trade policy OR sanctions OR geopolitical OR trade talks)',
  '(stock market OR S&P 500 OR Wall Street OR Nasdaq OR bank stocks)',
]

const BREAKING_NEWS_TOPICS = [
  'breaking (Federal Reserve OR Fed OR FOMC OR interest rates OR Powell OR inflation OR CPI)',
  'breaking (earnings OR profit warning OR revenue miss OR guidance cut OR bank failure)',
  'breaking (oil OR OPEC OR war OR geopolitical OR sanctions OR missile OR attack)',
  'breaking (stock market crash OR selloff OR rally OR S&P 500 OR Wall Street OR Nasdaq)',
  'breaking (tariffs OR trade war OR Trump OR executive order OR emergency)',
]

const BREAKING_NEWS_HOURS = 8
const NEWS_FEED_LIMIT = 36

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10)
}

function estDateTimeToMs(date: string, time: string): number {
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
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(candidate))
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
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

function buildTopicNewsUrl(topicQuery: string, afterYmd: string, beforeYmd: string) {
  const query = `${topicQuery} after:${afterYmd} before:${beforeYmd}`
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function readQuery(req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return url.searchParams
}

async function proxyJson(res: ServerResponse, targetUrl: string) {
  const response = await fetch(targetUrl, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': USER_AGENT,
    },
  })

  const body = await response.text()
  res.statusCode = response.status
  res.setHeader('Content-Type', response.headers.get('content-type') ?? 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

export async function handleYahooChart(req: IncomingMessage, res: ServerResponse) {
  const params = readQuery(req)
  const symbol = params.get('symbol')

  if (!symbol) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Missing symbol parameter' }))
    return
  }

  const interval = params.get('interval') ?? '1d'
  const period1 = params.get('period1')
  const period2 = params.get('period2')

  let targetUrl: string
  if (period1 && period2) {
    targetUrl = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?period1=${encodeURIComponent(period1)}&period2=${encodeURIComponent(period2)}&interval=${encodeURIComponent(interval)}&includePrePost=false`
  } else {
    const range = params.get('range') ?? '1d'
    targetUrl = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false`
  }

  await proxyJson(res, targetUrl)
}

type MoverRow = {
  symbol: string
  name: string
  value: number
  changePct: number
  changeValue: number
}

let cachedAuth: { cookie: string; crumb: string; expires: number } | null = null

async function getYahooAuth() {
  if (cachedAuth && cachedAuth.expires > Date.now()) {
    return cachedAuth
  }

  const cookieResponse = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': USER_AGENT },
  }).catch(() => null)

  let cookie = ''
  if (cookieResponse) {
    const setCookie =
      typeof cookieResponse.headers.getSetCookie === 'function'
        ? cookieResponse.headers.getSetCookie()
        : []
    const raw = setCookie.length > 0 ? setCookie : [cookieResponse.headers.get('set-cookie') ?? '']
    cookie = raw
      .map((entry) => entry.split(';')[0])
      .filter(Boolean)
      .join('; ')
  }

  const crumbResponse = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/plain',
      Cookie: cookie,
    },
  })

  const crumb = (await crumbResponse.text()).trim()
  cachedAuth = { cookie, crumb, expires: Date.now() + 25 * 60 * 1000 }
  return cachedAuth
}

function normalizeQuotes(quotes: unknown): MoverRow[] {
  if (!Array.isArray(quotes)) {
    return []
  }

  return quotes
    .map((quote) => {
      const row = quote as Record<string, unknown>
      const symbol = typeof row.symbol === 'string' ? row.symbol : ''
      const name =
        (typeof row.shortName === 'string' && row.shortName) ||
        (typeof row.longName === 'string' && row.longName) ||
        symbol
      const value = typeof row.regularMarketPrice === 'number' ? row.regularMarketPrice : 0
      const changePct =
        typeof row.regularMarketChangePercent === 'number' ? row.regularMarketChangePercent : 0
      const changeValue = typeof row.regularMarketChange === 'number' ? row.regularMarketChange : 0

      return { symbol, name, value, changePct, changeValue }
    })
    .filter((row) => row.symbol)
}

async function fetchScreener(scrId: string, count: number): Promise<MoverRow[]> {
  const auth = await getYahooAuth()
  const url = `${YAHOO_SCREENER}?count=${count}&scrIds=${encodeURIComponent(scrId)}&crumb=${encodeURIComponent(auth.crumb)}`

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      Cookie: auth.cookie,
    },
  })

  if (!response.ok) {
    throw new Error(`Screener ${scrId} failed with status ${response.status}`)
  }

  const json = (await response.json()) as {
    finance?: { result?: Array<{ quotes?: unknown }> }
  }

  return normalizeQuotes(json.finance?.result?.[0]?.quotes)
}

export async function handleMovers(_req: IncomingMessage, res: ServerResponse) {
  const [gainers, losers, actives] = await Promise.allSettled([
    fetchScreener('day_gainers', 15),
    fetchScreener('day_losers', 15),
    fetchScreener('most_actives', 15),
  ])

  const payload = {
    gainers: gainers.status === 'fulfilled' ? gainers.value : [],
    losers: losers.status === 'fulfilled' ? losers.value : [],
    actives: actives.status === 'fulfilled' ? actives.value : [],
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

export async function handleNewsFeed(req: IncomingMessage, res: ServerResponse) {
  const params = readQuery(req)
  const date = params.get('date')
  const time = params.get('time')
  const isBreaking = params.get('mode') === 'breaking'
  const cacheKey = isBreaking
    ? `news:breaking:${Math.floor(Date.now() / (5 * 60 * 1000))}`
    : `news:${date ?? 'now'}:${time ?? '16:00'}`
  const cachedNews = readNewsCache(cacheKey)
  if (cachedNews) {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.end(JSON.stringify(cachedNews))
    return
  }

  const snapshotMs = isBreaking
    ? Date.now()
    : date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? estDateTimeToMs(date, time && /^\d{2}:\d{2}$/.test(time) ? time : '16:00')
      : Date.now()

  const lookbackHours = isBreaking ? BREAKING_NEWS_HOURS : 36
  const afterYmd = toYmd(new Date(snapshotMs - lookbackHours * 60 * 60 * 1000))
  const beforeYmd = toYmd(new Date(snapshotMs + 24 * 60 * 60 * 1000))
  const topics = isBreaking ? BREAKING_NEWS_TOPICS : NEWS_TOPICS

  const feedResults = await Promise.allSettled(
    topics.map((topic) =>
      fetch(buildTopicNewsUrl(topic, afterYmd, beforeYmd), {
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
          'User-Agent': USER_AGENT,
        },
      }).then((response) => response.text()),
    ),
  )

  const seen = new Set<string>()
  const ranked: Array<ParsedNewsItem & { score: number }> = []

  for (const result of feedResults) {
    if (result.status !== 'fulfilled') {
      continue
    }

    for (const item of parseGoogleNewsRss(result.value)) {
      const key = normalizeHeadlineKey(item.title)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)

      const score = isBreaking ? scoreBreakingNewsItem(item, snapshotMs) : scoreNewsItem(item, snapshotMs)
      if (score > 0) {
        ranked.push({ ...item, score })
      }
    }
  }

  if (ranked.length < NEWS_FEED_LIMIT) {
    for (const result of feedResults) {
      if (result.status !== 'fulfilled') {
        continue
      }

      for (const item of parseGoogleNewsRss(result.value)) {
        const key = normalizeHeadlineKey(item.title)
        if (seen.has(key)) {
          continue
        }
        seen.add(key)

        const score = isBreaking
          ? scoreBreakingNewsFallback(item, snapshotMs)
          : scoreNewsFallback(item, snapshotMs)
        if (score > 0) {
          ranked.push({ ...item, score })
        }
      }
    }
  }

  ranked.sort((left, right) => right.score - left.score || right.publishedAt - left.publishedAt)

  const headlines = ranked.slice(0, NEWS_FEED_LIMIT).map(({ score: _score, publishedAt, ...item }) => ({
    ...item,
    detail: isBreaking ? formatBreakingNewsDetail(publishedAt) : formatNewsDetail(publishedAt),
  }))

  writeNewsCache(cacheKey, headlines)

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, max-age=60')
  res.end(JSON.stringify(headlines))
}

type NewsItem = {
  category: string
  title: string
  detail: string
  url: string
}

const newsCache = new Map<string, { expires: number; headlines: NewsItem[] }>()
const NEWS_CACHE_TTL_MS = 90_000

function readNewsCache(key: string) {
  const entry = newsCache.get(key)
  if (!entry || entry.expires <= Date.now()) {
    newsCache.delete(key)
    return null
  }
  return entry.headlines
}

function writeNewsCache(key: string, headlines: NewsItem[]) {
  newsCache.set(key, { expires: Date.now() + NEWS_CACHE_TTL_MS, headlines })
}

type ParsedNewsItem = NewsItem & {
  publishedAt: number
}

function normalizeHeadlineKey(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 72)
}

function scoreNewsItem(item: ParsedNewsItem, snapshotMs: number) {
  if (item.publishedAt > snapshotMs + 20 * 60 * 1000) {
    return -1
  }

  const hoursBefore = (snapshotMs - item.publishedAt) / (60 * 60 * 1000)
  if (hoursBefore > 72) {
    return -1
  }

  let score = 0

  if (hoursBefore <= 18) {
    score += 14 - hoursBefore * 0.45
  } else if (hoursBefore <= 36) {
    score += 7 - (hoursBefore - 18) * 0.22
  } else {
    score += 2.5 - (hoursBefore - 36) * 0.08
  }

  const text = `${item.title} ${item.category}`.toLowerCase()
  const keywordGroups = [
    ['fed', 'fomc', 'interest rate', 'powell', 'treasury', 'yield', 'rate cut', 'rate hike'],
    ['earnings', 'revenue', 'guidance', 'profit', 'micron', 'nvidia', 'apple', 'microsoft'],
    ['oil', 'crude', 'opec', 'inflation', 'cpi', 'ppi', 'jobs', 'payroll', 'unemployment'],
    ['tariff', 'trade policy', 'trade talks', 'sanctions', 'geopolit', 'india', 'china'],
    ['bank', 'stress test', 'credit', 'default', 'ipo', 'merger', 'acquisition'],
    ['war', 'iran', 'middle east', 'ukraine', 'conflict'],
    ['s&p', 'nasdaq', 'dow', 'wall street', 'stock market', 'equities'],
  ]

  for (const group of keywordGroups) {
    if (group.some((keyword) => text.includes(keyword))) {
      score += 2.8
    }
  }

  if (/reuters|bloomberg|wall street journal|financial times|cnbc|associated press|ap news|barron/i.test(item.category)) {
    score += 2
  }

  if (hoursBefore > 48 && score < 8) {
    return -1
  }

  return score
}

function scoreBreakingNewsItem(item: ParsedNewsItem, snapshotMs: number) {
  if (item.publishedAt > snapshotMs + 10 * 60 * 1000) {
    return -1
  }

  const hoursBefore = (snapshotMs - item.publishedAt) / (60 * 60 * 1000)
  if (hoursBefore < 0 || hoursBefore > BREAKING_NEWS_HOURS) {
    return -1
  }

  let score = (BREAKING_NEWS_HOURS - hoursBefore) * 6

  const text = `${item.title} ${item.category}`.toLowerCase()
  const keywordGroups = [
    ['breaking', 'urgent', 'just in', 'developing', 'live updates'],
    ['fed', 'fomc', 'interest rate', 'powell', 'rate cut', 'rate hike', 'inflation', 'cpi', 'jobs report'],
    ['earnings', 'profit warning', 'guidance', 'revenue miss', 'bank failure', 'downgrade'],
    ['war', 'attack', 'missile', 'sanctions', 'geopolit', 'conflict', 'iran', 'ukraine', 'israel'],
    ['oil', 'crude', 'opec', 'tariff', 'trade war', 'emergency', 'executive order'],
    ['crash', 'selloff', 'plunge', 'surge', 'rally', 'record high', 'record low'],
    ['s&p', 'nasdaq', 'dow', 'wall street', 'stock market'],
  ]

  for (const group of keywordGroups) {
    if (group.some((keyword) => text.includes(keyword))) {
      score += 4
    }
  }

  if (/reuters|bloomberg|wall street journal|financial times|cnbc|associated press|ap news|barron/i.test(item.category)) {
    score += 3
  }

  return score >= 6 ? score : -1
}

function scoreBreakingNewsFallback(item: ParsedNewsItem, snapshotMs: number) {
  if (item.publishedAt > snapshotMs + 10 * 60 * 1000) {
    return -1
  }

  const hoursBefore = (snapshotMs - item.publishedAt) / (60 * 60 * 1000)
  if (hoursBefore < 0 || hoursBefore > BREAKING_NEWS_HOURS) {
    return -1
  }

  return (BREAKING_NEWS_HOURS - hoursBefore) * 3
}

function scoreNewsFallback(item: ParsedNewsItem, snapshotMs: number) {
  if (item.publishedAt > snapshotMs + 20 * 60 * 1000) {
    return -1
  }

  const hoursBefore = (snapshotMs - item.publishedAt) / (60 * 60 * 1000)
  if (hoursBefore < 0 || hoursBefore > 72) {
    return -1
  }

  return 72 - hoursBefore
}

function parseGoogleNewsRss(xml: string): ParsedNewsItem[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]

  return items
    .map((match) => {
      const block = match[1]
      const rawTitle = decodeXml(stripTags(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Market headline'))
      const source = stripTags(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? 'News')
      const pubDate = stripTags(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '')
      const url = decodeXml(stripTags(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ''))
      const publishedAt = Date.parse(pubDate)

      const title = source && rawTitle.endsWith(` - ${source}`)
        ? rawTitle.slice(0, rawTitle.length - source.length - 3)
        : rawTitle

      if (Number.isNaN(publishedAt)) {
        return null
      }

      return {
        category: source,
        title,
        detail: formatNewsDetail(publishedAt),
        url,
        publishedAt,
      }
    })
    .filter((item): item is ParsedNewsItem => item !== null)
}

function formatNewsDetail(publishedAt: number) {
  return new Date(publishedAt).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function formatBreakingNewsDetail(publishedAt: number) {
  const hoursAgo = (Date.now() - publishedAt) / (60 * 60 * 1000)
  const timestamp = new Date(publishedAt).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })

  if (hoursAgo < 1) {
    const minutesAgo = Math.max(1, Math.round(hoursAgo * 60))
    return `${minutesAgo} min ago · ${timestamp}`
  }

  if (hoursAgo < BREAKING_NEWS_HOURS) {
    return `${Math.round(hoursAgo)}h ago · ${timestamp}`
  }

  return timestamp
}

function stripTags(value: string) {
  return value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim()
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
