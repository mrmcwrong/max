import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyDeviceTheme } from './applyDeviceTheme'
import { readDeviceSettings } from './deviceSettings'
import './index.css'
import App from './App.tsx'

applyDeviceTheme(readDeviceSettings())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
