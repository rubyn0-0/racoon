// Where the app starts: loads the stock list, shows the tabs, and puts the chosen screen below them.
// The screens are Explorer.jsx and Portfolios.jsx. Everything you can tweak is in settings.js.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/hanken-grotesk'
import './styles.css'
import { fetchStocks } from './api'
import Explorer from './Explorer'
import { applyThemeVariables } from './helpers'
import Portfolios from './Portfolios'
import { DEFAULT_VIEW, VIEWS } from './settings'

function App() {
  const [stocks, setStocks] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState(DEFAULT_VIEW)

  useEffect(() => {
    fetchStocks()
      .then((data) => {
        if (data.length === 0) throw new Error('No stocks in the database. Run the ingest first.')
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
    content = <Portfolios stocks={stocks} />
  } else {
    content = <Explorer stocks={stocks} />
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
      {content}
    </main>
  )
}

applyThemeVariables()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
