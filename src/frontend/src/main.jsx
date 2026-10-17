import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/hanken-grotesk'
import './index.css'
import App from './App.jsx'
import { CHART_HEIGHT, applyThemeVariables } from './chart'

applyThemeVariables({ 'chart-height': `${CHART_HEIGHT}px` })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
