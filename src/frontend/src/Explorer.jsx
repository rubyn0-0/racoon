// The price explorer screen: pick a stock and dates, then read the chart.
// Chart controls and state live here; the chart itself is drawn in PriceChart.jsx.
// Button labels, defaults and period buttons are in settings.js.
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPrices } from './api'
import {
  AVERAGE_OPTIONS,
  LoadingNote,
  OptionButtons,
  StockSearch,
  changeClass,
  commitInputOnEnter,
  dataBounds,
  dateOnly,
  periodLabel,
  price,
  signedPercent,
  useStockData,
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


// The screen itself: search, form, chart controls, chart and period buttons.
function periodStart(period, endDate, earliestDate) {
  if (period.id === 'max') return earliestDate
  if (period.id === 'YTD') return `${endDate.slice(0, 4)}-01-01`

  const date = utcMidnight(endDate)
  date.setUTCMonth(date.getUTCMonth() - period.months)
  return dateOnly(date.toISOString())
}

function Explorer({ stocks, onStocksChanged }) {
  // Nothing is chosen and nothing is loaded until you search for a stock and press Load chart.
  // The form edits `ticker` and its dates; the chart only switches to them on Load chart.
  const [ticker, setTicker] = useState('')
  const [formStart, setFormStart] = useState(null) // null = the first day of the chosen stock
  const [formEnd, setFormEnd] = useState(null) // null = the last day
  const [chartTicker, setChartTicker] = useState('')
  // Dates chosen with the form or a period button, and a zoom made on the chart. null = the whole history.
  const [applied, setApplied] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [chartType, setChartType] = useState(DEFAULT_CHART_TYPE)
  const [chartMode, setChartMode] = useState(DEFAULT_CHART_MODE)
  const [priceInterval, setPriceInterval] = useState(DEFAULT_INTERVAL)
  const [averages, setAverages] = useState([])
  const [showVolume, setShowVolume] = useState(false)
  const [seriesByKey, setSeriesByKey] = useState({})
  const [dataVersion, setDataVersion] = useState(0)
  const [error, setError] = useState('')
  const requests = useRef({})

  // The backend loads a stock's history the first time it is asked for it; this waits for that.
  const data = useStockData(chartTicker ? [chartTicker] : [], handleDataChanged)

  // New or refreshed prices arrived: forget the cached series and refresh what we know about the stocks.
  function handleDataChanged() {
    requests.current = {}
    setSeriesByKey({})
    setDataVersion((version) => version + 1)
    onStocksChanged()
  }

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

  const selectedStock = stocks.find((stock) => stock.ticker === ticker)
  const chartStock = stocks.find((stock) => stock.ticker === chartTicker)
  const dataReady = Boolean(chartStock) && data.ready && chartStock.loaded

  useEffect(() => {
    if (!dataReady) return
    ensureSeries(chartTicker, priceInterval)
      .catch((err) => setError(`Could not load prices: ${err.message}`))
  }, [dataReady, chartTicker, priceInterval, dataVersion])

  const startDate = formStart ?? selectedStock?.start_date ?? ''
  const endDate = formEnd ?? selectedStock?.end_date ?? ''
  const earliestChartDate = chartStock?.start_date
  const latestChartDate = chartStock?.end_date
  const selection = {
    startDate: applied?.startDate || earliestChartDate,
    endDate: applied?.endDate || latestChartDate,
  }
  const visibleDateRange = useMemo(
    () => zoom ?? [selection.startDate, selection.endDate],
    [zoom, selection.startDate, selection.endDate],
  )
  const chartPrices = seriesByKey[`${chartTicker}:${priceInterval}`]
  const chartSeries = dataReady && chartPrices ? { stock: chartStock, prices: chartPrices } : null
  const emptyRange = chartSeries && !chartPrices.some(
    (row) => row.date >= selection.startDate && row.date <= selection.endDate,
  )
  const revision = {
    x: `${selection.startDate}-${selection.endDate}-${chartMode}-${priceInterval}`,
    y: `${chartMode}-${priceInterval}-${chartTicker}`,
  }

  function applyRange(start, end) {
    setApplied({ startDate: start, endDate: end })
    setZoom(null)
    setFormStart(start)
    setFormEnd(end)
    setError('')
  }

  function changeCompany(nextTicker) {
    setTicker(nextTicker)
    setFormStart(null)
    setFormEnd(null)
    setError('')
  }

  function loadPrices(event) {
    event.preventDefault()

    if (!ticker) return

    if (startDate && endDate && startDate > endDate) {
      setError(START_BEFORE_END_ERROR)
      return
    }

    setChartTicker(ticker)
    setApplied(formStart || formEnd ? { startDate, endDate } : null)
    setZoom(null)
    setError('')
  }

  function choosePeriod(periodId) {
    if (!dataReady) return

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
      setZoom(clampToData([nextStart, nextEnd]))
    } else if (event['xaxis.autorange']) {
      setZoom([earliestChartDate, latestChartDate])
    }
  }

  return (
    <>
      <form className="toolbar" onSubmit={loadPrices} onKeyDown={commitInputOnEnter}>
        <StockSearch label="Company" stocks={stocks} value={ticker} onSelect={changeCompany} />

        <label>
          From
          <input
            type="date"
            value={startDate}
            min={selectedStock?.start_date ?? undefined}
            max={selectedStock?.end_date ?? undefined}
            onChange={(event) => setFormStart(event.target.value)}
          />
        </label>

        <label>
          To
          <input
            type="date"
            value={endDate}
            min={selectedStock?.start_date ?? undefined}
            max={selectedStock?.end_date ?? undefined}
            onChange={(event) => setFormEnd(event.target.value)}
          />
        </label>

        <button type="submit" className="primary" disabled={!ticker}>Load chart</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {emptyRange && <p className="error" role="alert">No trading data exists in this date range.</p>}

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
          {!chartTicker && <p className="chart-loading">Search for a stock, then press Load chart.</p>}
          {chartTicker && !dataReady && <LoadingNote data={data} what={`${chartStock.company} prices`} />}
          {dataReady && !chartSeries && <p className="chart-loading">Loading prices…</p>}
          {chartSeries && (
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
