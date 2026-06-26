import { countryMarketIndexes } from './barometer/countryIndexCatalog'
import type { PinnedTicker } from './deviceSettings'
import {
  usStyleBarometerCells,
  type CurvePoint,
  type Headline,
  type TimeFrame,
  type Unit,
} from './instrumentCatalog'
import type { ComputedQuote } from './liveMarket'

export type SnapshotInstrumentRow = {
  section: string
  group: string
  name: string
  symbol: string
  unit: Unit
  value: number | null
  changePct: number | null
  changeValue: number | null
  isLive: boolean
  note: string
}

export type SnapshotOverviewRow = {
  label: string
  symbol: string
  unit: Unit
  value: number | null
  changePct: number | null
  changeValue: number | null
}

export type SnapshotExportInput = {
  snapshotDate: string
  snapshotTimeLabel: string
  timeFrame: TimeFrame
  timeFrameLabel: string
  liveView: boolean
  newsMode: 'breaking' | 'snapshot'
  sections: Array<{
    title: string
    items: Array<{
      group: string
      name: string
      symbol?: string
      unit: Unit
      value: number
      changePct: number
      changeValue: number
      isLive?: boolean
      note?: string
    }>
  }>
  overviewRows: SnapshotOverviewRow[]
  treasuryCurve: CurvePoint[]
  headlines: Headline[]
  pinnedTickers: PinnedTicker[]
  liveQuotes: Map<string, ComputedQuote>
}

type SheetRow = Record<string, string | number | boolean | null | undefined>

function quoteFields(symbol: string | undefined, liveQuotes: Map<string, ComputedQuote>) {
  if (!symbol) {
    return { value: null, changePct: null, changeValue: null }
  }

  const quote = liveQuotes.get(symbol)
  if (!quote) {
    return { value: null, changePct: null, changeValue: null }
  }

  return {
    value: quote.value,
    changePct: quote.changePct,
    changeValue: quote.changeValue,
  }
}

export function buildInstrumentRows(input: SnapshotExportInput): SnapshotInstrumentRow[] {
  return input.sections.flatMap((section) =>
    section.items.map((item) => ({
      section: section.title,
      group: item.group,
      name: item.name,
      symbol: item.symbol ?? '',
      unit: item.unit,
      value: item.value,
      changePct: item.changePct,
      changeValue: item.changeValue,
      isLive: Boolean(item.isLive),
      note: item.note ?? '',
    })),
  )
}

function buildMetadataRows(input: SnapshotExportInput): SheetRow[] {
  return [
    { Field: 'Product', Value: 'MAX Market Analytics Explorer' },
    { Field: 'Snapshot date', Value: input.snapshotDate },
    { Field: 'Snapshot time', Value: input.snapshotTimeLabel },
    { Field: 'Time frame', Value: input.timeFrame },
    { Field: 'Time frame label', Value: input.timeFrameLabel },
    { Field: 'Live view', Value: input.liveView ? 'Yes' : 'No' },
    { Field: 'News mode', Value: input.newsMode },
    { Field: 'Exported at', Value: new Date().toISOString() },
  ]
}

function buildOverviewSheet(input: SnapshotExportInput): SheetRow[] {
  return input.overviewRows.map((row) => ({
    Label: row.label,
    Symbol: row.symbol,
    Unit: row.unit,
    Value: row.value,
    'Change %': row.changePct,
    'Change value': row.changeValue,
  }))
}

function buildInstrumentsSheet(input: SnapshotExportInput): SheetRow[] {
  return buildInstrumentRows(input).map((row) => ({
    Section: row.section,
    Group: row.group,
    Name: row.name,
    Symbol: row.symbol,
    Unit: row.unit,
    Value: row.value,
    'Change %': row.changePct,
    'Change value': row.changeValue,
    'Live data': row.isLive ? 'Yes' : 'No',
    Note: row.note,
  }))
}

function buildTreasurySheet(input: SnapshotExportInput): SheetRow[] {
  return input.treasuryCurve.map((point) => ({
    Tenor: point.tenor,
    Symbol: point.symbol,
    Current: point.current,
    '1 month ago': point.oneMonthAgo,
    '1 year ago': point.oneYearAgo,
  }))
}

function buildHeadlinesSheet(input: SnapshotExportInput): SheetRow[] {
  return input.headlines.map((headline) => ({
    Category: headline.category,
    Title: headline.title,
    Detail: headline.detail,
    URL: headline.url ?? '',
  }))
}

function buildPinnedSheet(input: SnapshotExportInput): SheetRow[] {
  return input.pinnedTickers.map((ticker) => {
    const quote = quoteFields(ticker.symbol, input.liveQuotes)
    return {
      Label: ticker.label,
      Symbol: ticker.symbol,
      Value: quote.value,
      'Change %': quote.changePct,
      'Change value': quote.changeValue,
    }
  })
}

function buildUsStyleSheet(input: SnapshotExportInput): SheetRow[] {
  return usStyleBarometerCells.map((cell) => {
    const quote = quoteFields(cell.symbol, input.liveQuotes)
    return {
      Cap: cell.cap,
      Style: cell.style,
      Name: cell.name,
      Symbol: cell.symbol,
      Value: quote.value,
      'Change %': quote.changePct,
    }
  })
}

function buildGlobalEquitySheet(input: SnapshotExportInput): SheetRow[] {
  return countryMarketIndexes.map((market) => {
    const quote = quoteFields(market.symbol, input.liveQuotes)
    return {
      Country: market.country,
      Index: market.indexName,
      Symbol: market.symbol,
      Value: quote.value,
      'Change %': quote.changePct,
    }
  })
}

function escapeCsvCell(value: string | number | boolean | null | undefined) {
  if (value == null) {
    return ''
  }

  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }

  return text
}

function sheetRowsToCsv(rows: SheetRow[]) {
  if (rows.length === 0) {
    return ''
  }

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
  ]

  return lines.join('\r\n')
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function buildExportFilename(input: SnapshotExportInput, extension: 'csv' | 'xlsx') {
  const datePart = input.snapshotDate.replace(/-/g, '')
  const timePart = input.snapshotTimeLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24)

  return `max-snapshot-${datePart}-${input.timeFrame.toLowerCase()}${timePart ? `-${timePart}` : ''}.${extension}`
}

export function downloadSnapshotCsv(input: SnapshotExportInput) {
  const sections = [
    { title: 'Metadata', rows: buildMetadataRows(input) },
    { title: 'Overview', rows: buildOverviewSheet(input) },
    { title: 'Instruments', rows: buildInstrumentsSheet(input) },
    { title: 'Treasury curve', rows: buildTreasurySheet(input) },
    { title: 'Headlines', rows: buildHeadlinesSheet(input) },
    { title: 'Pinned tickers', rows: buildPinnedSheet(input) },
    { title: 'US equity style box', rows: buildUsStyleSheet(input) },
    { title: 'Global equity map', rows: buildGlobalEquitySheet(input) },
  ]

  const csvParts = sections
    .filter((section) => section.rows.length > 0)
    .map((section) => [`# ${section.title}`, sheetRowsToCsv(section.rows)].join('\r\n'))

  const csv = `\uFEFF${csvParts.join('\r\n\r\n')}`
  downloadBlob(buildExportFilename(input, 'csv'), new Blob([csv], { type: 'text/csv;charset=utf-8' }))
}

export async function downloadSnapshotExcel(input: SnapshotExportInput) {
  const { utils, writeFile } = await import('xlsx')

  const workbook = utils.book_new()
  const appendSheet = (name: string, rows: SheetRow[]) => {
    if (rows.length === 0) {
      return
    }

    const sheet = utils.json_to_sheet(rows)
    utils.book_append_sheet(workbook, sheet, name.slice(0, 31))
  }

  appendSheet('Metadata', buildMetadataRows(input))
  appendSheet('Overview', buildOverviewSheet(input))
  appendSheet('Instruments', buildInstrumentsSheet(input))
  appendSheet('Treasury curve', buildTreasurySheet(input))
  appendSheet('Headlines', buildHeadlinesSheet(input))
  appendSheet('Pinned', buildPinnedSheet(input))
  appendSheet('US style box', buildUsStyleSheet(input))
  appendSheet('Global equity', buildGlobalEquitySheet(input))

  if (workbook.SheetNames.length === 0) {
    appendSheet('Metadata', buildMetadataRows(input))
  }

  writeFile(workbook, buildExportFilename(input, 'xlsx'))
}

export async function exportSnapshot(input: SnapshotExportInput, format: 'csv' | 'xlsx') {
  if (format === 'csv') {
    downloadSnapshotCsv(input)
    return
  }

  await downloadSnapshotExcel(input)
}
