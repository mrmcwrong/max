export type TimeFrame = '1D' | '1W' | '1M' | '3M' | '1Y'
export type Unit = 'index' | 'price' | 'yield' | 'fx' | 'rate'

export type InstrumentDefinition = {
  id: string
  group: string
  name: string
  symbol?: string
  unit: Unit
  baseValue: number
  drift: number
  volatility: number
  note?: string
}

export type InstrumentSnapshot = InstrumentDefinition & {
  value: number
  changePct: number
  changeValue: number
  series?: number[]
  isLive?: boolean
}

export type SectionDefinition = {
  title: string
  subtitle: string
  defaultOpen?: boolean
  items: InstrumentDefinition[]
  groups?: string[]
}

export type Headline = {
  category: string
  title: string
  detail: string
  url?: string
}

export type CurvePoint = {
  tenor: string
  symbol: string
  current: number
  oneMonthAgo: number
  oneYearAgo: number
}

export const frameWeights: Record<TimeFrame, number> = {
  '1D': 0.32,
  '1W': 0.85,
  '1M': 1.4,
  '3M': 2.1,
  '1Y': 3.6,
}

export const frameLabels: Record<TimeFrame, string> = {
  '1D': '1 day',
  '1W': '1 week',
  '1M': '1 month',
  '3M': '3 months',
  '1Y': '1 year',
}

export const timeFrameOptions: TimeFrame[] = ['1D', '1W', '1M', '3M', '1Y']

export const treasuryCurveSymbols: Array<{ tenor: string; symbol: string }> = [
  { tenor: '3M', symbol: '^IRX' },
  { tenor: '2Y', symbol: '2YY=F' },
  { tenor: '5Y', symbol: '^FVX' },
  { tenor: '10Y', symbol: '^TNX' },
  { tenor: '30Y', symbol: '^TYX' },
]

export const summarySymbols = {
  sp500: '^GSPC',
  russell2000: '^RUT',
  nasdaq: '^IXIC',
  dow: '^DJI',
  vix: '^VIX',
  tenYear: '^TNX',
  twoYear: '2YY=F',
  dollar: 'DX-Y.NYB',
  crude: 'CL=F',
}

export const sectionDefinitions: SectionDefinition[] = [
  {
    title: 'U.S. equity benchmarks',
    subtitle: 'The core U.S. index sleeves advisors read first for market direction and style leadership.',
    defaultOpen: false,
    items: buildGroup('U.S. equity benchmarks', 'index', [
      ['S&P 500 (SPY)', 'SPY', 5125, 0.55, 1.1],
      ['Nasdaq 100 (QQQ)', 'QQQ', 21950, 1.0, 1.8],
      ['Dow Jones Industrial Average', '^DJI', 43250, 0.4, 1.0],
      ['Russell 2000 small caps (IWM)', 'IWM', 2450, 0.6, 1.7],
      ['S&P 500 Growth (SPYG)', 'SPYG', 5670, 0.78, 1.4],
      ['S&P 500 Value (SPYV)', 'SPYV', 4940, 0.45, 1.1],
      ['S&P MidCap 400 (MDY)', 'MDY', 3040, 0.6, 1.4],
      ['Russell 2000 Growth (IWO)', 'IWO', 2280, 0.7, 1.9],
      ['Russell 2000 Value (IWN)', 'IWN', 2350, 0.5, 1.8],
    ]),
  },
  {
    title: 'Mega-cap and AI leaders',
    subtitle:
      'The large-cap names advisors use as a proxy for market leadership, earnings concentration, and AI spend.',
    defaultOpen: false,
    items: buildGroup('Mega-cap equities', 'price', [
      ['Nvidia', 'NVDA', 147.18, 1.35, 2.4],
      ['Apple', 'AAPL', 214.32, 0.55, 1.4],
      ['Microsoft', 'MSFT', 497.62, 0.72, 1.5],
      ['Amazon.com', 'AMZN', 207.84, 0.7, 1.6],
      ['Meta Class A', 'META', 683.25, 0.95, 2.0],
      ['Alphabet Class A', 'GOOGL', 183.92, 0.58, 1.3],
      ['Alphabet Class C', 'GOOG', 184.55, 0.6, 1.3],
      ['Tesla', 'TSLA', 323.18, 0.82, 2.7],
    ]),
  },
  {
    title: 'S&P 500 sectors',
    subtitle: 'The eleven SPDR sector ETFs, used to read rotation and relative strength.',
    defaultOpen: false,
    items: buildGroup('S&P 500 sectors', 'index', [
      ['Information Technology', 'XLK', 3650, 0.92, 1.5],
      ['Communication Services', 'XLC', 325, 0.68, 1.5],
      ['Consumer Discretionary', 'XLY', 1830, 0.7, 1.4],
      ['Financials', 'XLF', 725, 0.4, 1.2],
      ['Industrials', 'XLI', 614, 0.45, 1.1],
      ['Health Care', 'XLV', 1670, 0.35, 1.0],
      ['Energy', 'XLE', 552, 0.55, 1.8],
      ['Materials', 'XLB', 550, 0.35, 1.2],
      ['Consumer Staples', 'XLP', 820, 0.3, 0.9],
      ['Utilities', 'XLU', 428, 0.25, 0.8],
      ['Real Estate', 'XLRE', 262, 0.3, 1.1],
    ]),
  },
  {
    title: 'Volatility',
    subtitle:
      'VIX and VXN frame equity and tech volatility, with a long-bond ETF as a live rate-volatility proxy.',
    defaultOpen: false,
    items: buildGroup('Volatility', 'index', [
      ['VIX', '^VIX', 15.8, -0.12, 1.8],
      ['VXN', '^VXN', 18.9, -0.08, 2.0],
      ['Rate volatility proxy (TLT)', 'TLT', 90.0, -0.18, 2.2],
    ]),
  },
  {
    title: 'International equities',
    subtitle:
      'Emerging-market and developed ex-U.S. country and style sleeves for regional dispersion.',
    defaultOpen: false,
    groups: ['Emerging markets', 'Developed ex-U.S.'],
    items: [
      ...buildGroup('Emerging markets', 'index', [
        ['MSCI EM (VWO)', 'VWO', 1150, 0.8, 1.7],
        ['MSCI EM Growth (EEM)', 'EEM', 1250, 0.95, 1.9],
        ['MSCI China (MCHI)', 'MCHI', 88, 1.1, 2.8],
        ['MSCI India (INDA)', 'INDA', 425, 0.95, 1.7],
        ['MSCI Taiwan (EWT)', 'EWT', 182, 1.0, 2.0],
        ['MSCI South Korea (EWY)', 'EWY', 205, 0.9, 1.9],
        ['MSCI Brazil (EWZ)', 'EWZ', 245, 0.7, 2.1],
        ['MSCI Mexico (EWW)', 'EWW', 219, 0.6, 1.6],
        ['MSCI Australia (EWA)', 'EWA', 195, 0.45, 1.3],
      ]),
      ...buildGroup('Developed ex-U.S.', 'index', [
        ['World ex-US (VEU)', 'VEU', 2745, 0.55, 1.2],
        ['World ex-US Growth (EFG)', 'EFG', 2625, 0.72, 1.4],
        ['World ex-US Value (EFV)', 'EFV', 2490, 0.46, 1.1],
        ['World ex-US Small Cap (VSS)', 'VSS', 2170, 0.66, 1.5],
        ['MSCI Europe (VGK)', 'VGK', 230, 0.48, 1.0],
        ['MSCI Pacific (VPL)', 'VPL', 185, 0.42, 1.0],
        ['MSCI Japan (EWJ)', 'EWJ', 232, 0.5, 1.0],
        ['MSCI United Kingdom (EWU)', 'EWU', 215, 0.35, 0.9],
        ['MSCI Germany (EWG)', 'EWG', 198, 0.45, 1.0],
      ]),
    ],
  },
  {
    title: 'Rates and Treasury yields',
    subtitle:
      'Live Treasury yields plus the duration ETFs advisors use to read rate and mortgage sensitivity.',
    defaultOpen: false,
    groups: ['Treasury yields', 'Treasury bond ETFs'],
    items: [
      ...buildGroup('Treasury yields', 'yield', [
        ['3M Treasury Yield', '^IRX', 4.39, -0.05, 0.18],
        ['2Y Treasury Yield', '2YY=F', 4.05, -0.04, 0.17],
        ['5Y Treasury Yield', '^FVX', 4.19, -0.04, 0.16],
        ['10Y Treasury Yield', '^TNX', 4.36, -0.03, 0.14],
        ['30Y Treasury Yield', '^TYX', 4.59, -0.02, 0.12],
      ]),
      ...buildGroup('Treasury bond ETFs', 'price', [
        ['1-3Y Treasury (SHY)', 'SHY', 82.5, -0.02, 0.3],
        ['7-10Y Treasury (IEF)', 'IEF', 95.0, -0.05, 0.6],
        ['20Y+ Treasury (TLT)', 'TLT', 90.0, -0.08, 1.0],
        ['TIPS (TIP)', 'TIP', 108.0, 0.03, 0.4],
      ]),
    ],
  },
  {
    title: 'Central bank policy rates',
    subtitle:
      'Key policy benchmarks for major economies. U.S. and euro-area series update daily; other markets via FRED/OECD and may refresh monthly.',
    defaultOpen: false,
    items: buildGroup('Policy rates', 'yield', [
      ['United States (Fed funds target)', 'fred:DFEDTARU', 4.5, 0, 0.05],
      ['Euro area (ECB deposit facility)', 'fred:ECBDFR', 2.25, 0, 0.05],
      ['United Kingdom', 'fred:IRSTCI01GBM156N', 3.75, 0, 0.05],
      ['Japan', 'fred:IRSTCI01JPM156N', 0.5, 0, 0.02],
      ['China (1-year loan rate)', 'fred:INTDSRCNM193N', 3.0, 0, 0.05],
      ['Australia', 'fred:IRSTCI01AUM156N', 4.1, 0, 0.05],
      ['Canada', 'fred:IRSTCI01CAM156N', 2.25, 0, 0.05],
      ['India', 'fred:IRSTCI01INM156N', 5.5, 0, 0.05],
      ['South Korea', 'fred:IRSTCI01KRM156N', 2.5, 0, 0.05],
    ]),
  },
  {
    title: 'Global 10-year sovereign yields',
    subtitle:
      'Benchmark 10-year government yields across major markets. U.S. data is live daily; international series are sourced from FRED/OECD and typically update monthly.',
    defaultOpen: false,
    items: buildGroup('10-year yields', 'yield', [
      ['United States', '^TNX', 4.36, -0.03, 0.14],
      ['United Kingdom', 'fred:IRLTLT01GBM156N', 4.75, -0.02, 0.12],
      ['Germany', 'fred:IRLTLT01DEM156N', 2.9, -0.02, 0.1],
      ['France', 'fred:IRLTLT01FRM156N', 3.5, -0.02, 0.1],
      ['Italy', 'fred:IRLTLT01ITM156N', 3.8, -0.02, 0.12],
      ['Spain', 'fred:IRLTLT01ESM156N', 3.3, -0.02, 0.1],
      ['Japan', 'fred:IRLTLT01JPM156N', 2.4, 0.01, 0.08],
      ['Australia', 'fred:IRLTLT01AUM156N', 4.5, -0.02, 0.1],
      ['Canada', 'fred:IRLTLT01CAM156N', 3.2, -0.02, 0.1],
      ['China', 'fred:IRLTLT01CHM156N', 1.8, 0, 0.05],
      ['South Korea', 'fred:IRLTLT01KRM156N', 3.2, -0.02, 0.1],
      ['Mexico', 'fred:IRLTLT01MXM156N', 9.0, 0.01, 0.15],
    ]),
  },
  {
    title: 'Bonds and credit',
    subtitle:
      'Core fixed-income proxies, municipals, convertibles, REITs, and rate-sensitive credit sleeves.',
    defaultOpen: false,
    items: buildGroup('Bonds', 'price', [
      ['US Agg Bond (AGG)', 'AGG', 98, 0.12, 0.7],
      ['1-3Y Govt/Credit (SHY)', 'SHY', 82, 0.08, 0.4],
      ['Long Treasury (TLT)', 'TLT', 90, -0.12, 1.0],
      ['Municipal (MUB)', 'MUB', 106, 0.05, 0.5],
      ['Agency MBS (VMBS)', 'VMBS', 46, 0.06, 0.4],
      ['MBS (MBB)', 'MBB', 92, 0.03, 0.6],
      ['US High Yield (HYG)', 'HYG', 79, 0.24, 1.2],
      ['US Corporate (LQD)', 'LQD', 109, 0.08, 0.7],
      ['Muni High Yield (HYD)', 'HYD', 53, 0.17, 1.0],
      ['Convertibles (CWB)', 'CWB', 82, 0.6, 1.6],
      ['EM USD Bond (EMB)', 'EMB', 90, 0.28, 1.2],
      ['Global Agg ex-US (BNDX)', 'BNDX', 49, 0.14, 0.7],
      ['REITs (VNQ)', 'VNQ', 90, 0.2, 1.1],
      ['Preferreds (PFF)', 'PFF', 32, 0.06, 0.5],
      ['TIPS (TIP)', 'TIP', 108, 0.09, 0.6],
    ]),
  },
  {
    title: 'Global bond ETFs',
    subtitle:
      'Liquid international and emerging-market government bond ETFs used as live sovereign-rate proxies.',
    defaultOpen: false,
    items: buildGroup('Global bonds', 'price', [
      ['SPDR Intl Treasury (BWX)', 'BWX', 24.0, -0.05, 0.6],
      ['iShares Intl Treasury (IGOV)', 'IGOV', 44.0, -0.05, 0.6],
      ['Vanguard Total Intl Bond (BNDX)', 'BNDX', 49.0, 0.04, 0.4],
      ['iShares EM USD Bond (EMB)', 'EMB', 90.0, 0.1, 0.8],
      ['VanEck EM Local Bond (EMLC)', 'EMLC', 25.0, 0.08, 0.9],
      ['SPDR Intl TIPS (WIP)', 'WIP', 48.0, 0.05, 0.7],
      ['iShares 1-3Y Intl Treasury (ISHG)', 'ISHG', 76.0, -0.02, 0.3],
      ['SPDR 1-3Y Intl Treasury (BWZ)', 'BWZ', 28.0, -0.02, 0.3],
    ]),
  },
  {
    title: 'Currencies and exchange rates',
    subtitle:
      'Dollar crosses and regional FX levels that help explain translation, trade, and capital-flow pressure.',
    defaultOpen: false,
    items: buildGroup('Currencies', 'fx', [
      ['DXY', 'DX-Y.NYB', 104.85, -0.15, 0.8],
      ['EUR / USD', 'EURUSD=X', 1.0874, 0.02, 0.6],
      ['USD / JPY', 'USDJPY=X', 154.38, -0.12, 1.0],
      ['GBP / USD', 'GBPUSD=X', 1.2731, 0.01, 0.7],
      ['USD / CNY', 'USDCNY=X', 7.2462, -0.02, 0.5],
      ['USD / TWD', 'USDTWD=X', 31.98, -0.03, 0.9],
      ['USD / KRW', 'USDKRW=X', 1379.4, -0.04, 1.1],
      ['USD / INR', 'USDINR=X', 83.19, -0.02, 0.4],
      ['USD / BRL', 'USDBRL=X', 5.43, -0.05, 0.8],
      ['USD / MXN', 'USDMXN=X', 16.82, -0.04, 0.9],
      ['AUD / USD', 'AUDUSD=X', 0.6648, 0.01, 0.7],
    ]),
  },
  {
    title: 'Commodities',
    subtitle: 'Precious metals, energy, and broad commodity benchmarks for inflation and cycle context.',
    defaultOpen: false,
    items: buildGroup('Commodities', 'price', [
      ['Gold', 'GC=F', 3356.2, 0.28, 1.4],
      ['Silver', 'SI=F', 36.42, 0.45, 1.8],
      ['WTI Crude Oil', 'CL=F', 68.45, 0.38, 2.2],
      ['Brent Crude Oil', 'BZ=F', 71.18, 0.36, 2.0],
      ['Natural Gas', 'NG=F', 3.24, 0.52, 2.8],
      ['Copper', 'HG=F', 4.85, 0.35, 1.9],
      ['S&P GSCI (GSG)', 'GSG', 22.0, 0.26, 1.2],
    ]),
  },
  {
    title: 'Crypto',
    subtitle: 'Major digital assets and a spot-bitcoin ETF for sentiment and risk-appetite context.',
    defaultOpen: false,
    items: buildGroup('Crypto', 'price', [
      ['Bitcoin', 'BTC-USD', 104820, 1.35, 3.4],
      ['Ethereum', 'ETH-USD', 3850, 1.5, 4.0],
      ['Solana', 'SOL-USD', 185, 1.8, 5.0],
      ['XRP', 'XRP-USD', 2.35, 1.6, 4.5],
      ['iShares Bitcoin Trust (IBIT)', 'IBIT', 58.0, 1.3, 3.2],
    ]),
  },
]

export const fallbackHeadlines: Headline[] = [
  {
    category: 'Economic watch',
    title: 'Macro prints and central-bank commentary are still the main duration catalyst.',
    detail:
      'Use this panel for CPI, payrolls, retail sales, ISM, and Fed headlines that move the curve.',
  },
  {
    category: 'Earnings and guidance',
    title: 'Mega-cap earnings remain the market’s main earnings concentration risk.',
    detail:
      'Highlights can be refreshed from your news feed to track AI spend, margins, and forward guidance.',
  },
  {
    category: 'Credit',
    title: 'Spreads and refinancing windows continue to matter for municipal and high-yield investors.',
    detail:
      'The bond stack below is positioned for quick review of duration, spread, and credit behavior.',
  },
  {
    category: 'Global markets',
    title: 'Currency pressure and foreign sovereign yields still help explain regional equity dispersion.',
    detail:
      'The EM country and international treasury sections provide that cross-check in one place.',
  },
  {
    category: 'Commodities and crypto',
    title: 'Gold, oil, and bitcoin keep their role as sentiment and inflation probes.',
    detail:
      'The snapshot is designed so those assets can be swapped with live market feeds later.',
  },
]

function buildGroup(
  group: string,
  unit: Unit,
  rows: Array<[string, string, number, number, number, string?]>,
): InstrumentDefinition[] {
  return rows.map(([name, symbol, baseValue, drift, volatility, note]) => ({
    id: slugify(`${group}-${name}`),
    group,
    name,
    symbol,
    unit,
    baseValue,
    drift,
    volatility,
    note,
  }))
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function collectSymbols(items: InstrumentDefinition[]) {
  return items.map((item) => item.symbol).filter((symbol): symbol is string => Boolean(symbol))
}
