import { useState } from 'react'
import Plot from 'react-plotly.js'
import './App.css'

const companies = [
  { name: 'Apple Inc.', ticker: 'AAPL' },
  { name: 'ABB Ltd', ticker: 'ABBN.SW' },
  { name: 'Nestlé SA', ticker: 'NESN.SW' },
]

// Temporary mock data. FastAPI will later return this same shape.
const samplePrices = [
  { date: '2025-01-02', close: 243.85 },
  { date: '2025-01-03', close: 243.36 },
  { date: '2025-01-06', close: 245.0 },
  { date: '2025-01-07', close: 242.21 },
  { date: '2025-01-08', close: 242.7 },
  { date: '2025-01-10', close: 236.85 },
  { date: '2025-01-13', close: 234.4 },
]

function App() {
  const [ticker, setTicker] = useState('AAPL')
  const [startDate, setStartDate] = useState('2025-01-01')
  const [endDate, setEndDate] = useState('2025-01-31')
  const [loadedTicker, setLoadedTicker] = useState('AAPL')

  function loadPrices(event) {
    event.preventDefault()
    setLoadedTicker(ticker)
  }

  return (
    <main className="app">
      <header>
        <p className="eyebrow">RACOON</p>
        <h1>Stock explorer</h1>
        <p className="subtitle">Select a company and a period to view its price history.</p>
      </header>

      <form className="controls" onSubmit={loadPrices}>
        <label>
          Company
          <select value={ticker} onChange={(event) => setTicker(event.target.value)}>
            {companies.map((company) => (
              <option key={company.ticker} value={company.ticker}>
                {company.name} ({company.ticker})
              </option>
            ))}
          </select>
        </label>

        <label>
          Start date
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>

        <label>
          End date
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>

        <button type="submit">Load chart</button>
      </form>

      <section className="chart-card" aria-label="Stock price chart">
        <div className="chart-heading">
          <div>
            <p className="chart-label">Closing price</p>
            <h2>{loadedTicker}</h2>
          </div>
          <p>{startDate} to {endDate}</p>
        </div>

        <Plot
          data={[
            {
              x: samplePrices.map((price) => price.date),
              y: samplePrices.map((price) => price.close),
              type: 'scatter',
              mode: 'lines',
              line: { color: '#2563eb', width: 3 },
              hovertemplate: '%{x}<br>$%{y:.2f}<extra></extra>',
            },
          ]}
          layout={{
            autosize: true,
            height: 420,
            margin: { l: 54, r: 24, t: 20, b: 48 },
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            xaxis: { title: 'Date', gridcolor: '#e5e7eb' },
            yaxis: { title: 'Price (USD)', gridcolor: '#e5e7eb' },
            showlegend: false,
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: '100%' }}
        />
      </section>

      <p className="note">Currently showing temporary sample data. FastAPI will replace it later.</p>
    </main>
  )
}

export default App
