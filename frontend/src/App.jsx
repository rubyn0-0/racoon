import { useState } from 'react'
import Plot from 'react-plotly.js'
import stockData from '../../data/six_three_companies.json'
import tickerCsv from '../../config/six_stocks_tickers.csv?raw'
import './App.css'

const stocks = stockData.stocks
const initialStock = stocks[0]
const companyNamesByTicker = Object.fromEntries(
  tickerCsv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((row) => {
      const [, name, , , yahooTicker] = row.split(',')
      return [yahooTicker, name]
    }),
)
const chartModes = [
  { id: 'free-pan', label: 'Free pan' },
  { id: 'full-range', label: 'Full range' },
  { id: 'fitted', label: 'Fitted' },
]
const priceIntervals = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]
const chartColors = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c']
const chartColorsByTicker = Object.fromEntries(
  stocks.map((stock, index) => [stock.ticker, chartColors[index % chartColors.length]]),
)

function getCompanyName(stock) {
  return companyNamesByTicker[stock.ticker] ?? stock.company
}

function getPeriodKey(dateString, interval) {
  if (interval === 'year') return dateString.slice(0, 4)
  if (interval === 'month') return dateString.slice(0, 7)

  const date = new Date(`${dateString}T00:00:00Z`)
  const day = date.getUTCDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  date.setUTCDate(date.getUTCDate() - daysFromMonday)
  return date.toISOString().slice(0, 10)
}

function aggregatePrices(prices, interval) {
  if (interval === 'day') return prices

  const periods = new Map()

  prices.forEach((price) => {
    const key = getPeriodKey(price.date, interval)
    const period = periods.get(key)

    if (!period) {
      periods.set(key, { ...price })
      return
    }

    period.date = price.date
    period.high = Math.max(period.high, price.high)
    period.low = Math.min(period.low, price.low)
    period.close = price.close
    period.adjusted_close = price.adjusted_close
    period.volume += price.volume
    period.dividends += price.dividends
    period.stock_splits += price.stock_splits
  })

  return Array.from(periods.values())
}

function App() {
  const [ticker, setTicker] = useState(initialStock.ticker)
  const [startDate, setStartDate] = useState(initialStock.start_date)
  const [endDate, setEndDate] = useState(initialStock.end_date)
  const [selection, setSelection] = useState({
    ticker: initialStock.ticker,
    startDate: initialStock.start_date,
    endDate: initialStock.end_date,
  })
  const [visibleDateRange, setVisibleDateRange] = useState([
    initialStock.start_date,
    initialStock.end_date,
  ])
  const [chartMode, setChartMode] = useState('full-range')
  const [priceInterval, setPriceInterval] = useState('day')
  const [graphTickers, setGraphTickers] = useState([initialStock.ticker])
  const [error, setError] = useState('')

  const selectedStock = stocks.find((stock) => stock.ticker === ticker)
  const chartStocks = stocks.filter((stock) => graphTickers.includes(stock.ticker))
  const chartSeries = chartStocks.map((stock) => ({
    stock,
    prices: aggregatePrices(stock.prices, priceInterval),
  }))
  const displayedPrices = chartSeries.flatMap((series) => series.prices)
  const visibleStart = new Date(visibleDateRange[0]).getTime()
  const visibleEnd = new Date(visibleDateRange[1]).getTime()
  const pricesInVisibleRange = displayedPrices.filter((price) => {
    const priceDate = new Date(price.date).getTime()
    return priceDate >= visibleStart && priceDate <= visibleEnd
  })
  const adaptivePrices = pricesInVisibleRange.length > 0 ? pricesInVisibleRange : displayedPrices
  const pricesInSelectedPeriod = displayedPrices.filter(
    (price) => price.date >= selection.startDate && price.date <= selection.endDate,
  )
  const selectedPeriodPrices = pricesInSelectedPeriod.length > 0
    ? pricesInSelectedPeriod
    : adaptivePrices
  const selectedMinimumPrice = Math.min(...selectedPeriodPrices.map((price) => price.low))
  const selectedMaximumPrice = Math.max(...selectedPeriodPrices.map((price) => price.high))
  const selectedPadding = Math.max(
    (selectedMaximumPrice - selectedMinimumPrice) * 0.1,
    selectedMaximumPrice * 0.02,
  )
  const minimumPrice = Math.min(...adaptivePrices.map((price) => price.low))
  const maximumPrice = Math.max(...adaptivePrices.map((price) => price.high))
  const maximumYAxisPrice = maximumPrice * 1.1
  const fittedMinimumPrice = Math.max(0, minimumPrice * 0.9)
  const earliestChartDate = chartStocks.reduce(
    (earliest, stock) => stock.start_date < earliest ? stock.start_date : earliest,
    chartStocks[0].start_date,
  )
  const latestChartDate = chartStocks.reduce(
    (latest, stock) => stock.end_date > latest ? stock.end_date : latest,
    chartStocks[0].end_date,
  )

  const xAxisSettings = {
    title: 'Date',
    gridcolor: '#e5e7eb',
    range: visibleDateRange,
    ...(chartMode === 'free-pan'
      ? {}
      : {
          minallowed: earliestChartDate,
          maxallowed: latestChartDate,
        }),
  }

  const yAxisSettings = {
    title: 'Price (CHF)',
    gridcolor: '#e5e7eb',
    ...(chartMode === 'free-pan'
      ? {
          range: [
            Math.max(0, selectedMinimumPrice - selectedPadding),
            selectedMaximumPrice + selectedPadding,
          ],
          fixedrange: false,
        }
      : chartMode === 'full-range'
        ? {
            range: [0, maximumYAxisPrice],
            minallowed: 0,
            maxallowed: maximumYAxisPrice,
            fixedrange: true,
          }
        : {
            range: [fittedMinimumPrice, maximumYAxisPrice],
            minallowed: fittedMinimumPrice,
            maxallowed: maximumYAxisPrice,
            fixedrange: true,
          }),
  }

  function changeCompany(event) {
    const nextTicker = event.target.value
    const nextStock = stocks.find((stock) => stock.ticker === nextTicker)

    setTicker(nextTicker)
    setStartDate(nextStock.start_date)
    setEndDate(nextStock.end_date)
    setError('')
  }

  function loadPrices(event) {
    event.preventDefault()

    if (startDate > endDate) {
      setError('The start date must be before the end date.')
      return
    }

    const pricesInRange = selectedStock.prices.filter(
      (price) => price.date >= startDate && price.date <= endDate,
    )

    if (pricesInRange.length === 0) {
      setError('No trading data exists in this date range.')
      return
    }

    setError('')
    setSelection({ ticker, startDate, endDate })
    setVisibleDateRange([startDate, endDate])
    setGraphTickers([ticker])
  }

  function toggleGraphStock(nextTicker) {
    setGraphTickers((currentTickers) => {
      if (!currentTickers.includes(nextTicker)) {
        return [...currentTickers, nextTicker]
      }

      if (currentTickers.length === 1) {
        return currentTickers
      }

      return currentTickers.filter((currentTicker) => currentTicker !== nextTicker)
    })
  }

  function updateVisibleDateRange(event) {
    const nextStart = event['xaxis.range[0]']
    const nextEnd = event['xaxis.range[1]']

    if (nextStart && nextEnd) {
      setVisibleDateRange([nextStart, nextEnd])
    } else if (event['xaxis.autorange']) {
      setVisibleDateRange([earliestChartDate, latestChartDate])
    }
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
          <select value={ticker} onChange={changeCompany}>
            {stocks.map((stock) => (
              <option key={stock.ticker} value={stock.ticker}>
                {getCompanyName(stock)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Start date
          <input
            type="date"
            value={startDate}
            min={selectedStock.start_date}
            max={selectedStock.end_date}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>

        <label>
          End date
          <input
            type="date"
            value={endDate}
            min={selectedStock.start_date}
            max={selectedStock.end_date}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>

        <button type="submit">Load chart</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="chart-options" aria-label="Chart options">
        <div className="chart-option-group">
          <span>Stocks</span>
          <div className="chart-mode-buttons">
            {stocks.map((stock) => (
              <button
                key={stock.ticker}
                type="button"
                className={graphTickers.includes(stock.ticker) ? 'chart-mode-button active' : 'chart-mode-button'}
                aria-pressed={graphTickers.includes(stock.ticker)}
                onClick={() => toggleGraphStock(stock.ticker)}
              >
                {getCompanyName(stock)}
              </button>
            ))}
          </div>
        </div>

        <div className="chart-option-group">
          <span>Graph view</span>
          <div className="chart-mode-buttons">
            {chartModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={chartMode === mode.id ? 'chart-mode-button active' : 'chart-mode-button'}
                aria-pressed={chartMode === mode.id}
                onClick={() => setChartMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div className="chart-option-group">
          <span>Interval</span>
          <div className="chart-mode-buttons">
            {priceIntervals.map((interval) => (
              <button
                key={interval.id}
                type="button"
                className={priceInterval === interval.id ? 'chart-mode-button active' : 'chart-mode-button'}
                aria-pressed={priceInterval === interval.id}
                onClick={() => setPriceInterval(interval.id)}
              >
                {interval.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="chart-card" aria-label="Stock price chart">
        <div className="chart-heading">
          <div>
            <p className="chart-label">Closing price</p>
            <h2>{chartStocks.map(getCompanyName).join(' · ')}</h2>
          </div>
          <p>{selection.startDate} to {selection.endDate} · {priceInterval} interval</p>
        </div>

        <Plot
          data={chartSeries.map((series) => (
            {
              x: series.prices.map((price) => price.date),
              y: series.prices.map((price) => price.close),
              type: 'scatter',
              mode: 'lines',
              name: getCompanyName(series.stock),
              line: { color: chartColorsByTicker[series.stock.ticker], width: 3 },
              hovertemplate: '%{x}<br>CHF %{y:.2f}<extra>%{fullData.name}</extra>',
            }
          ))}
          layout={{
            autosize: true,
            height: 420,
            margin: { l: 54, r: 24, t: 20, b: 48 },
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            dragmode: 'pan',
            uirevision: `${selection.startDate}-${selection.endDate}-${chartMode}-${priceInterval}`,
            xaxis: {
              ...xAxisSettings,
              uirevision: `${selection.startDate}-${selection.endDate}-${chartMode}-${priceInterval}`,
            },
            yaxis: {
              ...yAxisSettings,
              uirevision: `${chartMode}-${priceInterval}-${graphTickers.join('-')}`,
            },
            showlegend: chartStocks.length > 1,
            legend: { orientation: 'h', x: 0, y: 1.08 },
          }}
          config={{ responsive: true, displaylogo: false, scrollZoom: true }}
          style={{ width: '100%' }}
          onRelayout={updateVisibleDateRange}
        />
      </section>

      <p className="note">Using the local five-year SIX dataset. FastAPI will replace this import later.</p>
    </main>
  )
}

export default App
