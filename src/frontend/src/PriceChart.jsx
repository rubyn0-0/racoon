import Plot from 'react-plotly.js'
import { theme } from './chartTheme'

// Aggregated candles sit in the middle of their period (`center` from the API); daily ones on their date.
const xOf = (price) => price.center ?? price.date
const hoverFormats = { day: '%d %b %Y', week: 'Week %V, %Y', month: '%b %Y', year: '%Y' }
const halfPeriodDays = { day: 0.5, week: 3.5, month: 16, year: 183 }

function finite(values) {
  return values.filter((value) => Number.isFinite(value))
}

function shiftDays(dateString, days) {
  const date = new Date(`${dateString.slice(0, 10)}T00:00:00Z`)
  date.setTime(date.getTime() + days * 86400000)
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

// Weekdays with no trading row in any series (holidays), so the axis can skip them like weekends.
function closedWeekdays(series) {
  const tradingDays = new Set(series.flatMap((item) => item.prices.map((price) => price.date)))
  const sorted = [...tradingDays].sort()
  const closed = []

  if (sorted.length === 0) return closed

  const day = new Date(`${sorted[0]}T00:00:00Z`)
  const last = new Date(`${sorted[sorted.length - 1]}T00:00:00Z`)

  for (; day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay()
    const date = day.toISOString().slice(0, 10)

    if (weekday !== 0 && weekday !== 6 && !tradingDays.has(date)) closed.push(date)
  }

  return closed
}

function priceTraces({ stock, prices }, { candles, color }) {
  const x = prices.map(xOf)

  if (candles) {
    return {
      type: 'candlestick',
      name: stock.company,
      x,
      open: prices.map((price) => price.open),
      high: prices.map((price) => price.high),
      low: prices.map((price) => price.low),
      close: prices.map((price) => price.close),
      increasing: { line: { color: theme.upEdge, width: 1 }, fillcolor: theme.up },
      decreasing: { line: { color: theme.downEdge, width: 1 }, fillcolor: theme.down },
    }
  }

  return {
    type: 'scatter',
    mode: 'lines',
    name: stock.company,
    x,
    y: prices.map((price) => price.close),
    line: { color, width: 2 },
    hovertemplate: 'CHF %{y:.2f}<extra>%{fullData.name}</extra>',
  }
}

function averageTraces({ prices }, windows) {
  return windows.map((window) => ({
    type: 'scatter',
    mode: 'lines',
    name: `MA ${window}`,
    x: prices.map(xOf),
    y: prices.map((price) => price[`ma${window}`]),
    line: { color: theme.averages[window], width: 1.5, dash: 'dash' },
    hovertemplate: 'CHF %{y:.2f}<extra>%{fullData.name}</extra>',
  }))
}

function volumeTrace({ prices }) {
  return {
    type: 'bar',
    name: 'Volume',
    yaxis: 'y2',
    x: prices.map(xOf),
    y: prices.map((price) => price.volume),
    marker: {
      color: prices.map((price) => (price.close >= price.open ? theme.up : theme.down)),
      opacity: 0.45,
    },
    hovertemplate: '%{y:,.0f}<extra>Volume</extra>',
  }
}

function PriceChart({
  series,
  interval,
  chartType,
  averages,
  showVolume,
  chartMode,
  visibleDateRange,
  selection,
  earliestDate,
  latestDate,
  revision,
  colorFor,
  onRelayout,
}) {
  const daily = interval === 'day'
  const single = series.length === 1
  const candles = single && chartType === 'candles'
  const volume = single && showVolume

  const displayedPrices = series.flatMap((item) => item.prices)
  const pricesInVisibleRange = displayedPrices.filter(
    (price) => price.date >= visibleDateRange[0] && price.date <= visibleDateRange[1],
  )
  const adaptivePrices = pricesInVisibleRange.length > 0 ? pricesInVisibleRange : displayedPrices
  const pricesInSelectedPeriod = displayedPrices.filter(
    (price) => price.date >= selection.startDate && price.date <= selection.endDate,
  )
  const selectedPeriodPrices = pricesInSelectedPeriod.length > 0
    ? pricesInSelectedPeriod
    : adaptivePrices
  const selectedMinimumPrice = Math.min(...finite(selectedPeriodPrices.map((price) => price.low)))
  const selectedMaximumPrice = Math.max(...finite(selectedPeriodPrices.map((price) => price.high)))
  const selectedPadding = Math.max(
    (selectedMaximumPrice - selectedMinimumPrice) * 0.1,
    selectedMaximumPrice * 0.02,
  )
  const minimumPrice = Math.min(...finite(adaptivePrices.map((price) => price.low)))
  const maximumPrice = Math.max(...finite(adaptivePrices.map((price) => price.high)))
  const maximumYAxisPrice = maximumPrice * 1.1
  const fittedMinimumPrice = Math.max(0, minimumPrice * 0.9)

  const yAxisRange = chartMode === 'free-pan'
    ? {
        range: [
          Math.max(0, selectedMinimumPrice - selectedPadding),
          selectedMaximumPrice + selectedPadding,
        ],
        fixedrange: false,
      }
    : chartMode === 'full-range'
      ? { range: [0, maximumYAxisPrice], minallowed: 0, maxallowed: maximumYAxisPrice, fixedrange: true }
      : {
          range: [fittedMinimumPrice, maximumYAxisPrice],
          minallowed: fittedMinimumPrice,
          maxallowed: maximumYAxisPrice,
          fixedrange: true,
        }

  const data = [
    ...series.map((item) => priceTraces(item, { candles, color: colorFor(item.stock.ticker) })),
    ...(single ? averageTraces(series[0], averages) : []),
    ...(volume ? [volumeTrace(series[0])] : []),
  ]

  return (
    <Plot
      // Plotly does not reliably remove rangebreaks on an update, so day and aggregated views get separate plots.
      key={daily ? 'daily' : 'aggregated'}
      data={data}
      layout={{
        autosize: true,
        height: volume ? 540 : 440,
        margin: { l: 56, r: 16, t: 8, b: 40 },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
        font: { family: theme.font, size: 12, color: theme.muted },
        dragmode: 'pan',
        // Candles are drawn as boxes: keep only a hairline between them (Plotly default is 0.3).
        boxgap: 0.03,
        bargap: 0.03,
        hovermode: 'x unified',
        hoverlabel: { font: { family: theme.font, color: theme.ink }, bgcolor: 'white', bordercolor: theme.hairline },
        uirevision: revision.x,
        showlegend: data.length > 1,
        legend: { orientation: 'h', x: 0, y: 1.06, font: { color: theme.ink } },
        xaxis: {
          type: 'date',
          range: visibleDateRange,
          rangeslider: { visible: false },
          // Daily rows only exist on trading days; hide weekends and holidays instead of drawing gaps.
          ...(daily && {
            rangebreaks: [{ bounds: ['sat', 'mon'] }, { values: closedWeekdays(series) }],
          }),
          showgrid: false,
          showline: true,
          linecolor: theme.hairline,
          showspikes: true,
          spikemode: 'across',
          spikesnap: 'cursor',
          spikethickness: 1,
          spikedash: 'dot',
          spikecolor: theme.muted,
          hoverformat: hoverFormats[interval],
          anchor: volume ? 'y2' : 'y',
          uirevision: revision.x,
          // Half a period of room on each side so the first and last centred candles are not cut off.
          ...(chartMode === 'free-pan' ? {} : {
            minallowed: shiftDays(earliestDate, -halfPeriodDays[interval]),
            maxallowed: shiftDays(latestDate, halfPeriodDays[interval]),
          }),
        },
        yaxis: {
          ...yAxisRange,
          domain: volume ? [0.26, 1] : [0, 1],
          gridcolor: theme.hairline,
          zeroline: false,
          uirevision: revision.y,
        },
        ...(volume && {
          yaxis2: {
            domain: [0, 0.18],
            showgrid: false,
            zeroline: false,
            fixedrange: true,
            tickformat: '~s',
          },
        }),
      }}
      config={{ responsive: true, displaylogo: false, scrollZoom: true }}
      style={{ width: '100%' }}
      onRelayout={onRelayout}
    />
  )
}

export default PriceChart
