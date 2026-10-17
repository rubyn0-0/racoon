// The price explorer screen: pick a stock and dates, then read the chart.
// Chart controls and state live here; the chart itself is drawn in PriceChart.jsx.
// Button labels, defaults and period buttons are in settings.js.
import { useEffect, useRef, useState } from 'react'
import { fetchPrices } from './api'
import {
  AVERAGE_OPTIONS,
  OptionButtons,
  changeClass,
  dataBounds,
  dateOnly,
  periodLabel,
  price,
  signedPercent,
  utcMidnight,
} from './helpers'
import PriceChart from './PriceChart'
import {
  CHART_MODE,
  CHART_MODES,
  CHART_TYPES,
  CURRENCY,
  DAILY_INTERVAL,
  DEFAULT_CHART_MODE,
  DEFAULT_CHART_TYPE,
  DEFAULT_INTERVAL,
  INTERVALS,
  PERIODS,
  START_BEFORE_END_ERROR,
  TODAY_LABEL,
} from './settings'

// The heading above the chart: stock name, latest price and change over the dates on screen.
// The dates come from the chart, so the numbers follow zooming.
function periodReadout(prices, startDate, endDate) {
  // The visible range can be a Plotly axis string with a time, so compare whole days.
  const firstDay = dateOnly(startDate)
  const lastDay = dateOnly(endDate)
  const inRange = prices.filter(
    (row) => row.date >= firstDay && row.date <= lastDay && row.close != null,
  )

  if (inRange.length === 0) return null

  const first = inRange[0]
  const last = inRange[inRange.length - 1]
  return { price: last.close, change: last.close / first.close - 1, first, last }
}

// 'from Week 3, 2024 to Week 42, 2026 (today)': the first and last candle on screen, named by the chosen interval.
function rangeLabel(readout, interval, reachesLatest) {
  const from = periodLabel(readout.first, interval)
  if (!reachesLatest) return `from ${from} to ${periodLabel(readout.last, interval)}`
  if (interval === DAILY_INTERVAL) return `from ${from} to ${TODAY_LABEL}`
  return `from ${from} to ${periodLabel(readout.last, interval)} (${TODAY_LABEL})`
}

function PriceHeader({ series, interval, startDate, endDate, latestDate }) {
  if (!series) return <div className="chart-header" />

  const { stock, prices } = series
  const readout = periodReadout(prices, startDate, endDate)

  return (
    <div className="chart-header">
      <h2>{stock.company}</h2>
      {readout && (
        <p className="readout">
          <strong>{CURRENCY} {price(readout.price)}</strong>
          <span className={changeClass(readout.change)}>{signedPercent(readout.change)}</span>
          <span className="muted">
            {rangeLabel(readout, interval, dateOnly(endDate) >= latestDate)}
          </span>
        </p>
      )}
    </div>
  )
}


// The screen itself: form, chart controls, chart and period buttons.
function periodStart(period, endDate, earliestDate) {
  if (period.id === 'max') return earliestDate
  if (period.id === 'YTD') return `${endDate.slice(0, 4)}-01-01`

  const date = utcMidnight(endDate)
  date.setUTCMonth(date.getUTCMonth() - period.months)
  return dateOnly(date.toISOString())
}

function Explorer({ stocks }) {
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
    const period = PERIODS.find((item) => item.id === periodId)
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
        <PriceHeader
          series={chartSeries}
          interval={priceInterval}
          startDate={visibleDateRange[0]}
          endDate={visibleDateRange[1]}
          latestDate={latestChartDate}
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
            options={PERIODS}
            onSelect={choosePeriod}
          />
        </div>
      </section>
    </>
  )
}

export default Explorer
