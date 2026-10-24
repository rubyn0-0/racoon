// The app shell: loads the stock list, shows the tabs, and puts the chosen screen below them.
// The screens are Explorer.jsx and Portfolios.jsx. Everything you can tweak is in settings.js.
import { lazy, useEffect, useState } from 'react'
import { fetchStocks } from './api'
import { ScreenBoundary } from './ErrorBoundary'
import TestLoader from './TestLoader'
import { DEFAULT_VIEW, VIEWS } from './settings'

// The two screens load on demand, so the charting code stays out of the first download.
const Explorer = lazy(() => import('./Explorer'))
const Portfolios = lazy(() => import('./Portfolios'))

// Shown while running npm run dev; set VITE_DEV_TOOLS=0 in src/frontend/.env to hide. The button also needs DEV_TOOLS=1 in the backend .env.
const DEV_TOOLS = import.meta.env.DEV && import.meta.env.VITE_DEV_TOOLS !== '0'

export default function App() {
  const [stocks, setStocks] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState(DEFAULT_VIEW)

  // Prices load on demand, so the list changes (dates, sizes) as stocks get loaded; screens call this to re-read it.
  function refreshStocks() {
    fetchStocks().then(setStocks).catch((err) => setLoadError(err.message))
  }

  useEffect(() => {
    fetchStocks()
      .then((data) => {
        if (data.length === 0) throw new Error('The stock list is empty. Check data/six_stocks_tickers.csv.')
        setStocks(data)
      })
      .catch((err) => setLoadError(err.message))
  }, [])

  let content
  if (loadError) {
    content = <p className="error" role="alert">Could not load stock data: {loadError}</p>
  } else if (!stocks) {
    content = <p className="muted">Loading stock data…</p>
  } else if (view === 'portfolios') {
    content = <Portfolios stocks={stocks} onStocksChanged={refreshStocks} />
  } else {
    content = <Explorer stocks={stocks} onStocksChanged={refreshStocks} />
  }

  return (
    <main className="app">
      <header className="app-header">
        <span className="wordmark">Racoon</span>
        <nav className="tabs" aria-label="Sections">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'tab active' : 'tab'}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      {/* Dev tool: red button that loads every stock, with a table of what is really stored */}
      {DEV_TOOLS && stocks && <TestLoader stocks={stocks} onStocksChanged={refreshStocks} />}
      <ScreenBoundary key={view}>{content}</ScreenBoundary>
    </main>
  )
}
