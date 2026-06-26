import { useState, type CSSProperties } from 'react'
import {
  ACCENT_COLORS,
  FONT_SIZE_OPTIONS,
  normalizeTickerSymbol,
  type DeviceSettings,
  type FontSize,
  type PinnedTicker,
  type ThemeMode,
} from './deviceSettings'

type SettingsPageProps = {
  settings: DeviceSettings
  onSettingsChange: (patch: Partial<DeviceSettings>) => void
  onAddPinnedTicker: (symbol: string, label: string) => void
  onRemovePinnedTicker: (id: string) => void
  onReset: () => void
  onBack: () => void
}

export default function SettingsPage({
  settings,
  onSettingsChange,
  onAddPinnedTicker,
  onRemovePinnedTicker,
  onReset,
  onBack,
}: SettingsPageProps) {
  const [symbolDraft, setSymbolDraft] = useState('')
  const [labelDraft, setLabelDraft] = useState('')
  const [pinError, setPinError] = useState('')

  const handleAddPin = () => {
    const symbol = normalizeTickerSymbol(symbolDraft)
    if (!symbol) {
      setPinError('Enter a ticker symbol.')
      return
    }

    if (settings.pinnedTickers.some((ticker) => ticker.symbol === symbol)) {
      setPinError('That symbol is already pinned.')
      return
    }

    onAddPinnedTicker(symbol, labelDraft.trim() || symbol)
    setSymbolDraft('')
    setLabelDraft('')
    setPinError('')
  }

  return (
    <main className="page-shell">
      <header className="settings-page__header">
        <button type="button" className="back-button" onClick={onBack}>
          ← Back to dashboard
        </button>
        <div className="settings-page__title-row">
          <div>
            <p className="eyebrow">Preferences</p>
            <h1>Settings</h1>
            <p className="hero-text">
              Appearance and pinned tickers for this browser. Changes save automatically on this device — no account
              required.
            </p>
          </div>
          <button type="button" className="settings-page__reset" onClick={onReset}>
            Reset defaults
          </button>
        </div>
      </header>

      <section className="settings-page__grid">
        <article className="settings-card">
          <header className="settings-card__header">
            <p className="eyebrow">Display</p>
            <h2>Font size</h2>
            <p className="settings-card__lede">Scales text across the dashboard.</p>
          </header>

          <div className="settings-field">
            <span className="settings-field__label">Text size</span>
            <div className="segmented" role="group" aria-label="Font size">
              {FONT_SIZE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`segmented__button ${settings.fontSize === option.value ? 'is-active' : ''}`}
                  onClick={() => onSettingsChange({ fontSize: option.value as FontSize })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </article>

        <article className="settings-card">
          <header className="settings-card__header">
            <p className="eyebrow">Appearance</p>
            <h2>Theme</h2>
            <p className="settings-card__lede">Switch between dark and light mode.</p>
          </header>

          <div className="settings-field">
            <span className="settings-field__label">Color mode</span>
            <div className="segmented" role="group" aria-label="Color mode">
              <button
                type="button"
                className={`segmented__button ${settings.theme === 'dark' ? 'is-active' : ''}`}
                onClick={() => onSettingsChange({ theme: 'dark' as ThemeMode })}
              >
                Dark
              </button>
              <button
                type="button"
                className={`segmented__button ${settings.theme === 'light' ? 'is-active' : ''}`}
                onClick={() => onSettingsChange({ theme: 'light' as ThemeMode })}
              >
                Light
              </button>
            </div>
          </div>
        </article>

        <article className="settings-card">
          <header className="settings-card__header">
            <p className="eyebrow">Accent</p>
            <h2>Accent color</h2>
            <p className="settings-card__lede">Highlights, links, and active controls across MAX.</p>
          </header>

          <div className="settings-field">
            <span className="settings-field__label">Pick a color</span>
            <div className="settings-color-grid" role="listbox" aria-label="Accent color">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  role="option"
                  aria-selected={settings.accentColor === color.value}
                  className={`settings-color-swatch ${settings.accentColor === color.value ? 'is-active' : ''}`}
                  style={{ '--swatch-color': color.value } as CSSProperties}
                  title={color.label}
                  onClick={() => onSettingsChange({ accentColor: color.value })}
                >
                  <span className="settings-color-swatch__label">{color.label}</span>
                </button>
              ))}
            </div>
          </div>
        </article>

        <article className="settings-card">
          <header className="settings-card__header">
            <p className="eyebrow">Watchlist</p>
            <h2>Pinned tickers</h2>
            <p className="settings-card__lede">
              Add any Yahoo Finance symbol (e.g. AAPL, ^GSPC, BTC-USD). Pinned quotes appear at the top of the
              dashboard.
            </p>
          </header>

          <div className="settings-pin-form">
            <label className="settings-field" htmlFor="pinSymbol">
              <span className="settings-field__label">Symbol</span>
              <input
                id="pinSymbol"
                type="text"
                value={symbolDraft}
                placeholder="e.g. NVDA"
                spellCheck={false}
                autoCapitalize="characters"
                onChange={(event) => {
                  setSymbolDraft(event.target.value)
                  setPinError('')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleAddPin()
                  }
                }}
              />
            </label>

            <label className="settings-field" htmlFor="pinLabel">
              <span className="settings-field__label">Label (optional)</span>
              <input
                id="pinLabel"
                type="text"
                value={labelDraft}
                placeholder="Display name"
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleAddPin()
                  }
                }}
              />
            </label>

            <button type="button" className="settings-pin-form__add" onClick={handleAddPin}>
              Pin ticker
            </button>
          </div>

          {pinError ? <p className="settings-field__error">{pinError}</p> : null}

          {settings.pinnedTickers.length > 0 ? (
            <ul className="settings-pin-list">
              {settings.pinnedTickers.map((ticker: PinnedTicker) => (
                <li key={ticker.id} className="settings-pin-item">
                  <div>
                    <strong>{ticker.label}</strong>
                    <span>{ticker.symbol}</span>
                  </div>
                  <button type="button" onClick={() => onRemovePinnedTicker(ticker.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-field__hint">No pinned tickers yet.</p>
          )}
        </article>

        <article className="settings-card settings-card--note">
          <p className="settings-card__note">
            Settings are stored in this browser&apos;s local storage. They stay on this device and are not synced to an
            account or server.
          </p>
        </article>
      </section>
    </main>
  )
}
