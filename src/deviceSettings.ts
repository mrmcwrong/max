export type FontSize = 'small' | 'medium' | 'large' | 'xlarge'
export type ThemeMode = 'dark' | 'light'

export type PinnedTicker = {
  id: string
  symbol: string
  label: string
}

export type DeviceSettings = {
  fontSize: FontSize
  theme: ThemeMode
  accentColor: string
  pinnedTickers: PinnedTicker[]
}

export const FONT_SIZE_PX: Record<FontSize, number> = {
  small: 14,
  medium: 16,
  large: 18,
  xlarge: 20,
}

export const FONT_SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra large' },
]

export const ACCENT_COLORS = [
  { id: 'sky', label: 'Sky', value: '#7dd3fc' },
  { id: 'cyan', label: 'Cyan', value: '#22d3ee' },
  { id: 'emerald', label: 'Emerald', value: '#34d399' },
  { id: 'lime', label: 'Lime', value: '#a3e635' },
  { id: 'amber', label: 'Amber', value: '#fbbf24' },
  { id: 'orange', label: 'Orange', value: '#fb923c' },
  { id: 'rose', label: 'Rose', value: '#fb7185' },
  { id: 'fuchsia', label: 'Fuchsia', value: '#e879f9' },
  { id: 'violet', label: 'Violet', value: '#c4b5fd' },
  { id: 'indigo', label: 'Indigo', value: '#818cf8' },
  { id: 'slate', label: 'Slate', value: '#94a3b8' },
  { id: 'pearl', label: 'Pearl', value: '#e2e8f0' },
] as const

const STORAGE_KEY = 'max:device-settings:v2'
const ACCENT_VALUES = new Set<string>(ACCENT_COLORS.map((color) => color.value))

export const defaultDeviceSettings: DeviceSettings = {
  fontSize: 'medium',
  theme: 'dark',
  accentColor: ACCENT_COLORS[0].value,
  pinnedTickers: [],
}

function isFontSize(value: unknown): value is FontSize {
  return value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge'
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light'
}

function parsePinnedTickers(value: unknown): PinnedTicker[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const tickers: PinnedTicker[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const record = entry as Partial<PinnedTicker>
    const symbol = normalizeTickerSymbol(typeof record.symbol === 'string' ? record.symbol : '')
    if (!symbol || seen.has(symbol)) {
      continue
    }

    seen.add(symbol)
    tickers.push({
      id: typeof record.id === 'string' && record.id ? record.id : `${symbol}-${tickers.length}`,
      symbol,
      label: typeof record.label === 'string' && record.label.trim() ? record.label.trim() : symbol,
    })
  }

  return tickers
}

export function normalizeTickerSymbol(input: string) {
  return input.trim().toUpperCase()
}

export function readDeviceSettings(): DeviceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { ...defaultDeviceSettings, pinnedTickers: [] }
    }

    const parsed = JSON.parse(raw) as Partial<DeviceSettings>
    const accentColor =
      typeof parsed.accentColor === 'string' && ACCENT_VALUES.has(parsed.accentColor)
        ? parsed.accentColor
        : defaultDeviceSettings.accentColor

    return {
      fontSize: isFontSize(parsed.fontSize) ? parsed.fontSize : defaultDeviceSettings.fontSize,
      theme: isThemeMode(parsed.theme) ? parsed.theme : defaultDeviceSettings.theme,
      accentColor,
      pinnedTickers: parsePinnedTickers(parsed.pinnedTickers),
    }
  } catch {
    return { ...defaultDeviceSettings, pinnedTickers: [] }
  }
}

export function writeDeviceSettings(settings: DeviceSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Ignore quota errors and private browsing restrictions.
  }
}

export function clearDeviceSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore storage errors.
  }
}
