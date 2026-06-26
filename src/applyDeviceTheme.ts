import { ACCENT_COLORS, FONT_SIZE_PX, type DeviceSettings } from './deviceSettings'

export function applyDeviceTheme(settings: DeviceSettings) {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.accent = ACCENT_COLORS.find((color) => color.value === settings.accentColor)?.id ?? 'custom'
  root.style.fontSize = `${FONT_SIZE_PX[settings.fontSize]}px`
  root.style.setProperty('--accent', settings.accentColor)
  root.style.colorScheme = settings.theme
}
