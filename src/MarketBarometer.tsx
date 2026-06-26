import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import {
  collectBarometerSymbols,
  collectFixedIncomeSymbols,
  collectSymbols,
  fallbackHeadlines,
  frameLabels,
  frameWeights,
  sectionDefinitions,
  summarySymbols,
  timeFrameOptions,
  treasuryCurveSymbols,
  type CurvePoint,
  type Headline,
  type InstrumentDefinition,
  type InstrumentSnapshot,
  type SectionDefinition,
  type TimeFrame,
  type Unit,
} from './instrumentCatalog'
import { OverviewBoard, NewsModeToggle, PrintBarometerBlock, ensureWorldAtlasReady } from './MarketBarometers'
import SettingsPage from './SettingsPage'
import { applyDeviceTheme } from './applyDeviceTheme'
import {
  clearDeviceSettings,
  defaultDeviceSettings,
  normalizeTickerSymbol,
  readDeviceSettings,
  writeDeviceSettings,
  type DeviceSettings,
  type PinnedTicker,
} from './deviceSettings'
import { exportSnapshot, type SnapshotExportInput, type SnapshotOverviewRow } from './exportSnapshot'
import {
  computeCurvePoint,
  computeIntradayQuote,
  computeQuote,
  estDateTimeToMs,
  fetchIntradayForSymbols,
  fetchBreakingHeadlines,
  fetchMarketBundle,
  fetchLiveHeadlines,
  formatCompactChange,
  formatDisplaySymbol,
  getNowEst,
  snapshotTimeForMode,
  yahooQuoteUrl,
  type ComputedQuote,
  type SymbolHistory,
  type TimeMode,
} from './liveMarket'
import './MarketBarometer.css'

type FeedStatus = 'loading' | 'live' | 'fallback' | 'error'

type RemoteMarketRow = {
  name?: string
  symbol?: string
  group?: string
  unit?: Unit
  value?: number
  changePct?: number
  changeValue?: number
  note?: string
}

type ResolvedSection = Omit<SectionDefinition, 'items'> & { items: InstrumentSnapshot[] }

type StatTone = 'positive' | 'negative' | 'neutral'

type StatItem = {
  label: string
  value: string
  delta?: string
  tone: StatTone
  symbol?: string
}

const marketFeedUrl = import.meta.env.VITE_MARKET_DATA_URL as string | undefined
const newsFeedUrl = import.meta.env.VITE_NEWS_DATA_URL as string | undefined

const timeModeOptions: Array<{ value: TimeMode; label: string }> = [
  { value: 'open', label: '9:30 a.m. EST (opening)' },
  { value: 'close', label: '4 p.m. EST (closing)' },
  { value: 'custom', label: 'Custom time (EST)' },
]

const CURVE_AFTER_SECTION = 'Rates and Treasury yields'

const SECTION_ORDER = [
  'U.S. equity benchmarks',
  'S&P 500 sectors',
  'Mega-cap and AI leaders',
  'Volatility',
  'International equities',
  'Rates and Treasury yields',
  'Central bank policy rates',
  'Global 10-year sovereign yields',
  'Bonds and credit',
  'Global bond ETFs',
  'Currencies and exchange rates',
  'Commodities',
  'Crypto',
]

const MARKET_NAV_CLUSTERS: Array<{ id: string; label: string; sections: string[] }> = [
  {
    id: 'equities',
    label: 'Equities',
    sections: [
      'U.S. equity benchmarks',
      'S&P 500 sectors',
      'Mega-cap and AI leaders',
      'Volatility',
      'International equities',
    ],
  },
  {
    id: 'rates',
    label: 'Rates',
    sections: ['Rates and Treasury yields', 'Central bank policy rates', 'Global 10-year sovereign yields'],
  },
  {
    id: 'fixed',
    label: 'Fixed income',
    sections: ['Bonds and credit', 'Global bond ETFs'],
  },
  {
    id: 'other',
    label: 'FX & real assets',
    sections: ['Currencies and exchange rates', 'Commodities', 'Crypto'],
  },
]

const SECTION_SHORT_LABELS: Record<string, string> = {
  'U.S. equity benchmarks': 'US benchmarks',
  'S&P 500 sectors': 'S&P sectors',
  'Mega-cap and AI leaders': 'Mega-cap / AI',
  Volatility: 'Volatility',
  'International equities': 'International',
  'Rates and Treasury yields': 'US Treasuries',
  'Central bank policy rates': 'Policy rates',
  'Global 10-year sovereign yields': 'Global 10Y',
  'Bonds and credit': 'Credit',
  'Global bond ETFs': 'Bond ETFs',
  'Currencies and exchange rates': 'FX',
  Commodities: 'Commodities',
  Crypto: 'Crypto',
}

function MarketBarometer() {
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>(() => readDeviceSettings())
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('1W')
  const [snapshotDate, setSnapshotDate] = useState(() => getLastCloseDate())
  const [timeMode, setTimeMode] = useState<TimeMode>('close')
  const [customTime, setCustomTime] = useState('12:00')
  const [liveView, setLiveView] = useState(false)
  const [view, setView] = useState<'dashboard' | 'headlines' | 'settings'>('dashboard')
  const [activeMarketSection, setActiveMarketSection] = useState(SECTION_ORDER[0])
  const [activeMarketGroup, setActiveMarketGroup] = useState<string | null>(null)
  const [histories, setHistories] = useState<Map<string, SymbolHistory>>(new Map())
  const [intraday, setIntraday] = useState<Map<string, SymbolHistory>>(new Map())
  const [intradayDate, setIntradayDate] = useState<string | null>(null)
  const [intradayLoading, setIntradayLoading] = useState(false)
  const [customMarketFeed, setCustomMarketFeed] = useState<RemoteMarketRow[]>([])
  const [customNewsFeed, setCustomNewsFeed] = useState<Headline[]>([])
  const [liveHeadlines, setLiveHeadlines] = useState<Headline[]>([])
  const [breakingHeadlines, setBreakingHeadlines] = useState<Headline[]>([])
  const [breakingNews, setBreakingNews] = useState(true)
  const [feedStatus, setFeedStatus] = useState<{ market: FeedStatus; news: FeedStatus }>({
    market: 'loading',
    news: 'loading',
  })
  const [exportBusy, setExportBusy] = useState(false)

  const pinnedSymbolList = useMemo(
    () => deviceSettings.pinnedTickers.map((ticker) => ticker.symbol),
    [deviceSettings.pinnedTickers],
  )

  const allSymbols = useMemo(
    () => [
      ...new Set([
        ...collectSymbols(sectionDefinitions.flatMap((section) => section.items)),
        ...treasuryCurveSymbols.map((point) => point.symbol),
        ...Object.values(summarySymbols),
        ...collectBarometerSymbols(),
        ...pinnedSymbolList,
      ]),
    ],
    [pinnedSymbolList],
  )

  const orderedSymbols = useMemo(() => {
    const barometer = collectBarometerSymbols()
    const fixedIncome = collectFixedIncomeSymbols()
    const head = [
      ...Object.values(summarySymbols),
      ...treasuryCurveSymbols.map((point) => point.symbol),
      ...barometer,
      ...fixedIncome,
    ]
    const headSet = new Set(head)
    const remainder = allSymbols.filter((symbol) => !headSet.has(symbol))
    return [...head, ...remainder]
  }, [allSymbols])

  const intradaySymbolList = useMemo(
    () => [
      ...new Set([
        ...Object.values(summarySymbols),
        ...treasuryCurveSymbols.map((point) => point.symbol),
      ]),
    ],
    [],
  )

  const barometerSymbolList = useMemo(() => collectBarometerSymbols(), [])
  const fixedIncomeSymbolList = useMemo(() => collectFixedIncomeSymbols(), [])

  const loadFeeds = useCallback(
    async (options?: { force?: boolean; intradayDate?: string }) => {
      setFeedStatus((current) => ({ ...current, market: 'loading' }))

      const customMarketPromise = marketFeedUrl ? fetchRemoteFeed(marketFeedUrl) : Promise.resolve(null)
      const onHistoryProgress = (bundle: { histories: Map<string, SymbolHistory>; intraday: Map<string, SymbolHistory> }) => {
        if (bundle.histories.size > 0) {
          setHistories(new Map(bundle.histories))
          setFeedStatus((current) => ({ ...current, market: 'live' }))
        }
        if (bundle.intraday.size > 0) {
          setIntraday(new Map(bundle.intraday))
        }
      }

      const historyPromise = options?.intradayDate
        ? fetchMarketBundle(
            {
              symbols: orderedSymbols,
              intradayDate: options.intradayDate,
              intradaySymbols: intradaySymbolList,
              skipDaily: true,
              force: options.force,
            },
            onHistoryProgress,
          )
        : fetchMarketBundle({ symbols: orderedSymbols, force: options?.force }, onHistoryProgress)

      const barometerPromise = fetchMarketBundle(
        { symbols: barometerSymbolList, force: options?.force },
        onHistoryProgress,
      )

      const fixedIncomePromise = fetchMarketBundle(
        { symbols: fixedIncomeSymbolList, force: options?.force },
        onHistoryProgress,
      )

      const [customMarketResult, historyResult, barometerResult, fixedIncomeResult] = await Promise.allSettled([
        customMarketPromise,
        historyPromise,
        barometerPromise,
        fixedIncomePromise,
      ])

      let marketStatus: FeedStatus = 'fallback'
      const mergedHistories = new Map<string, SymbolHistory>()
      const mergedIntraday = new Map<string, SymbolHistory>()

      const absorbBundle = (bundle?: { histories: Map<string, SymbolHistory>; intraday: Map<string, SymbolHistory> }) => {
        if (!bundle) {
          return
        }

        bundle.histories.forEach((history, symbol) => mergedHistories.set(symbol, history))
        bundle.intraday.forEach((history, symbol) => mergedIntraday.set(symbol, history))
      }

      if (historyResult.status === 'fulfilled') {
        absorbBundle(historyResult.value)
      }

      if (barometerResult.status === 'fulfilled') {
        absorbBundle(barometerResult.value)
      }

      if (fixedIncomeResult.status === 'fulfilled') {
        absorbBundle(fixedIncomeResult.value)
      }

      if (mergedHistories.size > 0 || mergedIntraday.size > 0) {
        setHistories(mergedHistories)
        if (mergedIntraday.size > 0) {
          setIntraday(mergedIntraday)
          if (options?.intradayDate) {
            setIntradayDate(options.intradayDate)
          }
        }
        marketStatus = 'live'
      } else if (
        historyResult.status === 'rejected' &&
        barometerResult.status === 'rejected' &&
        fixedIncomeResult.status === 'rejected'
      ) {
        setHistories(new Map())
        marketStatus = 'error'
      } else {
        setHistories(new Map())
        marketStatus = 'fallback'
      }

      if (customMarketResult.status === 'fulfilled' && customMarketResult.value) {
        setCustomMarketFeed(normalizeMarketFeed(customMarketResult.value))
        marketStatus = 'live'
      }

      setFeedStatus((current) => ({ ...current, market: marketStatus }))
    },
    [orderedSymbols, intradaySymbolList, barometerSymbolList, fixedIncomeSymbolList],
  )

  const loadNews = useCallback(async (date: string, time: string) => {
    setFeedStatus((current) => ({ ...current, news: 'loading' }))

    const customNewsPromise = newsFeedUrl ? fetchRemoteFeed(newsFeedUrl) : Promise.resolve(null)
    const newsPromise = fetchLiveHeadlines(date, time)
    const breakingPromise = fetchBreakingHeadlines()

    const [customNewsResult, newsResult, breakingResult] = await Promise.allSettled([
      customNewsPromise,
      newsPromise,
      breakingPromise,
    ])

    let newsStatus: FeedStatus = 'fallback'

    if (newsResult.status === 'fulfilled' && newsResult.value.length > 0) {
      setLiveHeadlines(newsResult.value)
      newsStatus = 'live'
    } else {
      setLiveHeadlines([])
      newsStatus = newsResult.status === 'rejected' ? 'error' : 'fallback'
    }

    if (breakingResult.status === 'fulfilled') {
      setBreakingHeadlines(breakingResult.value)
    } else {
      setBreakingHeadlines([])
    }

    if (customNewsResult.status === 'fulfilled' && customNewsResult.value) {
      setCustomNewsFeed(normalizeHeadlineFeed(customNewsResult.value))
      newsStatus = 'live'
    }

    setFeedStatus((current) => ({ ...current, news: newsStatus }))
  }, [])

  const enableLiveView = useCallback(async () => {
    const now = getNowEst()
    setSnapshotDate(now.date)
    setTimeMode('custom')
    setCustomTime(now.time)
    setLiveView(true)
    setIntradayDate(null)
    setIntraday(new Map())

    await Promise.all([loadFeeds({ force: true, intradayDate: now.date }), loadNews(now.date, now.time)])
  }, [loadFeeds, loadNews])

  const effectiveNewsTime = snapshotTimeForMode(timeMode, customTime)

  useEffect(() => {
    void loadFeeds()
  }, [loadFeeds])

  useEffect(() => {
    void loadNews(snapshotDate, effectiveNewsTime)
  }, [loadNews, snapshotDate, effectiveNewsTime])

  useEffect(() => {
    if (timeMode !== 'custom' || histories.size === 0 || intradayDate === snapshotDate) {
      return
    }

    let cancelled = false
    setIntradayLoading(true)

    void fetchIntradayForSymbols(intradaySymbolList, snapshotDate)
      .then((map) => {
        if (cancelled) {
          return
        }
        setIntraday(map)
        setIntradayDate(snapshotDate)
        setIntradayLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setIntradayLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [timeMode, snapshotDate, histories, intradaySymbolList, intradayDate])

  const snapshotDateMs = useMemo(() => {
    const parsed = new Date(`${snapshotDate}T23:59:59`)
    return Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime()
  }, [snapshotDate])

  const customDateTimeMs = useMemo(() => {
    return estDateTimeToMs(snapshotDate, customTime || '12:00')
  }, [snapshotDate, customTime])

  const liveQuotes = useMemo(() => {
    const map = new Map<string, ComputedQuote>()
    histories.forEach((history, symbol) => {
      const quote =
        timeMode === 'custom'
          ? computeIntradayQuote(history, intraday.get(symbol), snapshotDateMs, customDateTimeMs, timeFrame)
          : computeQuote(history, snapshotDateMs, timeMode, timeFrame)
      if (quote) {
        map.set(symbol, quote)
      }
    })
    return map
  }, [histories, intraday, snapshotDateMs, customDateTimeMs, timeMode, timeFrame])

  const snapshotSeed = hashString(`${timeFrame}|${snapshotDate}|${timeMode}|${timeMode === 'custom' ? customTime : ''}`)
  const marketLookup = useMemo(() => buildMarketOverrideLookup(customMarketFeed), [customMarketFeed])
  const headlineItems =
    customNewsFeed.length > 0 ? customNewsFeed : liveHeadlines.length > 0 ? liveHeadlines : fallbackHeadlines

  const activeHeadlines = useMemo(() => {
    if (breakingNews && breakingHeadlines.length > 0) {
      return breakingHeadlines
    }
    return headlineItems
  }, [breakingNews, breakingHeadlines, headlineItems])

  const sections = useMemo(
    () =>
      sectionDefinitions.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          applyMarketData(item, timeFrame, snapshotSeed, liveQuotes, marketLookup),
        ),
      })),
    [liveQuotes, marketLookup, snapshotSeed, timeFrame],
  ) as ResolvedSection[]

  const topHeadlines = activeHeadlines.slice(0, 4)

  const tenYearQuote = liveQuotes.get(summarySymbols.tenYear)
  const twoYearQuote = liveQuotes.get(summarySymbols.twoYear)

  const stats: StatItem[] = [
    indexStat('S&P 500', summarySymbols.sp500, liveQuotes.get(summarySymbols.sp500)),
    indexStat('Russell 2000', summarySymbols.russell2000, liveQuotes.get(summarySymbols.russell2000)),
    indexStat('Nasdaq', summarySymbols.nasdaq, liveQuotes.get(summarySymbols.nasdaq)),
    indexStat('Dow Jones', summarySymbols.dow, liveQuotes.get(summarySymbols.dow)),
    indexStat('VIX', summarySymbols.vix, liveQuotes.get(summarySymbols.vix)),
    yieldStat('10Y Treasury', summarySymbols.tenYear, tenYearQuote),
    yieldStat('2Y Treasury', summarySymbols.twoYear, twoYearQuote),
    indexStat('DXY', summarySymbols.dollar, liveQuotes.get(summarySymbols.dollar)),
    priceStat('Crude Oil', summarySymbols.crude, liveQuotes.get(summarySymbols.crude)),
  ]

  const orderedSections = SECTION_ORDER.map((title) => sections.find((section) => section.title === title)).filter(
    (section): section is ResolvedSection => Boolean(section),
  )

  const activeSection = useMemo(
    () => orderedSections.find((section) => section.title === activeMarketSection) ?? orderedSections[0],
    [orderedSections, activeMarketSection],
  )

  useEffect(() => {
    if (!activeSection) {
      return
    }

    setActiveMarketGroup(activeSection.groups?.[0] ?? null)
  }, [activeSection?.title, activeSection?.groups])

  const treasuryCurve = useMemo<CurvePoint[]>(() => {
    return treasuryCurveSymbols
      .map((point) => {
        const history = histories.get(point.symbol)
        if (!history) {
          return null
        }

        const curveDateMs = timeMode === 'custom' ? customDateTimeMs : snapshotDateMs

        const { current, oneMonthAgo, oneYearAgo } = computeCurvePoint(history, curveDateMs)
        if (current == null || oneMonthAgo == null || oneYearAgo == null) {
          return null
        }

        return { tenor: point.tenor, symbol: point.symbol, current, oneMonthAgo, oneYearAgo }
      })
      .filter((point): point is CurvePoint => point !== null)
  }, [histories, snapshotDateMs, customDateTimeMs, timeMode])

  const curveDomain =
    treasuryCurve.length > 0
      ? {
          min: Math.min(...treasuryCurve.map((point) => Math.min(point.current, point.oneMonthAgo, point.oneYearAgo))) - 0.3,
          max: Math.max(...treasuryCurve.map((point) => Math.max(point.current, point.oneMonthAgo, point.oneYearAgo))) + 0.3,
        }
      : { min: 0, max: 6 }

  const isLoading = feedStatus.market === 'loading'

  const snapshotTimeLabel = liveView
    ? formatEstTimestamp(snapshotDate, customTime)
    : timeMode === 'open'
      ? '9:30 a.m. EST (opening)'
      : timeMode === 'close'
        ? '4 p.m. EST (closing)'
        : `${formatEstTimestamp(snapshotDate, customTime)} (custom)`

  useLayoutEffect(() => {
    applyDeviceTheme(deviceSettings)
    writeDeviceSettings(deviceSettings)
  }, [deviceSettings])

  const patchDeviceSettings = useCallback((patch: Partial<DeviceSettings>) => {
    setDeviceSettings((current) => ({ ...current, ...patch }))
  }, [])

  const addPinnedTicker = useCallback((symbol: string, label: string) => {
    const normalized = normalizeTickerSymbol(symbol)
    setDeviceSettings((current) => {
      if (current.pinnedTickers.some((ticker) => ticker.symbol === normalized)) {
        return current
      }

      return {
        ...current,
        pinnedTickers: [
          ...current.pinnedTickers,
          {
            id: `${normalized}-${Date.now()}`,
            symbol: normalized,
            label: label.trim() || normalized,
          },
        ],
      }
    })
  }, [])

  const removePinnedTicker = useCallback((id: string) => {
    setDeviceSettings((current) => ({
      ...current,
      pinnedTickers: current.pinnedTickers.filter((ticker) => ticker.id !== id),
    }))
  }, [])

  const resetDeviceSettings = useCallback(() => {
    clearDeviceSettings()
    setDeviceSettings({ ...defaultDeviceSettings, pinnedTickers: [] })
  }, [])

  const handleExportPdf = useCallback(() => {
    void ensureWorldAtlasReady().then(() => {
      setTimeout(() => window.print(), 120)
    })
  }, [])

  const snapshotExportInput = useMemo<SnapshotExportInput>(
    () => ({
      snapshotDate,
      snapshotTimeLabel,
      timeFrame,
      timeFrameLabel: frameLabels[timeFrame],
      liveView,
      newsMode: breakingNews && breakingHeadlines.length > 0 ? 'breaking' : 'snapshot',
      sections: orderedSections,
      overviewRows: buildOverviewExportRows(liveQuotes),
      treasuryCurve,
      headlines: activeHeadlines,
      pinnedTickers: deviceSettings.pinnedTickers,
      liveQuotes,
    }),
    [
      snapshotDate,
      snapshotTimeLabel,
      timeFrame,
      liveView,
      breakingNews,
      breakingHeadlines.length,
      orderedSections,
      liveQuotes,
      treasuryCurve,
      activeHeadlines,
      deviceSettings.pinnedTickers,
    ],
  )

  const handleExport = useCallback(
    async (format: 'csv' | 'xlsx') => {
      setExportBusy(true)
      try {
        await exportSnapshot(snapshotExportInput, format)
      } finally {
        setExportBusy(false)
      }
    },
    [snapshotExportInput],
  )

  if (view === 'settings') {
    return (
      <SettingsPage
        settings={deviceSettings}
        onSettingsChange={patchDeviceSettings}
        onAddPinnedTicker={addPinnedTicker}
        onRemovePinnedTicker={removePinnedTicker}
        onReset={resetDeviceSettings}
        onBack={() => setView('dashboard')}
      />
    )
  }

  if (view === 'headlines') {
    return (
      <HeadlinesPage
        snapshotHeadlines={headlineItems}
        breakingHeadlines={breakingHeadlines}
        breakingNews={breakingNews}
        breakingAvailable={breakingHeadlines.length > 0}
        onBreakingNewsChange={setBreakingNews}
        onBack={() => setView('dashboard')}
      />
    )
  }

  return (
    <main className="page-shell">
      <div className="screen-view">
      <header className="hero-panel hero-panel--compact">
        <div className="hero-copy">
          <h1>MAX</h1>
          <p className="hero-subtitle">Market Analytics Explorer</p>
        </div>

        <div className="toolbar">
          <div className="toolbar__group">
            <span className="toolbar__label">Frame</span>
            <div className="segmented" role="group" aria-label="Time frame">
              {timeFrameOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`segmented__button ${timeFrame === option ? 'is-active' : ''}`}
                  onClick={() => {
                    setLiveView(false)
                    setTimeFrame(option)
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <label className="toolbar__group" htmlFor="snapshotDate">
            <span className="toolbar__label">Date</span>
            <input
              id="snapshotDate"
              type="date"
              value={snapshotDate}
              max={toDateInputValue(new Date())}
              onChange={(event) => {
                setLiveView(false)
                setSnapshotDate(event.target.value)
              }}
            />
          </label>

          <label className="toolbar__group" htmlFor="snapshotTime">
            <span className="toolbar__label">Time (EST)</span>
            <select
              id="snapshotTime"
              value={timeMode}
              onChange={(event) => {
                setLiveView(false)
                setTimeMode(event.target.value as TimeMode)
              }}
            >
              {timeModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {timeMode === 'custom' ? (
            <label className="toolbar__group" htmlFor="customTime">
              <span className="toolbar__label">{intradayLoading ? 'Loading…' : 'Pick time'}</span>
              <input
                id="customTime"
                type="time"
                value={customTime}
                onChange={(event) => {
                  setLiveView(false)
                  setCustomTime(event.target.value)
                }}
              />
            </label>
          ) : null}

          <div className="toolbar__actions">
            <button
              type="button"
              className={`toolbar__live ${liveView ? 'is-active' : ''}`}
              onClick={() => void enableLiveView()}
              disabled={isLoading}
              title="Jump to latest live market data"
            >
              {isLoading ? '…' : 'Live'}
            </button>
            <button type="button" className="toolbar__settings" onClick={() => setView('settings')}>
              Settings
            </button>
            <details className="toolbar__export">
              <summary>Export</summary>
              <div className="toolbar__export-menu">
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={(event) => {
                    handleExportPdf()
                    event.currentTarget.closest('details')?.removeAttribute('open')
                  }}
                >
                  PDF report
                </button>
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={(event) => {
                    void handleExport('csv')
                    event.currentTarget.closest('details')?.removeAttribute('open')
                  }}
                >
                  {exportBusy ? 'Exporting…' : 'CSV file'}
                </button>
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={(event) => {
                    void handleExport('xlsx')
                    event.currentTarget.closest('details')?.removeAttribute('open')
                  }}
                >
                  {exportBusy ? 'Exporting…' : 'Excel workbook'}
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <section className="overview-hub">
        <section className="glance">
          <PinnedTickerStrip tickers={deviceSettings.pinnedTickers} liveQuotes={liveQuotes} />
          <StatTicker stats={stats} />
        </section>

        <OverviewBoard
          liveQuotes={liveQuotes}
          timeFrame={timeFrame}
          headlines={topHeadlines}
          breakingNews={breakingNews}
          onBreakingNewsChange={setBreakingNews}
          breakingAvailable={breakingHeadlines.length > 0}
          onMoreHeadlines={() => setView('headlines')}
          renderHeadline={(headline) => <HeadlineLink headline={headline} compact />}
        />
      </section>

      {activeSection ? (
        <MarketsExplorer
          sections={orderedSections}
          activeSection={activeSection}
          activeGroup={activeMarketGroup}
          onSectionChange={setActiveMarketSection}
          onGroupChange={setActiveMarketGroup}
          treasuryCurve={treasuryCurve}
          curveDomain={curveDomain}
        />
      ) : null}
      </div>

      <PrintReport
        timeFrameLabel={frameLabels[timeFrame]}
        timeFrame={timeFrame}
        snapshotDate={snapshotDate}
        snapshotTimeLabel={snapshotTimeLabel}
        stats={stats}
        headlines={activeHeadlines.slice(0, 6)}
        sections={orderedSections}
        treasuryCurve={treasuryCurve}
        curveDomain={curveDomain}
        liveQuotes={liveQuotes}
      />
    </main>
  )
}

function HeadlinesPage({
  snapshotHeadlines,
  breakingHeadlines,
  breakingNews,
  breakingAvailable,
  onBreakingNewsChange,
  onBack,
}: {
  snapshotHeadlines: Headline[]
  breakingHeadlines: Headline[]
  breakingNews: boolean
  breakingAvailable: boolean
  onBreakingNewsChange: (enabled: boolean) => void
  onBack: () => void
}) {
  const headlines =
    breakingNews && breakingHeadlines.length > 0 ? breakingHeadlines : snapshotHeadlines

  return (
    <main className="page-shell">
      <header className="headlines-page__header">
        <button type="button" className="back-button" onClick={onBack}>
          ← Back to dashboard
        </button>
        <div className="headlines-page__title-row">
          <div>
            <p className="eyebrow">News</p>
            <h1>More market headlines</h1>
            <p className="hero-text">
              {breakingNews
                ? 'Major market-moving stories from the past few hours, ranked by impact and recency.'
                : 'Headlines ranked for your selected snapshot date and time. Click any item to read the source.'}
            </p>
          </div>
          <NewsModeToggle
            breakingNews={breakingNews}
            breakingAvailable={breakingAvailable}
            onBreakingNewsChange={onBreakingNewsChange}
          />
        </div>
      </header>

      <section className="headlines-page__grid">
        {headlines.map((headline) => (
          <HeadlineLink key={`${headline.category}-${headline.title}`} headline={headline} />
        ))}
      </section>
    </main>
  )
}

function PrintReport({
  timeFrameLabel,
  timeFrame,
  snapshotDate,
  snapshotTimeLabel,
  stats,
  headlines,
  sections,
  treasuryCurve,
  curveDomain,
  liveQuotes,
}: {
  timeFrameLabel: string
  timeFrame: TimeFrame
  snapshotDate: string
  snapshotTimeLabel: string
  stats: StatItem[]
  headlines: Headline[]
  sections: ResolvedSection[]
  treasuryCurve: CurvePoint[]
  curveDomain: { min: number; max: number }
  liveQuotes: Map<string, ComputedQuote>
}) {
  const sectionByTitle = useMemo(() => new Map(sections.map((section) => [section.title, section])), [sections])

  return (
    <article className="print-report">
      <header className="print-masthead">
        <div className="print-masthead__brand">
          <p className="print-masthead__eyebrow">Market Analytics Explorer</p>
          <h1>MAX</h1>
        </div>
        <dl className="print-masthead__meta">
          <div>
            <dt>Snapshot</dt>
            <dd>{formatReportDate(snapshotDate)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{snapshotTimeLabel}</dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>{timeFrameLabel}</dd>
          </div>
        </dl>
      </header>

      <section className="print-panel print-panel--overview">
        <h2 className="print-panel__title">Market overview</h2>
        <div className="print-stat-grid">
          {stats.map((stat) => (
            <div className={`print-stat print-stat--${stat.tone}`} key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              {stat.delta ? <em>{stat.delta}</em> : null}
            </div>
          ))}
        </div>
      </section>

      {headlines.length > 0 ? (
        <section className="print-panel print-panel--news">
          <h2 className="print-panel__title">Headlines</h2>
          <div className="print-headlines">
            {headlines.map((headline) => (
              <article className="print-headline" key={`${headline.category}-${headline.title}`}>
                <p className="print-headline__category">{headline.category}</p>
                <h3>{headline.title}</h3>
                <p className="print-headline__detail">{headline.detail}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {treasuryCurve.length > 0 ? (
        <section className="print-panel print-panel--curve">
          <div className="print-panel__title-row">
            <h2 className="print-panel__title">U.S. Treasury yield curve</h2>
            <div className="print-curve-legend">
              <span className="print-curve-legend__item print-curve-legend__item--current">Snapshot</span>
              <span className="print-curve-legend__item print-curve-legend__item--month">1M ago</span>
              <span className="print-curve-legend__item print-curve-legend__item--year">1Y ago</span>
            </div>
          </div>
          <PrintYieldCurve points={treasuryCurve} domain={curveDomain} />
        </section>
      ) : null}

      {MARKET_NAV_CLUSTERS.map((cluster) => (
        <PrintClusterTable key={cluster.id} cluster={cluster} sectionByTitle={sectionByTitle} />
      ))}

      <PrintBarometerBlock liveQuotes={liveQuotes} timeFrame={timeFrame} />

      <footer className="print-footer">
        <span>MAX · Market Analytics Explorer</span>
        <span>
          {formatReportDate(snapshotDate)} · {timeFrameLabel} · {snapshotTimeLabel}
        </span>
      </footer>
    </article>
  )
}

function PrintClusterTable({
  cluster,
  sectionByTitle,
}: {
  cluster: (typeof MARKET_NAV_CLUSTERS)[number]
  sectionByTitle: Map<string, ResolvedSection>
}) {
  return (
    <section className={`print-cluster print-cluster--${cluster.id}`}>
      <table className="print-market-table">
        <caption className="print-cluster__banner">{cluster.label}</caption>
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Sym</th>
            <th>Value</th>
            <th>Change</th>
          </tr>
        </thead>
        {cluster.sections.map((title) => {
          const section = sectionByTitle.get(title)
          if (!section) {
            return null
          }

          return (
            <tbody key={title} className="print-market-table__group">
              <tr className="print-market-table__section-row">
                <td colSpan={4}>{section.title}</td>
              </tr>
              {section.items.map((item) => {
                const positive = item.changePct >= 0
                return (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.symbol ? formatDisplaySymbol(item.symbol) : '—'}</td>
                    <td>{formatValue(item.value, item.unit)}</td>
                    <td className={positive ? 'print-market-table__up' : 'print-market-table__down'}>
                      {formatCompactChange(item.changePct, item.changeValue, item.unit)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          )
        })}
      </table>
    </section>
  )
}

function PrintYieldCurve({ points, domain }: { points: CurvePoint[]; domain: { min: number; max: number } }) {
  const width = 900
  const height = 150
  const paddingLeft = 48
  const paddingRight = 20
  const paddingTop = 22
  const paddingBottom = 36
  const plotWidth = width - paddingLeft - paddingRight
  const plotHeight = height - paddingTop - paddingBottom

  const xStep = plotWidth / Math.max(points.length - 1, 1)
  const xAt = (index: number) => paddingLeft + index * xStep
  const yAt = (value: number) =>
    paddingTop + ((domain.max - value) / (domain.max - domain.min || 1)) * plotHeight

  const buildPath = (selector: keyof CurvePoint) =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(2)} ${yAt(point[selector] as number).toFixed(2)}`)
      .join(' ')

  const buildArea = (selector: keyof CurvePoint) => {
    const line = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(2)} ${yAt(point[selector] as number).toFixed(2)}`)
      .join(' ')
    const lastX = xAt(points.length - 1)
    const firstX = xAt(0)
    const baseY = paddingTop + plotHeight
    return `${line} L ${lastX.toFixed(2)} ${baseY} L ${firstX.toFixed(2)} ${baseY} Z`
  }

  return (
    <svg className="print-curve-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Treasury yield curve">
      <defs>
        <linearGradient id="printCurveBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="100%" stopColor="#f8fafc" />
        </linearGradient>
        <linearGradient id="printCurveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width={width} height={height} rx="14" fill="url(#printCurveBg)" />

      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = paddingTop + tick * plotHeight
        const value = domain.max - tick * (domain.max - domain.min)
        return (
          <g key={tick}>
            <line x1={paddingLeft} x2={width - paddingRight} y1={y} y2={y} className="print-curve-grid" />
            <text x={paddingLeft - 8} y={y + 3} textAnchor="end" className="print-curve-axis">
              {value.toFixed(1)}%
            </text>
          </g>
        )
      })}

      <path d={buildArea('current')} fill="url(#printCurveFill)" />
      <path d={buildPath('oneYearAgo')} className="print-curve-line print-curve-line--year" />
      <path d={buildPath('oneMonthAgo')} className="print-curve-line print-curve-line--month" />
      <path d={buildPath('current')} className="print-curve-line print-curve-line--current" />

      {points.map((point, index) => (
        <g key={point.tenor}>
          <circle cx={xAt(index)} cy={yAt(point.current)} r="4.5" className="print-curve-dot print-curve-dot--current" />
          <text x={xAt(index)} y={height - 12} textAnchor="middle" className="print-curve-tenor">
            {point.tenor}
          </text>
          <text x={xAt(index)} y={yAt(point.current) - 10} textAnchor="middle" className="print-curve-label">
            {point.current.toFixed(2)}%
          </text>
        </g>
      ))}
    </svg>
  )
}

function PinnedTickerStrip({
  tickers,
  liveQuotes,
}: {
  tickers: PinnedTicker[]
  liveQuotes: Map<string, ComputedQuote>
}) {
  if (tickers.length === 0) {
    return null
  }

  return (
    <div className="ticker ticker--pinned">
      <span className="ticker__tag">Pinned</span>
      <div className="pinned-ticker__list">
        {tickers.map((ticker) => {
          const quote = liveQuotes.get(ticker.symbol)
          const stat = pinnedTickerStat(ticker, quote)
          const content = (
            <>
              <b>{stat.label}</b>
              <span className="pinned-ticker__symbol">{formatDisplaySymbol(ticker.symbol)}</span>
              <span>{stat.value}</span>
              {stat.delta ? <span className={`stat-chip__delta--${stat.tone}`}>{stat.delta}</span> : null}
            </>
          )

          return (
            <a
              key={ticker.id}
              className="pinned-ticker__item"
              href={yahooQuoteUrl(ticker.symbol)}
              target="_blank"
              rel="noreferrer"
              title={`Open ${ticker.label} on Yahoo Finance`}
            >
              {content}
            </a>
          )
        })}
      </div>
    </div>
  )
}

function StatTicker({ stats }: { stats: StatItem[] }) {
  if (stats.length === 0) {
    return (
      <div className="ticker ticker--stats">
        <div className="ticker__static">Loading market analytics…</div>
      </div>
    )
  }

  const loop = [...stats, ...stats]
  const duration = Math.max(stats.length * 3.6, 28)

  return (
    <div className="ticker ticker--stats">
      <span className="ticker__tag ticker__tag--accent">Overview</span>
      <div className="ticker__viewport">
        <div className="ticker__track" style={{ animationDuration: `${duration}s` } as CSSProperties}>
          {loop.map((stat, index) => {
            const content = (
              <>
                <b>{stat.label}</b>
                <span>{stat.value}</span>
                {stat.delta ? (
                  <span className={`stat-chip__delta--${stat.tone}`}>{stat.delta}</span>
                ) : null}
              </>
            )

            if (stat.symbol) {
              return (
                <a
                  className="ticker__item ticker__stat ticker__stat--link"
                  href={yahooQuoteUrl(stat.symbol)}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${stat.label} on ${stat.symbol.startsWith('fred:') ? 'FRED' : 'Yahoo Finance'}`}
                  key={`${stat.label}-${index}`}
                >
                  {content}
                </a>
              )
            }

            return (
              <span className="ticker__item ticker__stat" key={`${stat.label}-${index}`}>
                {content}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TreasuryCurveBlock({
  treasuryCurve,
  curveDomain,
  compact = false,
  emptyMessage = 'Loading live treasury curve data…',
}: {
  treasuryCurve: CurvePoint[]
  curveDomain: { min: number; max: number }
  compact?: boolean
  emptyMessage?: string
}) {
  return (
    <div className={`curve-wrap ${compact ? 'curve-wrap--compact' : ''}`}>
      <div className="curve-legend">
        <LegendItem label="Snapshot" tone="current" />
        <LegendItem label="1 month prior" tone="month" />
        <LegendItem label="1 year prior" tone="year" />
      </div>
      {treasuryCurve.length > 0 ? (
        <CurveChart points={treasuryCurve} domain={curveDomain} />
      ) : (
        <p className="curve-footnote">{emptyMessage}</p>
      )}
    </div>
  )
}

function MarketsExplorer({
  sections,
  activeSection,
  activeGroup,
  onSectionChange,
  onGroupChange,
  treasuryCurve,
  curveDomain,
}: {
  sections: ResolvedSection[]
  activeSection: ResolvedSection
  activeGroup: string | null
  onSectionChange: (title: string) => void
  onGroupChange: (group: string) => void
  treasuryCurve: CurvePoint[]
  curveDomain: { min: number; max: number }
}) {
  const sectionLookup = useMemo(() => new Map(sections.map((section) => [section.title, section])), [sections])

  return (
    <section className="markets-hub" aria-label="Market instruments">
      <nav className="markets-hub__nav" aria-label="Market sections">
        {MARKET_NAV_CLUSTERS.map((cluster) => (
          <div className="markets-nav-cluster" key={cluster.id}>
            <p className="markets-nav-cluster__label">{cluster.label}</p>
            <div className="markets-nav-cluster__items">
              {cluster.sections.map((title) => {
                const section = sectionLookup.get(title)
                if (!section) {
                  return null
                }

                return (
                  <button
                    key={title}
                    type="button"
                    className={`markets-nav-item ${activeSection.title === title ? 'is-active' : ''}`}
                    onClick={() => onSectionChange(title)}
                    aria-current={activeSection.title === title ? 'page' : undefined}
                  >
                    <span className="markets-nav-item__label">{SECTION_SHORT_LABELS[title] ?? title}</span>
                    <span className="markets-nav-item__count">{section.items.length}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="markets-hub__main">
        <MarketSectionView
          section={activeSection}
          activeGroup={activeGroup}
          onGroupChange={onGroupChange}
          treasuryCurve={treasuryCurve}
          curveDomain={curveDomain}
        />
      </div>
    </section>
  )
}

function MarketSectionView({
  section,
  activeGroup,
  onGroupChange,
  treasuryCurve,
  curveDomain,
}: {
  section: ResolvedSection
  activeGroup: string | null
  onGroupChange: (group: string) => void
  treasuryCurve: CurvePoint[]
  curveDomain: { min: number; max: number }
}) {
  const groupedItems: Array<{ group: string; items: InstrumentSnapshot[] }> = section.groups
    ? section.groups.map((group) => ({
        group,
        items: section.items.filter((item) => item.group === group),
      }))
    : [{ group: section.title, items: section.items }]

  const visibleItems = section.groups
    ? groupedItems.find(({ group }) => group === activeGroup)?.items ?? groupedItems[0]?.items ?? []
    : section.items

  const showCurve = section.title === CURVE_AFTER_SECTION

  return (
    <div className="market-section">
      <header className="market-section__header">
        <h2>{section.title}</h2>
        <p>{section.subtitle}</p>
      </header>

      {section.groups ? (
        <div className="group-pills" role="tablist" aria-label={`${section.title} groups`}>
          {groupedItems.map(({ group, items }) => (
            <button
              key={group}
              type="button"
              role="tab"
              aria-selected={activeGroup === group}
              className={`group-pills__button ${activeGroup === group ? 'is-active' : ''}`}
              onClick={() => onGroupChange(group)}
            >
              {group}
              <span className="group-pills__count">{items.length}</span>
            </button>
          ))}
        </div>
      ) : null}

      <InstrumentTable items={visibleItems} showGroup={!section.groups} />

      {showCurve ? (
        <div className="market-section__curve">
          <h3>U.S. Treasury yield curve</h3>
          <p className="market-section__curve-note">
            Yields across maturities — snapshot versus one month and one year prior
          </p>
          <TreasuryCurveBlock treasuryCurve={treasuryCurve} curveDomain={curveDomain} compact />
        </div>
      ) : null}
    </div>
  )
}

function InstrumentTable({ items, showGroup }: { items: InstrumentSnapshot[]; showGroup: boolean }) {
  if (items.length === 0) {
    return <p className="instrument-table__empty">No instruments in this view.</p>
  }

  return (
    <div className="instrument-table">
      <div className="instrument-table__head" aria-hidden="true">
        <span>Instrument</span>
        <span>Trend</span>
        <span>Price</span>
        <span>Change</span>
        <span>Symbol</span>
      </div>
      {items.map((item) => (
        <InstrumentRow key={item.id} item={item} showGroup={showGroup} />
      ))}
    </div>
  )
}

function InstrumentRow({ item, showGroup }: { item: InstrumentSnapshot; showGroup: boolean }) {
  const positive = item.changePct >= 0
  const href = item.symbol ? yahooQuoteUrl(item.symbol) : undefined

  const content = (
    <>
      <div className="instrument-row__name">
        {showGroup ? <span className="instrument-row__group">{item.group}</span> : null}
        <strong>{item.name}</strong>
      </div>
      <div className="instrument-row__spark">
        <Sparkline series={item.series ?? []} positive={positive} />
      </div>
      <div className="instrument-row__value">{formatValue(item.value, item.unit)}</div>
      <span className={`instrument-row__delta ${positive ? 'trend-up' : 'trend-down'}`}>
        {formatCompactChange(item.changePct, item.changeValue, item.unit)}
      </span>
      <span className="instrument-row__symbol" title={item.symbol ?? undefined}>
        {item.symbol ? formatDisplaySymbol(item.symbol) : '—'}
        {item.isLive ? <i className="live-dot" aria-label="live data" /> : null}
      </span>
    </>
  )

  if (!href) {
    return <div className="instrument-row">{content}</div>
  }

  return (
    <a
      className="instrument-row instrument-row--link"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={item.symbol?.startsWith('fred:') ? 'Open on FRED' : 'Open on Yahoo Finance'}
    >
      {content}
    </a>
  )
}

function Sparkline({ series, positive }: { series: number[]; positive: boolean }) {
  if (!series || series.length < 2) {
    return <div className="sparkline sparkline--empty" />
  }

  const width = 120
  const height = 36
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const step = width / (series.length - 1)

  const points = series
    .map((value, index) => {
      const x = index * step
      const y = height - ((value - min) / span) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const lastY = height - ((series[series.length - 1] - min) / span) * height

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        className={positive ? 'sparkline__line sparkline__line--up' : 'sparkline__line sparkline__line--down'}
        points={points}
      />
      <circle
        className={positive ? 'sparkline__dot sparkline__dot--up' : 'sparkline__dot sparkline__dot--down'}
        cx={width}
        cy={lastY}
        r="2.4"
      />
    </svg>
  )
}

function HeadlineLink({ headline, compact = false }: { headline: Headline; compact?: boolean }) {
  const className = compact ? 'summary-news' : 'headline-card'
  const inner = (
    <>
      <p className="headline-category">{headline.category}</p>
      <h3>{headline.title}</h3>
      <p className="headline-detail">{headline.detail}</p>
    </>
  )

  if (!headline.url) {
    return <article className={className}>{inner}</article>
  }

  return (
    <a className={`${className} ${className}--link`} href={headline.url} target="_blank" rel="noreferrer">
      {inner}
    </a>
  )
}

function LegendItem({ label, tone }: { label: string; tone: 'current' | 'month' | 'year' }) {
  return (
    <span className={`legend-item legend-${tone}`}>
      <i />
      {label}
    </span>
  )
}

function CurveChart({ points, domain }: { points: CurvePoint[]; domain: { min: number; max: number } }) {
  const width = 820
  const height = 320
  const paddingLeft = 54
  const paddingRight = 24
  const paddingTop = 28
  const paddingBottom = 46
  const plotWidth = width - paddingLeft - paddingRight
  const plotHeight = height - paddingTop - paddingBottom

  const xStep = plotWidth / Math.max(points.length - 1, 1)
  const xAt = (index: number) => paddingLeft + index * xStep
  const yAt = (value: number) =>
    paddingTop + ((domain.max - value) / (domain.max - domain.min || 1)) * plotHeight

  const buildPath = (selector: keyof CurvePoint) =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(2)} ${yAt(point[selector] as number).toFixed(2)}`)
      .join(' ')

  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1]

  return (
    <svg
      className="curve-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="U.S. Treasury yield curve comparison chart"
    >
      {ticks.map((tick) => {
        const y = paddingTop + tick * plotHeight
        const value = domain.max - tick * (domain.max - domain.min)
        return (
          <g key={tick}>
            <line x1={paddingLeft} x2={width - paddingRight} y1={y} y2={y} className="curve-gridline" />
            <text x={paddingLeft - 10} y={y + 4} textAnchor="end" className="curve-axis-label">
              {value.toFixed(2)}%
            </text>
          </g>
        )
      })}

      {points.map((point, index) => (
        <line
          key={`grid-${point.tenor}`}
          x1={xAt(index)}
          x2={xAt(index)}
          y1={paddingTop}
          y2={paddingTop + plotHeight}
          className="curve-gridline curve-gridline--vertical"
        />
      ))}

      <path d={buildPath('oneYearAgo')} className="curve-line curve-year" />
      <path d={buildPath('oneMonthAgo')} className="curve-line curve-month" />
      <path d={buildPath('current')} className="curve-line curve-current" />

      {points.map((point, index) => (
        <g key={`dot-${point.tenor}`}>
          <circle cx={xAt(index)} cy={yAt(point.oneYearAgo)} r="3" className="curve-dot curve-dot--year" />
          <circle cx={xAt(index)} cy={yAt(point.oneMonthAgo)} r="3" className="curve-dot curve-dot--month" />
          <circle cx={xAt(index)} cy={yAt(point.current)} r="4" className="curve-dot curve-dot--current" />
          <text x={xAt(index)} y={yAt(point.current) - 12} textAnchor="middle" className="curve-point-label">
            {point.current.toFixed(2)}%
          </text>
        </g>
      ))}

      {points.map((point, index) => (
        <text key={`tenor-${point.tenor}`} x={xAt(index)} y={height - 16} textAnchor="middle" className="curve-tenor">
          {point.tenor}
        </text>
      ))}
    </svg>
  )
}

function applyMarketData(
  item: InstrumentDefinition,
  timeFrame: TimeFrame,
  snapshotSeed: number,
  liveQuotes: Map<string, ComputedQuote>,
  marketLookup: Map<string, RemoteMarketRow>,
): InstrumentSnapshot {
  const snapshot = buildSnapshot(item, timeFrame, snapshotSeed)
  const liveQuote = item.symbol ? liveQuotes.get(item.symbol) : undefined
  const override =
    marketLookup.get(item.id) ??
    marketLookup.get(slugify(item.name)) ??
    (item.symbol ? marketLookup.get(slugify(item.symbol)) : undefined)

  if (liveQuote) {
    const liveNote = item.symbol?.startsWith('fred:') ? 'Live FRED series' : 'Live quote'
    return {
      ...snapshot,
      value: liveQuote.value,
      changePct: liveQuote.changePct,
      changeValue: liveQuote.changeValue,
      series: liveQuote.series,
      isLive: true,
      note: liveNote,
    }
  }

  return override ? mergeSnapshot(snapshot, override) : snapshot
}

function buildSnapshot(
  item: InstrumentDefinition,
  timeFrame: TimeFrame,
  snapshotSeed: number,
): InstrumentSnapshot {
  const frameWeight = frameWeights[timeFrame]
  const seed = hashString(`${item.id}:${snapshotSeed}`)
  const wave = pseudoRandom(seed) * 2 - 1
  const drift = item.drift * frameWeight
  const volatility = item.volatility * frameWeight * wave
  const changePct = clamp(drift + volatility, -18, 18)
  const value = item.baseValue * (1 + changePct / 100)
  const changeValue = value - item.baseValue

  return {
    ...item,
    value,
    changePct,
    changeValue,
    isLive: false,
  }
}

function mergeSnapshot(snapshot: InstrumentSnapshot, override: RemoteMarketRow): InstrumentSnapshot {
  const value = override.value ?? snapshot.value
  const changePct = override.changePct ?? snapshot.changePct
  const changeValue = override.changeValue ?? value - snapshot.baseValue

  return {
    ...snapshot,
    group: override.group ?? snapshot.group,
    unit: override.unit ?? snapshot.unit,
    note: override.note ?? snapshot.note,
    value,
    changePct,
    changeValue,
    isLive: true,
  }
}

function buildMarketOverrideLookup(rows: RemoteMarketRow[]) {
  const lookup = new Map<string, RemoteMarketRow>()

  for (const row of rows) {
    if (row.name) {
      lookup.set(slugify(row.name), row)
    }

    if (row.symbol) {
      lookup.set(slugify(row.symbol), row)
    }
  }

  return lookup
}

function normalizeMarketFeed(feed: unknown) {
  if (Array.isArray(feed)) {
    return feed.filter((row): row is RemoteMarketRow => typeof row === 'object' && row !== null)
  }

  if (feed && typeof feed === 'object' && 'market' in feed) {
    const marketRows = (feed as { market?: RemoteMarketRow[] }).market
    return Array.isArray(marketRows) ? marketRows : []
  }

  return []
}

type RemoteHeadlineRow = { category?: string; title: string; detail?: string; url?: string }

function mapHeadlineRow(row: RemoteHeadlineRow): Headline {
  return {
    category: row.category ?? 'Market note',
    title: row.title,
    detail: row.detail ?? 'Live news item supplied by the configured feed.',
    url: row.url,
  }
}

function normalizeHeadlineFeed(feed: unknown): Headline[] {
  if (Array.isArray(feed)) {
    return feed
      .filter((row): row is RemoteHeadlineRow => typeof row === 'object' && row !== null)
      .map(mapHeadlineRow)
  }

  if (feed && typeof feed === 'object' && 'headlines' in feed) {
    const headlineRows = (feed as { headlines?: RemoteHeadlineRow[] }).headlines
    return Array.isArray(headlineRows) ? headlineRows.map(mapHeadlineRow) : []
  }

  return []
}

async function fetchRemoteFeed(url: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json() as Promise<unknown>
}

function formatValue(value: number, unit: Unit) {
  switch (unit) {
    case 'yield':
      return `${value.toFixed(2)}%`
    case 'fx':
      return value < 10 ? value.toFixed(4) : value.toFixed(2)
    case 'price':
      return value >= 1000 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`
    case 'rate':
      return value.toFixed(2)
    default:
      return value >= 1000 ? value.toFixed(1) : value.toFixed(2)
  }
}

function formatEstTimestamp(date: string, time: string) {
  const ms = estDateTimeToMs(date, time)
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function getLastCloseDate() {
  const snapshot = new Date()

  if (snapshot.getHours() < 16) {
    snapshot.setDate(snapshot.getDate() - 1)
  }

  while (snapshot.getDay() === 0 || snapshot.getDay() === 6) {
    snapshot.setDate(snapshot.getDate() - 1)
  }

  return toDateInputValue(snapshot)
}

function formatReportDate(value: string) {
  if (!value) {
    return 'Latest session'
  }

  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${year}-${month}-${day}`
}

function hashString(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function pseudoRandom(seed: number) {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function statTone(changePct?: number): StatTone {
  if (changePct == null) {
    return 'neutral'
  }
  return changePct >= 0 ? 'positive' : 'negative'
}

function changeLabel(changePct?: number) {
  if (changePct == null) {
    return undefined
  }
  return `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`
}

function indexStat(label: string, symbol: string, quote?: ComputedQuote): StatItem {
  return {
    label,
    symbol,
    value: quote ? formatValue(quote.value, 'index') : '—',
    delta: changeLabel(quote?.changePct),
    tone: statTone(quote?.changePct),
  }
}

function priceStat(label: string, symbol: string, quote?: ComputedQuote): StatItem {
  return {
    label,
    symbol,
    value: quote ? formatValue(quote.value, 'price') : '—',
    delta: changeLabel(quote?.changePct),
    tone: statTone(quote?.changePct),
  }
}

function yieldStat(label: string, symbol: string, quote?: ComputedQuote): StatItem {
  return {
    label,
    symbol,
    value: quote ? formatValue(quote.value, 'yield') : '—',
    delta:
      quote == null
        ? undefined
        : `${quote.changeValue >= 0 ? '+' : ''}${Math.round(quote.changeValue * 100)} bps`,
    tone: statTone(quote?.changeValue),
  }
}

function buildOverviewExportRows(liveQuotes: Map<string, ComputedQuote>): SnapshotOverviewRow[] {
  return [
    overviewExportRow('S&P 500', summarySymbols.sp500, 'index', liveQuotes.get(summarySymbols.sp500)),
    overviewExportRow('Russell 2000', summarySymbols.russell2000, 'index', liveQuotes.get(summarySymbols.russell2000)),
    overviewExportRow('Nasdaq', summarySymbols.nasdaq, 'index', liveQuotes.get(summarySymbols.nasdaq)),
    overviewExportRow('Dow Jones', summarySymbols.dow, 'index', liveQuotes.get(summarySymbols.dow)),
    overviewExportRow('VIX', summarySymbols.vix, 'index', liveQuotes.get(summarySymbols.vix)),
    overviewExportRow('10Y Treasury', summarySymbols.tenYear, 'yield', liveQuotes.get(summarySymbols.tenYear)),
    overviewExportRow('2Y Treasury', summarySymbols.twoYear, 'yield', liveQuotes.get(summarySymbols.twoYear)),
    overviewExportRow('DXY', summarySymbols.dollar, 'index', liveQuotes.get(summarySymbols.dollar)),
    overviewExportRow('Crude Oil', summarySymbols.crude, 'price', liveQuotes.get(summarySymbols.crude)),
  ]
}

function overviewExportRow(
  label: string,
  symbol: string,
  unit: Unit,
  quote?: ComputedQuote,
): SnapshotOverviewRow {
  return {
    label,
    symbol,
    unit,
    value: quote?.value ?? null,
    changePct: quote?.changePct ?? null,
    changeValue: quote?.changeValue ?? null,
  }
}

function pinnedTickerUnit(symbol: string): Unit {
  if (symbol.startsWith('fred:')) {
    return 'yield'
  }
  if (symbol.startsWith('^')) {
    return 'index'
  }
  return 'price'
}

function pinnedTickerStat(ticker: PinnedTicker, quote?: ComputedQuote): StatItem {
  const unit = pinnedTickerUnit(ticker.symbol)
  return {
    label: ticker.label,
    symbol: ticker.symbol,
    value: quote ? formatValue(quote.value, unit) : '—',
    delta:
      unit === 'yield'
        ? quote == null
          ? undefined
          : `${quote.changeValue >= 0 ? '+' : ''}${Math.round(quote.changeValue * 100)} bps`
        : changeLabel(quote?.changePct),
    tone: statTone(unit === 'yield' ? quote?.changeValue : quote?.changePct),
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export default MarketBarometer
