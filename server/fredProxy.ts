import type { IncomingMessage, ServerResponse } from 'node:http'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export const FRED_SERIES_IDS = [
  'DFEDTARU',
  'ECBDFR',
  'IRSTCI01GBM156N',
  'IRSTCI01JPM156N',
  'INTDSRCNM193N',
  'IRSTCI01AUM156N',
  'IRSTCI01CAM156N',
  'IRSTCI01INM156N',
  'IRSTCI01KRM156N',
  'IRLTLT01GBM156N',
  'IRLTLT01DEM156N',
  'IRLTLT01JPM156N',
  'IRLTLT01AUM156N',
  'IRLTLT01CAM156N',
  'IRLTLT01FRM156N',
  'IRLTLT01ITM156N',
  'IRLTLT01ESM156N',
  'IRLTLT01CHM156N',
  'IRLTLT01KRM156N',
  'IRLTLT01MXM156N',
] as const

const ALLOWED_SERIES = new Set<string>(FRED_SERIES_IDS)

export type FredHistory = {
  symbol: string
  timestamps: number[]
  open: number[]
  close: number[]
}

function readQuery(req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return url.searchParams
}

export async function fetchFredHistory(seriesId: string): Promise<FredHistory | null> {
  const response = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`,
    {
      headers: {
        Accept: 'text/csv,text/plain,*/*',
        'User-Agent': USER_AGENT,
      },
    },
  )

  if (!response.ok) {
    return null
  }

  const text = await response.text()
  if (text.startsWith('<!')) {
    return null
  }

  const timestamps: number[] = []
  const open: number[] = []
  const close: number[] = []

  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [datePart, valuePart] = line.split(',')
    if (!datePart || !valuePart || valuePart === '.') {
      continue
    }

    const value = Number.parseFloat(valuePart)
    if (Number.isNaN(value)) {
      continue
    }

    const parsed = new Date(`${datePart}T12:00:00Z`)
    if (Number.isNaN(parsed.getTime())) {
      continue
    }

    timestamps.push(Math.floor(parsed.getTime() / 1000))
    open.push(value)
    close.push(value)
  }

  if (close.length === 0) {
    return null
  }

  return {
    symbol: `fred:${seriesId}`,
    timestamps,
    open,
    close,
  }
}

export async function handleFredHistory(req: IncomingMessage, res: ServerResponse) {
  const series = readQuery(req).get('series')

  if (!series || !ALLOWED_SERIES.has(series)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid or missing FRED series parameter' }))
    return
  }

  try {
    const history = await fetchFredHistory(series)

    if (!history) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: `FRED history unavailable for ${series}` }))
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(history))
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'FRED history proxy failed' }))
  }
}
