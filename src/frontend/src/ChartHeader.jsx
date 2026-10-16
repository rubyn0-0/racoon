const priceFormat = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function periodReadout(prices, startDate, endDate) {
  const inRange = prices.filter(
    (price) => price.date >= startDate && price.date <= endDate && price.close != null,
  )

  if (inRange.length === 0) return null

  const first = inRange[0].close
  const last = inRange[inRange.length - 1].close
  return { last, change: (last / first - 1) * 100 }
}

function Change({ change }) {
  const sign = change >= 0 ? '+' : '−'
  return (
    <span className={change >= 0 ? 'change up' : 'change down'}>
      {sign}{Math.abs(change).toFixed(1)}%
    </span>
  )
}

function ChartHeader({ series, startDate, endDate }) {
  const readouts = series.map(({ stock, prices }) => ({
    stock,
    readout: periodReadout(prices, startDate, endDate),
  }))

  if (readouts.length === 1) {
    const { stock, readout } = readouts[0]

    return (
      <div className="chart-header">
        <h2>{stock.company}</h2>
        {readout && (
          <p className="readout">
            <strong>CHF {priceFormat.format(readout.last)}</strong>
            <Change change={readout.change} />
            <span className="muted">since {startDate}</span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="chart-header">
      <h2>Comparing closing prices</h2>
      <ul className="readouts">
        {readouts.map(({ stock, readout }) => (
          <li key={stock.ticker}>
            <span>{stock.company}</span>
            {readout && <strong>{priceFormat.format(readout.last)}</strong>}
            {readout && <Change change={readout.change} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ChartHeader
