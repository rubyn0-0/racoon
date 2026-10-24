// Where the app starts: applies the theme and mounts App.jsx into the page.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/hanken-grotesk'
import './styles.css'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import { applyThemeVariables } from './helpers'

applyThemeVariables()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
