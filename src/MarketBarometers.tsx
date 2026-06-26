import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology } from 'topojson-specification'
import { countryIndexByIso } from './barometer/countryIndexCatalog'
import {
  frameLabels,
  usStyleBarometerCells,
  type Headline,
  type StyleBoxCell,
  type TimeFrame,
} from './instrumentCatalog'
import { yahooQuoteUrl, type ComputedQuote } from './liveMarket'

const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
const MAP_WIDTH = 760
const MAP_HEIGHT = 360

type BarometerProps = {
  liveQuotes: Map<string, ComputedQuote>
  timeFrame: TimeFrame
}

type MapFeature = Feature<Geometry, { name?: string }> & { id?: string | number }

type MapTooltip = {
  country: string
  indexName?: string
  symbol?: string
  changePct?: number
  x: number
  y: number
}

const styleColumns: StyleBoxCell['style'][] = ['Value', 'Blend', 'Growth']
const styleRows: StyleBoxCell['cap'][] = ['Large', 'Mid', 'Small']

function performanceTone(changePct?: number) {
  if (changePct == null || Number.isNaN(changePct)) {
    return { className: 'barometer-cell--empty', heat: 0, label: '—' }
  }

  const heat = Math.min(Math.abs(changePct) / 8, 1)
  return {
    className: changePct >= 0 ? 'barometer-cell--up' : 'barometer-cell--down',
    heat,
    label: `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`,
  }
}

function countryFill(changePct?: number) {
  if (changePct == null || Number.isNaN(changePct)) {
    return 'rgba(148, 163, 184, 0.14)'
  }

  const intensity = Math.min(Math.abs(changePct) / 6, 1)
  if (changePct >= 0) {
    return `rgba(52, 211, 153, ${0.12 + intensity * 0.62})`
  }

  return `rgba(249, 115, 22, ${0.12 + intensity * 0.62})`
}

function project([lon, lat]: [number, number]) {
  return [
    ((lon + 180) / 360) * MAP_WIDTH,
    ((90 - lat) / 180) * MAP_HEIGHT,
  ] as const
}

function ringToPath(ring: number[][]) {
  const segments: string[] = []
  let segment: string[] = []

  const flush = () => {
    if (segment.length >= 2) {
      segments.push(`${segment.join(' ')}Z`)
    }
    segment = []
  }

  for (let index = 0; index < ring.length; index += 1) {
    const [lon, lat] = ring[index]

    if (index > 0) {
      const prevLon = ring[index - 1][0]
      if (Math.abs(lon - prevLon) > 180) {
        flush()
      }
    }

    const [x, y] = project([lon, lat])
    segment.push(`${segment.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
  }

  flush()
  return segments.join(' ')
}

function geometryToPath(geometry: Geometry) {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => ringToPath(ring)).join(' ')
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon.map((ring) => ringToPath(ring))).join(' ')
  }

  return ''
}

function parseAtlasFeatures(topology: Topology): MapFeature[] {
  const collection = feature(
    topology,
    topology.objects.countries as Parameters<typeof feature>[1],
  ) as FeatureCollection<Geometry, { name?: string }>

  return collection.features as MapFeature[]
}

function readCachedAtlasFeatures(): MapFeature[] {
  try {
    const cached = sessionStorage.getItem('max-world-atlas')
    if (!cached) {
      return []
    }

    return parseAtlasFeatures(JSON.parse(cached) as Topology)
  } catch {
    return []
  }
}

let atlasLoadPromise: Promise<MapFeature[]> | null = null

export function ensureWorldAtlasReady(): Promise<MapFeature[]> {
  const cached = readCachedAtlasFeatures()
  if (cached.length > 0) {
    return Promise.resolve(cached)
  }

  if (!atlasLoadPromise) {
    atlasLoadPromise = fetch(WORLD_ATLAS_URL)
      .then((response) => response.json() as Promise<Topology>)
      .then((topology) => {
        sessionStorage.setItem('max-world-atlas', JSON.stringify(topology))
        return parseAtlasFeatures(topology)
      })
      .catch(() => [] as MapFeature[])
  }

  return atlasLoadPromise
}

function useWorldAtlasFeatures(): MapFeature[] {
  const [features, setFeatures] = useState<MapFeature[]>(() => readCachedAtlasFeatures())

  useEffect(() => {
    if (features.length > 0) {
      return undefined
    }

    let cancelled = false

    void ensureWorldAtlasReady().then((loaded) => {
      if (!cancelled && loaded.length > 0) {
        setFeatures(loaded)
      }
    })

    return () => {
      cancelled = true
    }
  }, [features.length])

  return features
}

export function filterHeadlinesByCategory(headlines: Headline[], selectedCategories: string[]) {
  if (selectedCategories.length === 0) {
    return headlines
  }

  const allowed = new Set(selectedCategories)
  return headlines.filter((headline) => allowed.has(headline.category))
}

export function NewsCategoryFilter({
  categories,
  selectedCategories,
  onSelectedCategoriesChange,
}: {
  categories: string[]
  selectedCategories: string[]
  onSelectedCategoriesChange: (categories: string[]) => void
}) {
  const allSelected = selectedCategories.length === 0
  const summary = allSelected
    ? 'All categories'
    : selectedCategories.length === 1
      ? selectedCategories[0]
      : `${selectedCategories.length} categories`

  const toggleCategory = (category: string) => {
    if (selectedCategories.includes(category)) {
      onSelectedCategoriesChange(selectedCategories.filter((entry) => entry !== category))
      return
    }

    onSelectedCategoriesChange([...selectedCategories, category])
  }

  return (
    <details className="news-category-filter">
      <summary aria-label="Filter headlines by category">{summary}</summary>
      <div className="news-category-filter__menu" role="group" aria-label="News categories">
        <label className="news-category-filter__option">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onSelectedCategoriesChange([])}
          />
          <span>All categories</span>
        </label>
        {categories.map((category) => (
          <label key={category} className="news-category-filter__option">
            <input
              type="checkbox"
              checked={!allSelected && selectedCategories.includes(category)}
              onChange={() => toggleCategory(category)}
            />
            <span>{category}</span>
          </label>
        ))}
      </div>
    </details>
  )
}

export function NewsModeToggle({
  breakingNews,
  breakingAvailable,
  onBreakingNewsChange,
}: {
  breakingNews: boolean
  breakingAvailable: boolean
  onBreakingNewsChange: (enabled: boolean) => void
}) {
  return (
    <div className="news-toggle" role="group" aria-label="News mode">
      <button
        type="button"
        className={`news-toggle__button ${!breakingNews ? 'is-active' : ''}`}
        onClick={() => onBreakingNewsChange(false)}
      >
        Snapshot
      </button>
      <button
        type="button"
        className={`news-toggle__button ${breakingNews ? 'is-active' : ''}`}
        onClick={() => onBreakingNewsChange(true)}
        disabled={!breakingAvailable}
        title={breakingAvailable ? 'Show major stories from the past few hours' : 'Breaking news loading…'}
      >
        Breaking
      </button>
    </div>
  )
}

type OverviewBoardProps = BarometerProps & {
  headlines: Headline[]
  breakingNews: boolean
  breakingAvailable: boolean
  onBreakingNewsChange: (enabled: boolean) => void
  newsCategories: string[]
  selectedNewsCategories: string[]
  onSelectedNewsCategoriesChange: (categories: string[]) => void
  onMoreHeadlines: () => void
  renderHeadline: (headline: Headline) => ReactNode
}

export function OverviewBoard({
  liveQuotes,
  timeFrame,
  headlines,
  breakingNews,
  breakingAvailable,
  onBreakingNewsChange,
  newsCategories,
  selectedNewsCategories,
  onSelectedNewsCategoriesChange,
  onMoreHeadlines,
  renderHeadline,
}: OverviewBoardProps) {
  return (
    <div className="overview-board">
      <aside className="overview-board__news">
        <header className="overview-board__news-header">
          <div>
            <p className="eyebrow">News</p>
            <h2>{breakingNews ? 'Breaking news' : 'Snapshot headlines'}</h2>
          </div>
          <div className="overview-board__news-actions">
            <NewsModeToggle
              breakingNews={breakingNews}
              breakingAvailable={breakingAvailable}
              onBreakingNewsChange={onBreakingNewsChange}
            />
            <NewsCategoryFilter
              categories={newsCategories}
              selectedCategories={selectedNewsCategories}
              onSelectedCategoriesChange={onSelectedNewsCategoriesChange}
            />
            <button type="button" className="panel-link" onClick={onMoreHeadlines}>
              More market headlines →
            </button>
          </div>
        </header>
        <div className="overview-board__news-list">
          {headlines.slice(0, 6).map((headline) => (
            <Fragment key={`${headline.category}-${headline.title}`}>{renderHeadline(headline)}</Fragment>
          ))}
        </div>
      </aside>

      <div className="overview-board__barometers">
        <div className="overview-barometers">
          <UsStyleBarometer liveQuotes={liveQuotes} timeFrame={timeFrame} />
          <InternationalBarometer liveQuotes={liveQuotes} timeFrame={timeFrame} />
        </div>
      </div>
    </div>
  )
}

function UsStyleBarometer({ liveQuotes, timeFrame }: BarometerProps) {
  return (
    <section className="barometer-panel barometer-panel--compact" aria-label="U.S. Equity market barometer">
      <header className="barometer-panel__header barometer-panel__header--compact">
        <div>
          <p className="eyebrow">U.S. barometer</p>
          <h2>U.S. Equity</h2>
          <p className="barometer-panel__lede">{frameLabels[timeFrame]} change across nine U.S. equity benchmarks</p>
        </div>
      </header>

      <div className="style-box style-box--compact">
        <div className="style-box__corner" />
        <div className="style-box__col-label">Value</div>
        <div className="style-box__col-label">Core</div>
        <div className="style-box__col-label">Growth</div>

        {styleRows.map((cap) => (
          <StyleBoxRow key={cap} cap={cap} liveQuotes={liveQuotes} />
        ))}
      </div>
    </section>
  )
}

function StyleBoxRow({ cap, liveQuotes }: { cap: StyleBoxCell['cap']; liveQuotes: Map<string, ComputedQuote> }) {
  return (
    <Fragment>
      <div className="style-box__row-label">{cap}</div>
      {styleColumns.map((style) => {
        const cell = usStyleBarometerCells.find((entry) => entry.cap === cap && entry.style === style)
        if (!cell) {
          return <div key={`${cap}-${style}`} className="style-box__cell barometer-cell--empty" />
        }

        const quote = liveQuotes.get(cell.symbol)
        const tone = performanceTone(quote?.changePct)

        return (
          <a
            key={cell.symbol}
            className={`style-box__cell barometer-cell ${tone.className}`}
            style={{ '--heat': tone.heat } as CSSProperties}
            href={yahooQuoteUrl(cell.symbol)}
            target="_blank"
            rel="noreferrer"
            title={cell.name}
            aria-label={`${cell.name}: ${tone.label}`}
          >
            <strong className="barometer-cell__value">{tone.label}</strong>
          </a>
        )
      })}
    </Fragment>
  )
}

function InternationalBarometer({ liveQuotes, timeFrame }: BarometerProps) {
  const [tooltip, setTooltip] = useState<MapTooltip | null>(null)
  const features = useWorldAtlasFeatures()

  const featureRows = useMemo(
    () =>
      features.map((mapFeature) => {
        const isoNumeric = Number(mapFeature.id)
        const market = countryIndexByIso.get(isoNumeric)
        const quote = market ? liveQuotes.get(market.symbol) : undefined

        return {
          mapFeature,
          market,
          changePct: quote?.changePct,
          fill: countryFill(quote?.changePct),
        }
      }),
    [features, liveQuotes],
  )

  return (
    <section className="barometer-panel barometer-panel--compact" aria-label="International market barometer">
      <header className="barometer-panel__header barometer-panel__header--compact">
        <div>
          <p className="eyebrow">International barometer</p>
          <h2>Global equity map</h2>
          <p className="barometer-panel__lede">
            Country equity benchmarks · hover or click for {frameLabels[timeFrame]} change
          </p>
        </div>
        <div className="barometer-legend barometer-legend--compact">
          <span className="barometer-legend__swatch barometer-legend__swatch--up" />
          <span className="barometer-legend__swatch barometer-legend__swatch--down" />
        </div>
      </header>

      <div className="world-map">
        <svg
          className="world-map__svg"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="img"
          aria-label="World map colored by country equity performance"
        >
          <rect className="world-map__ocean" x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} rx="14" />
          {featureRows.map(({ mapFeature, market, changePct, fill }) => {
            const countryName = market?.country ?? mapFeature.properties?.name ?? 'Unknown'
            const path = (
              <path
                className={`world-map__country${market?.symbol ? ' world-map__country--linked' : ''}`}
                d={geometryToPath(mapFeature.geometry)}
                fill={fill}
                onMouseEnter={(event) => {
                  setTooltip({
                    country: countryName,
                    indexName: market?.indexName,
                    symbol: market?.symbol,
                    changePct,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }}
                onMouseMove={(event) => {
                  setTooltip((current) =>
                    current
                      ? {
                          ...current,
                          x: event.clientX,
                          y: event.clientY,
                        }
                      : current,
                  )
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            )

            if (!market?.symbol) {
              return <Fragment key={String(mapFeature.id ?? countryName)}>{path}</Fragment>
            }

            return (
              <a
                key={String(mapFeature.id ?? countryName)}
                href={yahooQuoteUrl(market.symbol)}
                target="_blank"
                rel="noreferrer"
                className="world-map__link"
                aria-label={`${countryName} market index`}
                onFocus={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setTooltip({
                    country: countryName,
                    indexName: market.indexName,
                    symbol: market.symbol,
                    changePct,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                  })
                }}
                onBlur={() => setTooltip(null)}
              >
                {path}
              </a>
            )
          })}
        </svg>

        {tooltip ? (
          <div
            className="world-map__tooltip"
            style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
            role="status"
          >
            <strong>{tooltip.country}</strong>
            {tooltip.indexName ? <span>{tooltip.indexName}</span> : null}
            <span>
              {tooltip.changePct == null || Number.isNaN(tooltip.changePct)
                ? 'No live index data'
                : `${tooltip.changePct >= 0 ? '+' : ''}${tooltip.changePct.toFixed(2)}%`}
            </span>
            {tooltip.symbol ? <em className="world-map__tooltip-hint">Click for Yahoo Finance</em> : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function PrintBarometerBlock({ liveQuotes, timeFrame }: BarometerProps) {
  const features = useWorldAtlasFeatures()

  const featureRows = useMemo(
    () =>
      features.map((mapFeature) => {
        const isoNumeric = Number(mapFeature.id)
        const market = countryIndexByIso.get(isoNumeric)
        const quote = market ? liveQuotes.get(market.symbol) : undefined

        return {
          mapFeature,
          fill: countryFill(quote?.changePct),
        }
      }),
    [features, liveQuotes],
  )

  return (
    <section className="print-barometers">
      <div className="print-barometers__panel">
        <h3 className="print-barometers__title">U.S. Equity · {frameLabels[timeFrame]}</h3>
        <div className="print-style-box">
          <div className="print-style-box__corner" />
          <div className="print-style-box__label">Val</div>
          <div className="print-style-box__label">Core</div>
          <div className="print-style-box__label">Grw</div>
          {styleRows.map((cap) => (
            <Fragment key={cap}>
              <div className="print-style-box__cap">{cap}</div>
              {styleColumns.map((style) => {
                const cell = usStyleBarometerCells.find((entry) => entry.cap === cap && entry.style === style)
                if (!cell) {
                  return <div key={`${cap}-${style}`} className="print-style-box__cell print-style-box__cell--empty" />
                }
                const tone = performanceTone(liveQuotes.get(cell.symbol)?.changePct)
                return (
                  <div key={cell.symbol} className={`print-style-box__cell print-style-box__cell--${tone.className.replace('barometer-cell--', '')}`}>
                    {tone.label}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="print-barometers__panel print-barometers__panel--map">
        <h3 className="print-barometers__title">Global equity map · {frameLabels[timeFrame]}</h3>
        <svg className="print-world-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="World equity map">
          <rect className="print-world-map__ocean" x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} />
          {featureRows.map(({ mapFeature, fill }) => (
            <path key={String(mapFeature.id ?? mapFeature.properties?.name)} d={geometryToPath(mapFeature.geometry)} fill={fill} />
          ))}
        </svg>
      </div>
    </section>
  )
}
