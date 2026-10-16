import { useEffect, useMemo, useRef, useState } from 'react'
import Plot from 'react-plotly.js'
import { fetchPrices } from './api'
import { aggregatePrices } from './prices'

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

function OptionButtons({ label, options, isActive, onSelect }) {
  return (
    <div className="chart-option-group">
      <span>{label}</span>
      <div className="chart-mode-buttons">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={isActive(option.id) ? 'chart-mode-button active' : 'chart-mode-button'}
            aria-pressed={isActive(option.id)}
            onClick={() => onSelect(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function StockExplorer({ stocks }) {
  const initialStock = stocks[0]
  const chartColorsByTicker = useMemo(
    () => Object.fromEntries(
      stocks.map((stock, index) => [stock.ticker, chartColors[index % chartColors.length]]),
    ),
    [stocks],
  )
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
  const [pricesByTicker, setPricesByTicker] = useState({})
  const [error, setError] = useState('')
  const requests = useRef({})

  // Each stock's price history is looked up from the API once, then reused.
  function ensurePrices(nextTicker) {
    requests.current[nextTicker] ??= fetchPrices(nextTicker)
      .then((prices) => {
        setPricesByTicker((current) => ({ ...current, [nextTicker]: prices }))
        return prices
      })
      .catch((err) => {
        delete requests.current[nextTicker]
        throw err
      })

    return requests.current[nextTicker]
  }

  useEffect(() => {
    graphTickers.forEach((graphTicker) => {
      ensurePrices(graphTicker).catch((err) => setError(`Could not load prices: ${err.message}`))
    })
  }, [graphTickers])

  const selectedStock = stocks.find((stock) => stock.ticker === ticker)
  const graphStocks = stocks.filter((stock) => graphTickers.includes(stock.ticker))
  const chartSeries = graphStocks
    .filter((stock) => pricesByTicker[stock.ticker])
    .map((stock) => ({
      stock,
      prices: aggregatePrices(pricesByTicker[stock.ticker], priceInterval),
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
  const earliestChartDate = graphStocks.reduce(
    (earliest, stock) => stock.start_date < earliest ? stock.start_date : earliest,
    graphStocks[0].start_date,
  )
  const latestChartDate = graphStocks.reduce(
    (latest, stock) => stock.end_date > latest ? stock.end_date : latest,
    graphStocks[0].end_date,
  )
  const xRevision = `${selection.startDate}-${selection.endDate}-${chartMode}-${priceInterval}`
  const yRevision = `${chartMode}-${priceInterval}-${graphTickers.join('-')}`

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

  async function loadPrices(event) {
    event.preventDefault()

    if (startDate > endDate) {
      setError('The start date must be before the end date.')
      return
    }

    let prices
    try {
      prices = await ensurePrices(ticker)
    } catch (err) {
      setError(`Could not load prices: ${err.message}`)
      return
    }

    if (!prices.some((price) => price.date >= startDate && price.date <= endDate)) {
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
                {stock.company}
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
        <OptionButtons
          label="Stocks"
          options={stocks.map((stock) => ({ id: stock.ticker, label: stock.company }))}
          isActive={(id) => graphTickers.includes(id)}
          onSelect={toggleGraphStock}
        />
        <OptionButtons
          label="Graph view"
          options={chartModes}
          isActive={(id) => chartMode === id}
          onSelect={setChartMode}
        />
        <OptionButtons
          label="Interval"
          options={priceIntervals}
          isActive={(id) => priceInterval === id}
          onSelect={setPriceInterval}
        />
      </section>

      <section className="chart-card" aria-label="Stock price chart">
        <div className="chart-heading">
          <div>
            <p className="chart-label">Closing price</p>
            <h2>{graphStocks.map((stock) => stock.company).join(' · ')}</h2>
          </div>
          <p>{selection.startDate} to {selection.endDate} · {priceInterval} interval</p>
        </div>

        {chartSeries.length === 0 ? (
          <p>Loading prices…</p>
        ) : (
          <Plot
            data={chartSeries.map((series) => (
              {
                x: series.prices.map((price) => price.date),
                y: series.prices.map((price) => price.close),
                type: 'scatter',
                mode: 'lines',
                name: series.stock.company,
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
              uirevision: xRevision,
              xaxis: { ...xAxisSettings, uirevision: xRevision },
              yaxis: { ...yAxisSettings, uirevision: yRevision },
              showlegend: chartSeries.length > 1,
              legend: { orientation: 'h', x: 0, y: 1.08 },
            }}
            config={{ responsive: true, displaylogo: false, scrollZoom: true }}
            style={{ width: '100%' }}
            onRelayout={updateVisibleDateRange}
          />
        )}
      </section>

      <p className="note">Prices are looked up from the database through the FastAPI backend.</p>
    </main>
  )
}

export default StockExplorer
