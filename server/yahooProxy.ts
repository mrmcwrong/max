import type { IncomingMessage, ServerResponse } from 'node:http'

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart'
const YAHOO_SCREENER = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved'
const NEWS_QUERY = 'stock market OR Federal Reserve OR inflation OR earnings OR Treasury yields'

function buildNewsUrl(date: string | null) {
  let query = NEWS_QUERY

  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const snapshot = new Date(`${date}T12:00:00Z`)
    if (!Number.isNaN(snapshot.getTime())) {
      const after = new Date(snapshot.getTime() - 8 * 24 * 60 * 60 * 1000)
      const before = new Date(snapshot.getTime() + 1 * 24 * 60 * 60 * 1000)
      query = `${NEWS_QUERY} after:${toYmd(after)} before:${toYmd(before)}`
    }
  }

  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
}

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10)
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
  const date = readQuery(req).get('date')
  const response = await fetch(buildNewsUrl(date), {
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
      'User-Agent': USER_AGENT,
    },
  })

  const xml = await response.text()
  const headlines = parseGoogleNewsRss(xml).slice(0, 12)

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(headlines))
}

type NewsItem = {
  category: string
  title: string
  detail: string
  url: string
}

function parseGoogleNewsRss(xml: string): NewsItem[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]

  return items.map((match) => {
    const block = match[1]
    const rawTitle = decodeXml(stripTags(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Market headline'))
    const source = stripTags(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? 'News')
    const pubDate = stripTags(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '')
    const url = decodeXml(stripTags(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ''))

    const title = source && rawTitle.endsWith(` - ${source}`)
      ? rawTitle.slice(0, rawTitle.length - source.length - 3)
      : rawTitle

    return {
      category: source,
      title,
      detail: pubDate ? formatNewsDate(pubDate) : 'Headline from Google News.',
      url,
    }
  })
}

function formatNewsDate(pubDate: string) {
  const parsed = new Date(pubDate)
  if (Number.isNaN(parsed.getTime())) {
    return pubDate
  }

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
