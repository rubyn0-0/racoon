import { useEffect, useRef, useState } from 'react'
import { fetchPrices } from './api'
import ChartHeader from './ChartHeader'
import {
  AVERAGE_OPTIONS,
  CHART_MODE,
  CHART_MODES,
  CHART_TYPES,
  DAILY_INTERVAL,
  DEFAULT_CHART_MODE,
  DEFAULT_CHART_TYPE,
  DEFAULT_INTERVAL,
  INTERVALS,
  START_BEFORE_END_ERROR,
  dataBounds,
  dateOnly,
  utcMidnight,
} from './shared'
import OptionButtons from './OptionButtons'
import PriceChart from './PriceChart'

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

  const date = utcMidnight(endDate)
  date.setUTCMonth(date.getUTCMonth() - period.months)
  return dateOnly(date.toISOString())
}

function StockExplorer({ stocks }) {
  const initialStock = stocks[0]
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
  const [chartType, setChartType] = useState(DEFAULT_CHART_TYPE)
  const [chartMode, setChartMode] = useState(DEFAULT_CHART_MODE)
  const [priceInterval, setPriceInterval] = useState(DEFAULT_INTERVAL)
  const [averages, setAverages] = useState([])
  const [showVolume, setShowVolume] = useState(false)
  // The form edits `ticker`; the chart only switches to it on Load chart.
  const [chartTicker, setChartTicker] = useState(initialStock.ticker)
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
    ensureSeries(chartTicker, priceInterval)
      .catch((err) => setError(`Could not load prices: ${err.message}`))
  }, [chartTicker, priceInterval])

  const selectedStock = stocks.find((stock) => stock.ticker === ticker)
  const chartStock = stocks.find((stock) => stock.ticker === chartTicker)
  const chartPrices = seriesByKey[`${chartTicker}:${priceInterval}`]
  const chartSeries = chartPrices ? { stock: chartStock, prices: chartPrices } : null
  const earliestChartDate = chartStock.start_date
  const latestChartDate = chartStock.end_date
  const revision = {
    x: `${selection.startDate}-${selection.endDate}-${chartMode}-${priceInterval}`,
    y: `${chartMode}-${priceInterval}-${chartTicker}`,
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
      setError(START_BEFORE_END_ERROR)
      return
    }

    // Daily rows answer "is there any trading day in this range", whatever the interval.
    let dailyPrices
    try {
      dailyPrices = await ensureSeries(ticker, DAILY_INTERVAL)
    } catch (err) {
      setError(`Could not load prices: ${err.message}`)
      return
    }

    if (!dailyPrices.some((price) => price.date >= startDate && price.date <= endDate)) {
      setError('No trading data exists in this date range.')
      return
    }

    setChartTicker(ticker)
    applyRange(startDate, endDate)
  }

  function choosePeriod(periodId) {
    const period = periods.find((item) => item.id === periodId)
    const start = periodStart(period, latestChartDate, earliestChartDate)
    applyRange(start < earliestChartDate ? earliestChartDate : start, latestChartDate)
  }

  function toggleAverage(window) {
    setAverages((current) => (
      current.includes(window)
        ? current.filter((item) => item !== window)
        : [...current, window].sort((a, b) => a - b)
    ))
  }

  // Outside free-pan the chart cannot go past the data (to the edges of the first and last candle, as on the axis). Zooming out
  // past that must stop there; storing the overshoot would make the chart snap back on the next render.
  function clampToData([start, end]) {
    if (chartMode === CHART_MODE.FREE_PAN) return [start, end]

    if (!chartPrices) return [start, end]

    const [lowest, highest] = dataBounds(chartPrices, priceInterval)
    return [start < lowest ? lowest : start, end > highest ? highest : end]
  }

  function updateVisibleDateRange(event) {
    const nextStart = event['xaxis.range[0]']
    const nextEnd = event['xaxis.range[1]']

    if (nextStart && nextEnd) {
      setVisibleDateRange(clampToData([nextStart, nextEnd]))
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
          startDate={visibleDateRange[0]}
          endDate={visibleDateRange[1]}
        />

        <div className="chart-controls">
          <OptionButtons
            label="Chart type"
            options={CHART_TYPES}
            isActive={(id) => chartType === id}
            onSelect={setChartType}
          />
          <OptionButtons
            label="Interval"
            options={INTERVALS}
            isActive={(id) => priceInterval === id}
            onSelect={setPriceInterval}
          />
          <OptionButtons
            label="Moving averages"
            options={AVERAGE_OPTIONS}
            isActive={(id) => averages.includes(id)}
            onSelect={toggleAverage}
          />
          <OptionButtons
            label="Volume"
            options={[{ id: 'volume', label: 'Volume' }]}
            isActive={() => showVolume}
            onSelect={() => setShowVolume((current) => !current)}
          />
          <OptionButtons
            label="Price axis"
            options={CHART_MODES}
            isActive={(id) => chartMode === id}
            onSelect={setChartMode}
          />
        </div>

        <div className="chart-frame">
          {!chartSeries ? (
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
        </div>
      </section>
    </>
  )
}

export default StockExplorer
