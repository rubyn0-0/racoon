import { CURRENCY, changeClass, dateOnly, price, signedPercent } from './shared'

// Price and change over the dates on screen; the range comes from the chart, so it follows zooming.
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
  return { last: last.close, change: last.close / first.close - 1, since: first.date }
}

function ChartHeader({ series, startDate, endDate }) {
  if (!series) return <div className="chart-header" />

  const { stock, prices } = series
  const readout = periodReadout(prices, startDate, endDate)

  return (
    <div className="chart-header">
      <h2>{stock.company}</h2>
      {readout && (
        <p className="readout">
          <strong>{CURRENCY} {price(readout.last)}</strong>
          <span className={changeClass(readout.change)}>{signedPercent(readout.change)}</span>
          <span className="muted">since {readout.since}</span>
        </p>
      )}
    </div>
  )
}

export default ChartHeader
