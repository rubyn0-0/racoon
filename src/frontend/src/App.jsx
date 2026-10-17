import { useEffect, useState } from 'react'
import { fetchStocks } from './api'
import PortfolioPage from './PortfolioPage'
import StockExplorer from './StockExplorer'
import './App.css'

const views = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'portfolios', label: 'Portfolios' },
]

function App() {
  const [stocks, setStocks] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState('explorer')

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
    content = <PortfolioPage stocks={stocks} />
  } else {
    content = <StockExplorer stocks={stocks} />
  }

  return (
    <main className="app">
      <header className="app-header">
        <span className="wordmark">Racoon</span>
        <nav className="tabs" aria-label="Sections">
          {views.map((item) => (
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

export default App
