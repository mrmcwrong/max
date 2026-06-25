import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
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
import {
  computeCurvePoint,
  computeIntradayQuote,
  computeQuote,
  estDateTimeToMs,
  fetchIntradayForSymbols,
  fetchMarketBundle,
  fetchLiveHeadlines,
  formatPercentWithAmount,
  formatSignedAmount,
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

function MarketBarometer() {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('1W')
  const [snapshotDate, setSnapshotDate] = useState(() => getLastCloseDate())
  const [timeMode, setTimeMode] = useState<TimeMode>('close')
  const [customTime, setCustomTime] = useState('12:00')
  const [liveView, setLiveView] = useState(false)
  const [view, setView] = useState<'dashboard' | 'headlines'>('dashboard')
  const [histories, setHistories] = useState<Map<string, SymbolHistory>>(new Map())
  const [intraday, setIntraday] = useState<Map<string, SymbolHistory>>(new Map())
  const [intradayDate, setIntradayDate] = useState<string | null>(null)
  const [intradayLoading, setIntradayLoading] = useState(false)
  const [customMarketFeed, setCustomMarketFeed] = useState<RemoteMarketRow[]>([])
  const [customNewsFeed, setCustomNewsFeed] = useState<Headline[]>([])
  const [liveHeadlines, setLiveHeadlines] = useState<Headline[]>([])
  const [feedStatus, setFeedStatus] = useState<{ market: FeedStatus; news: FeedStatus }>({
    market: 'loading',
    news: 'loading',
  })

  const allSymbols = useMemo(
    () => [
      ...new Set([
        ...collectSymbols(sectionDefinitions.flatMap((section) => section.items)),
        ...treasuryCurveSymbols.map((point) => point.symbol),
        ...Object.values(summarySymbols),
      ]),
    ],
    [],
  )

  const orderedSymbols = useMemo(() => {
    const priority = new Set([
      ...Object.values(summarySymbols),
      ...treasuryCurveSymbols.map((point) => point.symbol),
    ])
    const preferred = allSymbols.filter((symbol) => priority.has(symbol))
    const remainder = allSymbols.filter((symbol) => !priority.has(symbol))
    return [...preferred, ...remainder]
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

      const [customMarketResult, historyResult] = await Promise.allSettled([
        customMarketPromise,
        historyPromise,
      ])

      let marketStatus: FeedStatus = 'fallback'

      if (historyResult.status === 'fulfilled') {
        const bundle = historyResult.value
        if (bundle.histories.size > 0 || bundle.intraday.size > 0) {
          if (bundle.histories.size > 0) {
            setHistories(bundle.histories)
          }
          if (bundle.intraday.size > 0) {
            setIntraday(bundle.intraday)
            if (options?.intradayDate) {
              setIntradayDate(options.intradayDate)
            }
          }
          marketStatus = 'live'
        } else {
          setHistories(new Map())
          marketStatus = 'fallback'
        }
      } else {
        setHistories(new Map())
        marketStatus = 'error'
      }

      if (customMarketResult.status === 'fulfilled' && customMarketResult.value) {
        setCustomMarketFeed(normalizeMarketFeed(customMarketResult.value))
        marketStatus = 'live'
      }

      setFeedStatus((current) => ({ ...current, market: marketStatus }))
    },
    [orderedSymbols, intradaySymbolList],
  )

  const loadNews = useCallback(async (date: string, time: string) => {
    setFeedStatus((current) => ({ ...current, news: 'loading' }))

    const customNewsPromise = newsFeedUrl ? fetchRemoteFeed(newsFeedUrl) : Promise.resolve(null)
    const newsPromise = fetchLiveHeadlines(date, time)

    const [customNewsResult, newsResult] = await Promise.allSettled([customNewsPromise, newsPromise])

    let newsStatus: FeedStatus = 'fallback'

    if (newsResult.status === 'fulfilled' && newsResult.value.length > 0) {
      setLiveHeadlines(newsResult.value)
      newsStatus = 'live'
    } else {
      setLiveHeadlines([])
      newsStatus = newsResult.status === 'rejected' ? 'error' : 'fallback'
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

  const topHeadlines = headlineItems.slice(0, 4)

  const tenYearQuote = liveQuotes.get(summarySymbols.tenYear)
  const twoYearQuote = liveQuotes.get(summarySymbols.twoYear)

  const stats: StatItem[] = [
    indexStat('S&P 500', liveQuotes.get(summarySymbols.sp500)),
    indexStat('Russell 2000', liveQuotes.get(summarySymbols.russell2000)),
    indexStat('Nasdaq', liveQuotes.get(summarySymbols.nasdaq)),
    indexStat('Dow Jones', liveQuotes.get(summarySymbols.dow)),
    indexStat('VIX', liveQuotes.get(summarySymbols.vix)),
    yieldStat('10Y Treasury', tenYearQuote),
    yieldStat('2Y Treasury', twoYearQuote),
    indexStat('DXY', liveQuotes.get(summarySymbols.dollar)),
    priceStat('Crude Oil', liveQuotes.get(summarySymbols.crude)),
  ]

  const orderedSections = SECTION_ORDER.map((title) => sections.find((section) => section.title === title)).filter(
    (section): section is ResolvedSection => Boolean(section),
  )

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

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  if (view === 'headlines') {
    return <HeadlinesPage headlines={headlineItems} onBack={() => setView('dashboard')} />
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
            <button type="button" onClick={handlePrint}>
              Print
            </button>
          </div>
        </div>
      </header>

      <section className="glance">
        <StatTicker stats={stats} />
      </section>

      <CollapsiblePanel
        title="Top headlines"
        subtitle="Ranked for the snapshot date and time — Fed, earnings, macro, and trade stories that matter most right then"
        eyebrow="News"
        defaultOpen
        action={
          <button
            type="button"
            className="panel-link"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setView('headlines')
            }}
          >
            More headlines →
          </button>
        }
      >
        <div className="headline-grid">
          {topHeadlines.map((headline) => (
            <HeadlineLink key={`${headline.category}-${headline.title}`} headline={headline} />
          ))}
        </div>
      </CollapsiblePanel>

      {orderedSections.map((section) => (
        <Fragment key={section.title}>
          <CollapsibleSection section={section} />
          {section.title === CURVE_AFTER_SECTION ? (
            <CollapsiblePanel
              title="U.S. Treasury yield curve"
              subtitle="Yields across maturities — snapshot versus one month and one year prior"
            >
              <div className="curve-wrap">
                <div className="curve-legend">
                  <LegendItem label="Snapshot" tone="current" />
                  <LegendItem label="1 month prior" tone="month" />
                  <LegendItem label="1 year prior" tone="year" />
                </div>
                {treasuryCurve.length > 0 ? (
                  <CurveChart points={treasuryCurve} domain={curveDomain} />
                ) : (
                  <p className="curve-footnote">Loading live treasury curve data…</p>
                )}
              </div>
            </CollapsiblePanel>
          ) : null}
        </Fragment>
      ))}
      </div>

      <PrintReport
        timeFrameLabel={frameLabels[timeFrame]}
        snapshotDate={snapshotDate}
        snapshotTimeLabel={snapshotTimeLabel}
        stats={stats}
        headlines={topHeadlines}
        sections={orderedSections}
        treasuryCurve={treasuryCurve}
        curveDomain={curveDomain}
      />
    </main>
  )
}

function HeadlinesPage({ headlines, onBack }: { headlines: Headline[]; onBack: () => void }) {
  return (
    <main className="page-shell">
      <header className="headlines-page__header">
        <button type="button" className="back-button" onClick={onBack}>
          ← Back to dashboard
        </button>
        <div>
          <p className="eyebrow">News</p>
          <h1>All market headlines</h1>
          <p className="hero-text">Live economic and business headlines, newest first. Click any item to read the source.</p>
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
  snapshotDate,
  snapshotTimeLabel,
  stats,
  headlines,
  sections,
  treasuryCurve,
  curveDomain,
}: {
  timeFrameLabel: string
  snapshotDate: string
  snapshotTimeLabel: string
  stats: StatItem[]
  headlines: Headline[]
  sections: ResolvedSection[]
  treasuryCurve: CurvePoint[]
  curveDomain: { min: number; max: number }
}) {
  return (
    <article className="print-report" aria-hidden="true">
      <header className="print-report__header">
        <p className="print-report__brand">MAX</p>
        <h1>Market Analytics Explorer</h1>
        <dl className="print-report__meta">
          <div>
            <dt>Snapshot date</dt>
            <dd>{formatReportDate(snapshotDate)}</dd>
          </div>
          <div>
            <dt>Snapshot time</dt>
            <dd>{snapshotTimeLabel}</dd>
          </div>
          <div>
            <dt>Time period</dt>
            <dd>{timeFrameLabel}</dd>
          </div>
        </dl>
      </header>

      <PrintReportBlock className="print-report__block--overview" head={<h2>Overview</h2>} body={
        <div className="print-stat-grid">
          {stats.map((stat) => (
            <div className={`print-stat print-stat--${stat.tone}`} key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              {stat.delta ? <em>{stat.delta}</em> : null}
            </div>
          ))}
        </div>
      } />

      <PrintReportBlock
        className="print-report__block--headlines"
        head={<h2>Top headlines</h2>}
        body={
          <div className="print-headlines">
            {headlines.map((headline) => (
              <div className="print-headline" key={`${headline.category}-${headline.title}`}>
                <p className="print-headline__category">{headline.category}</p>
                <h3>{headline.title}</h3>
                <p className="print-headline__detail">{headline.detail}</p>
              </div>
            ))}
          </div>
        }
      />

      {sections.map((section) => (
        <Fragment key={section.title}>
          <PrintReportSection section={section} />
          {section.title === CURVE_AFTER_SECTION ? (
            <PrintReportBlock
              className="print-report__block--curve"
              head={
                <>
                  <h2>U.S. Treasury yield curve</h2>
                  <p className="print-report__lede">Snapshot date versus one month prior versus one year prior.</p>
                </>
              }
              body={
                <div className="curve-wrap">
                  <div className="curve-legend">
                    <LegendItem label="Snapshot" tone="current" />
                    <LegendItem label="1 month prior" tone="month" />
                    <LegendItem label="1 year prior" tone="year" />
                  </div>
                  {treasuryCurve.length > 0 ? (
                    <CurveChart points={treasuryCurve} domain={curveDomain} />
                  ) : (
                    <p className="curve-footnote">Treasury curve data unavailable for this snapshot.</p>
                  )}
                </div>
              }
            />
          ) : null}
        </Fragment>
      ))}
    </article>
  )
}

function PrintReportSection({ section }: { section: ResolvedSection }) {
  const groupedItems: Array<{ group: string; items: InstrumentSnapshot[] }> = section.groups
    ? section.groups.map((group) => ({
        group,
        items: section.items.filter((item) => item.group === group),
      }))
    : [{ group: section.title, items: section.items }]

  return (
    <PrintReportBlock
      className="print-report__block--section"
      head={
        <>
          <h2>{section.title}</h2>
          <p className="print-report__lede">{section.subtitle}</p>
        </>
      }
      body={
        <>
          {groupedItems.map(({ group, items }) => (
            <div className="print-report__group" key={group}>
              {section.groups ? (
                <div className="print-report__group-head">
                  <h3>{group}</h3>
                </div>
              ) : null}
              <table className="print-table print-table--instruments">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Symbol</th>
                    <th>Value</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const positive = item.changePct >= 0
                    return (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.symbol ?? '—'}</td>
                        <td>{formatValue(item.value, item.unit)}</td>
                        <td className={positive ? 'trend-up-text' : 'trend-down-text'}>
                          {formatPercentWithAmount(item.changePct, item.changeValue, item.unit)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </>
      }
    />
  )
}

function PrintReportBlock({
  className,
  head,
  body,
}: {
  className?: string
  head: ReactNode
  body: ReactNode
}) {
  return (
    <section className={className ? `print-report__block ${className}` : 'print-report__block'}>
      <div className="print-report__block-inner">
        <div className="print-report__block-head">{head}</div>
        <div className="print-report__block-body">{body}</div>
      </div>
    </section>
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
          {loop.map((stat, index) => (
            <span className="ticker__item ticker__stat" key={`${stat.label}-${index}`}>
              <b>{stat.label}</b>
              <span>{stat.value}</span>
              {stat.delta ? (
                <span className={`stat-chip__delta--${stat.tone}`}>{stat.delta}</span>
              ) : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function CollapsibleSection({ section }: { section: ResolvedSection }) {
  const groupedItems: Array<{ group: string; items: InstrumentSnapshot[] }> = section.groups
    ? section.groups.map((group) => ({
        group,
        items: section.items.filter((item) => item.group === group),
      }))
    : [{ group: section.title, items: section.items }]

  return (
    <CollapsiblePanel
      title={section.title}
      subtitle={section.subtitle}
      defaultOpen={section.defaultOpen ?? false}
      badge={`${section.items.length} instruments`}
    >
      {section.groups ? (
        <div className="group-stack">
          {groupedItems.map(({ group, items }) => (
            <details className="group-dropdown" key={group} open={group === section.groups?.[0]}>
              <summary>
                <span>{group}</span>
                <span className="group-dropdown__count">{items.length} items</span>
              </summary>
              <div className="asset-grid">
                {items.map((item) => (
                  <AssetCard key={item.id} item={item} />
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="asset-grid">
          {section.items.map((item) => (
            <AssetCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </CollapsiblePanel>
  )
}

function CollapsiblePanel({
  title,
  subtitle,
  children,
  defaultOpen = false,
  eyebrow,
  badge,
  action,
}: {
  title: string
  subtitle: string
  children: ReactNode
  defaultOpen?: boolean
  eyebrow?: string
  badge?: string
  action?: ReactNode
}) {
  return (
    <details className="collapsible-panel" open={defaultOpen}>
      <summary className="collapsible-panel__summary">
        <div className="collapsible-panel__heading">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {action ? <div className="collapsible-panel__action">{action}</div> : null}
        {badge ? <span className="collapsible-panel__badge">{badge}</span> : null}
      </summary>
      <div className="collapsible-panel__body">{children}</div>
    </details>
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

function AssetCard({ item }: { item: InstrumentSnapshot }) {
  const positive = item.changePct >= 0
  const href = item.symbol ? yahooQuoteUrl(item.symbol) : undefined

  const content = (
    <>
      <div className="asset-card__top">
        <div className="asset-card__id">
          <p className="asset-card__group">{item.group}</p>
          <h3>{item.name}</h3>
        </div>
        <div className="asset-card__quote">
          <div className="asset-card__value">{formatValue(item.value, item.unit)}</div>
          <span className={`trend-badge ${positive ? 'trend-up' : 'trend-down'}`}>
            {formatPercentWithAmount(item.changePct, item.changeValue, item.unit)}
          </span>
        </div>
      </div>
      <div className="asset-card__chart">
        <span className="asset-card__change-label">Change {formatSignedAmount(item.changeValue, item.unit)}</span>
        <Sparkline series={item.series ?? []} positive={positive} />
      </div>
      <div className="asset-card__meta">
        <span className="asset-card__symbol">
          {item.symbol ?? '—'}
          {item.isLive ? <i className="live-dot" aria-label="live data" /> : null}
        </span>
        <span>{item.isLive ? 'Live · click for Yahoo Finance' : 'Snapshot model'}</span>
      </div>
    </>
  )

  if (!href) {
    return <article className="asset-card">{content}</article>
  }

  return (
    <a className="asset-card asset-card--link" href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
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
    return {
      ...snapshot,
      value: liveQuote.value,
      changePct: liveQuote.changePct,
      changeValue: liveQuote.changeValue,
      series: liveQuote.series,
      isLive: true,
      note: 'Live quote',
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

function indexStat(label: string, quote?: ComputedQuote): StatItem {
  return {
    label,
    value: quote ? formatValue(quote.value, 'index') : '—',
    delta: changeLabel(quote?.changePct),
    tone: statTone(quote?.changePct),
  }
}

function priceStat(label: string, quote?: ComputedQuote): StatItem {
  return {
    label,
    value: quote ? formatValue(quote.value, 'price') : '—',
    delta: changeLabel(quote?.changePct),
    tone: statTone(quote?.changePct),
  }
}

function yieldStat(label: string, quote?: ComputedQuote): StatItem {
  return {
    label,
    value: quote ? formatValue(quote.value, 'yield') : '—',
    delta:
      quote == null
        ? undefined
        : `${quote.changeValue >= 0 ? '+' : ''}${Math.round(quote.changeValue * 100)} bps`,
    tone: statTone(quote?.changeValue),
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export default MarketBarometer
