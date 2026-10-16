import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPrices } from './api'
import ChartHeader from './ChartHeader'
import { averageWindows, theme } from './chartTheme'
import OptionButtons from './OptionButtons'
import PriceChart from './PriceChart'

const chartTypes = [
  { id: 'candles', label: 'Candles' },
  { id: 'line', label: 'Line' },
]
const priceIntervals = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]
const chartModes = [
  { id: 'free-pan', label: 'Free pan' },
  { id: 'full-range', label: 'Full range' },
  { id: 'fitted', label: 'Fitted' },
]
const averageOptions = averageWindows.map((window) => ({ id: window, label: `MA ${window}` }))
const periods = [
  { id: '1M', label: '1M', months: 1 },
  { id: '3M', label: '3M', months: 3 },
  { id: '6M', label: '6M', months: 6 },
  { id: '1Y', label: '1Y', months: 12 },
  { id: 'YTD', label: 'YTD' },
  { id: '5Y', label: '5Y', months: 60 },
  { id: 'max', label: 'Max' },
]

function periodStart(period, endDate, earliestDate) {
  if (period.id === 'max') return earliestDate
  if (period.id === 'YTD') return `${endDate.slice(0, 4)}-01-01`

  const date = new Date(`${endDate}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() - period.months)
  return date.toISOString().slice(0, 10)
}

function StockExplorer({ stocks }) {
  const initialStock = stocks[0]
  const colorsByTicker = useMemo(
    () => Object.fromEntries(
      stocks.map((stock, index) => [stock.ticker, theme.lines[index % theme.lines.length]]),
    ),
    [stocks],
  )
  const [ticker, setTicker] = useState(initialStock.ticker)
  const [startDate, setStartDate] = useState(initialStock.start_date)
  const [endDate, setEndDate] = useState(initialStock.end_date)
  const [selection, setSelection] = useState({
    startDate: initialStock.start_date,
    endDate: initialStock.end_date,
  })
  const [visibleDateRange, setVisibleDateRange] = useState([
    initialStock.start_date,
    initialStock.end_date,
  ])
  const [chartType, setChartType] = useState('candles')
  const [chartMode, setChartMode] = useState('fitted')
  const [priceInterval, setPriceInterval] = useState('day')
  const [averages, setAverages] = useState([])
  const [showVolume, setShowVolume] = useState(false)
  const [graphTickers, setGraphTickers] = useState([initialStock.ticker])
  const [seriesByKey, setSeriesByKey] = useState({})
  const [error, setError] = useState('')
  const requests = useRef({})

  // Each stock and interval is looked up from the API once, then reused.
  function ensureSeries(nextTicker, interval) {
    const key = `${nextTicker}:${interval}`

    requests.current[key] ??= fetchPrices(nextTicker, interval)
      .then((prices) => {
        setSeriesByKey((current) => ({ ...current, [key]: prices }))
        return prices
      })
      .catch((err) => {
        delete requests.current[key]
        throw err
      })

    return requests.current[key]
  }

  useEffect(() => {
    graphTickers.forEach((graphTicker) => {
      ensureSeries(graphTicker, priceInterval)
        .catch((err) => setError(`Could not load prices: ${err.message}`))
    })
  }, [graphTickers, priceInterval])

  const selectedStock = stocks.find((stock) => stock.ticker === ticker)
  const graphStocks = stocks.filter((stock) => graphTickers.includes(stock.ticker))
  const chartSeries = graphStocks
    .filter((stock) => seriesByKey[`${stock.ticker}:${priceInterval}`])
    .map((stock) => ({ stock, prices: seriesByKey[`${stock.ticker}:${priceInterval}`] }))
  const comparing = graphStocks.length > 1
  const earliestChartDate = graphStocks.reduce(
    (earliest, stock) => stock.start_date < earliest ? stock.start_date : earliest,
    graphStocks[0].start_date,
  )
  const latestChartDate = graphStocks.reduce(
    (latest, stock) => stock.end_date > latest ? stock.end_date : latest,
    graphStocks[0].end_date,
  )
  const revision = {
    x: `${selection.startDate}-${selection.endDate}-${chartMode}-${priceInterval}`,
    y: `${chartMode}-${priceInterval}-${graphTickers.join('-')}`,
  }

  function applyRange(start, end) {
    setStartDate(start)
    setEndDate(end)
    setSelection({ startDate: start, endDate: end })
    setVisibleDateRange([start, end])
    setError('')
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

    // Daily rows answer "is there any trading day in this range", whatever the interval.
    let dailyPrices
    try {
      dailyPrices = await ensureSeries(ticker, 'day')
    } catch (err) {
      setError(`Could not load prices: ${err.message}`)
      return
    }

    if (!dailyPrices.some((price) => price.date >= startDate && price.date <= endDate)) {
      setError('No trading data exists in this date range.')
      return
    }

    setGraphTickers([ticker])
    applyRange(startDate, endDate)
  }

  function choosePeriod(periodId) {
    const period = periods.find((item) => item.id === periodId)
    const start = periodStart(period, latestChartDate, earliestChartDate)
    applyRange(start < earliestChartDate ? earliestChartDate : start, latestChartDate)
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

  function toggleAverage(window) {
    setAverages((current) => (
      current.includes(window)
        ? current.filter((item) => item !== window)
        : [...current, window].sort((a, b) => a - b)
    ))
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
    <>

      <form className="toolbar" onSubmit={loadPrices}>
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
          From
          <input
            type="date"
            value={startDate}
            min={selectedStock.start_date}
            max={selectedStock.end_date}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>

        <label>
          To
          <input
            type="date"
            value={endDate}
            min={selectedStock.start_date}
            max={selectedStock.end_date}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>

        <button type="submit" className="primary">Load chart</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="chart-card" aria-label="Price chart">
        <ChartHeader
          series={chartSeries}
          startDate={selection.startDate}
          endDate={selection.endDate}
        />

        <div className="chart-controls">
          <OptionButtons
            label="Chart type"
            options={chartTypes}
            isActive={(id) => chartType === id}
            onSelect={setChartType}
            disabled={comparing}
          />
          <OptionButtons
            label="Interval"
            options={priceIntervals}
            isActive={(id) => priceInterval === id}
            onSelect={setPriceInterval}
          />
          <OptionButtons
            label="Moving averages"
            options={averageOptions}
            isActive={(id) => averages.includes(id)}
            onSelect={toggleAverage}
            disabled={comparing}
          />
          <OptionButtons
            label="Volume"
            options={[{ id: 'volume', label: 'Volume' }]}
            isActive={() => showVolume}
            onSelect={() => setShowVolume((current) => !current)}
            disabled={comparing}
          />
          <OptionButtons
            label="Price axis"
            options={chartModes}
            isActive={(id) => chartMode === id}
            onSelect={setChartMode}
          />
        </div>

        {comparing && (
          <p className="hint">
            Candles, moving averages and volume work with one stock. Deselect the others to use them.
          </p>
        )}

        <div className="chart-frame">
          {chartSeries.length === 0 ? (
            <p className="chart-loading">Loading prices…</p>
          ) : (
            <PriceChart
              series={chartSeries}
              interval={priceInterval}
              chartType={chartType}
              averages={averages}
              showVolume={showVolume}
              chartMode={chartMode}
              visibleDateRange={visibleDateRange}
              selection={selection}
              earliestDate={earliestChartDate}
              latestDate={latestChartDate}
              revision={revision}
              colorFor={(graphTicker) => colorsByTicker[graphTicker]}
              onRelayout={updateVisibleDateRange}
            />
          )}
        </div>

        <div className="chart-footer">
          <OptionButtons
            label="Period"
            options={periods}
            onSelect={choosePeriod}
          />
          <OptionButtons
            label="Stocks"
            showLabel
            options={stocks.map((stock) => ({ id: stock.ticker, label: stock.company }))}
            isActive={(id) => graphTickers.includes(id)}
            onSelect={toggleGraphStock}
          />
        </div>
      </section>
    </>
  )
}

export default StockExplorer
