import { useEffect, useState } from 'react'
import { fetchStocks } from './api'
import StockExplorer from './StockExplorer'
import './App.css'

function App() {
  const [stocks, setStocks] = useState(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    fetchStocks()
      .then((data) => {
        if (data.length === 0) throw new Error('No stocks in the database. Run the ingest first.')
        setStocks(data)
      })
      .catch((err) => setLoadError(err.message))
  }, [])

  if (loadError) {
    return (
      <main className="app">
        <p className="error" role="alert">Could not load stock data: {loadError}</p>
      </main>
    )
  }

  if (!stocks) {
    return (
      <main className="app">
        <p>Loading stock data…</p>
      </main>
    )
  }

  return <StockExplorer stocks={stocks} />
}

export default App
