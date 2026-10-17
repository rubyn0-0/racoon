import Plot from 'react-plotly.js'
import {
  CHART_HEIGHT,
  LINE_WIDTH,
  VOLUME_HEIGHT,
  baseLayout,
  baseXAxis,
  baseYAxis,
  legend,
  margin,
  plotConfig,
  plotStyle,
  theme,
} from './chart'
import {
  CHART_MODE,
  CHART_TYPE,
  CURRENCY,
  DAILY_INTERVAL,
  averageKey,
  averageLabel,
  candleCenter,
  dataBounds,
  dateOnly,
  intervalById,
  periodMs,
  utcMidnight,
} from './shared'

const WICK_WIDTH = 1
const AVERAGE_LINE_WIDTH = 1.75
const VOLUME_OPACITY = 0.45
const PRICE_HOVER = `${CURRENCY} %{y:.2f}<extra>%{fullData.name}</extra>`
const CANDLE_HOVER = [
  'Open %{customdata[0]:.2f}',
  'High %{customdata[1]:.2f}',
  'Low %{customdata[2]:.2f}',
  'Close %{customdata[3]:.2f}',
  '<extra>%{fullData.name}</extra>',
].join('<br>')

// Price axis: headroom above the high / below the low in fitted and full-range modes, and the padding
// free-pan adds around the selected period (a share of its range, but at least a share of its high).
const AXIS_HEADROOM = 0.1
const FREE_PAN_PADDING = 0.1
const FREE_PAN_MIN_PADDING = 0.02

// Volume panel sits under the price panel, with a gap between them (shares of the plot height).
const VOLUME_DOMAIN_TOP = 0.18
const PANEL_GAP = 0.08
const LEGEND_Y = 1.06
const MARGIN_LEFT = 56
const MARGIN_RIGHT = 16

const xOf = candleCenter

function finite(values) {
  return values.filter((value) => Number.isFinite(value))
}

// Weekdays with no trading row (holidays), so the axis can skip them like weekends.
function closedWeekdays(prices) {
  const tradingDays = new Set(prices.map((price) => price.date))
  const sorted = [...tradingDays].sort()
  const closed = []

  if (sorted.length === 0) return closed

  const day = utcMidnight(sorted[0])
  const last = utcMidnight(sorted[sorted.length - 1])

  for (; day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay()
    const date = dateOnly(day.toISOString())

    if (weekday !== 0 && weekday !== 6 && !tradingDays.has(date)) closed.push(date)
  }

  return closed
}

const isUp = (price) => price.close >= price.open
const directionColor = (price) => (isUp(price) ? theme.up : theme.down)

function wickTrace(prices, color) {
  const x = prices.flatMap((price) => [xOf(price), xOf(price), null])
  const y = prices.flatMap((price) => [price.low, price.high, null])

  return {
    type: 'scatter',
    mode: 'lines',
    x,
    y,
    line: { color, width: WICK_WIDTH },
    showlegend: false,
    hoverinfo: 'skip',
  }
}

// A candle is a body (bar from open to close) plus a wick (line from low to high), split by direction for color.
// Drawn the same way for every interval, so the spacing never depends on the data.
function candleTraces({ stock, prices }, interval) {
  const risingPrices = prices.filter(isUp)
  const fallingPrices = prices.filter((price) => !isUp(price))

  const bodies = {
    type: 'bar',
    name: stock.company,
    x: prices.map(xOf),
    base: prices.map((price) => price.open),
    y: prices.map((price) => price.close - price.open),
    width: prices.map((price) => periodMs(price, interval)),
    marker: { color: prices.map(directionColor), line: { width: 0 } },
    customdata: prices.map((price) => [price.open, price.high, price.low, price.close]),
    hovertemplate: CANDLE_HOVER,
  }

  return [wickTrace(risingPrices, theme.up), wickTrace(fallingPrices, theme.down), bodies]
}

function lineTrace({ stock, prices }) {
  return {
    type: 'scatter',
    mode: 'lines',
    name: stock.company,
    x: prices.map(xOf),
    y: prices.map((price) => price.close),
    line: { color: theme.line, width: LINE_WIDTH },
    hovertemplate: PRICE_HOVER,
  }
}

function priceTraces(item, { candles, interval }) {
  return candles ? candleTraces(item, interval) : [lineTrace(item)]
}

function averageTraces({ prices }, windows) {
  return windows.map((window) => ({
    type: 'scatter',
    mode: 'lines',
    name: averageLabel(window),
    x: prices.map(xOf),
    y: prices.map((price) => price[averageKey(window)]),
    line: { color: theme.averages[window], width: AVERAGE_LINE_WIDTH, shape: 'linear' },
    connectgaps: false,
    hovertemplate: PRICE_HOVER,
  }))
}

function volumeTrace({ prices }, interval) {
  return {
    type: 'bar',
    name: 'Volume',
    yaxis: 'y2',
    x: prices.map(xOf),
    y: prices.map((price) => price.volume),
    width: prices.map((price) => periodMs(price, interval)),
    marker: { color: prices.map(directionColor), opacity: VOLUME_OPACITY },
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
  onRelayout,
}) {
  const daily = interval === DAILY_INTERVAL
  const candles = chartType === CHART_TYPE.CANDLES
  const volume = showVolume
  const displayedPrices = series.prices
  const { hoverFormat } = intervalById[interval]
  const [dataStart, dataEnd] = dataBounds(displayedPrices, interval)
  // A range that starts (or ends) at the first (last) trading day would cut that candle in half.
  const range = [
    dateOnly(visibleDateRange[0]) <= earliestDate ? dataStart : visibleDateRange[0],
    dateOnly(visibleDateRange[1]) >= latestDate ? dataEnd : visibleDateRange[1],
  ]

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
    (selectedMaximumPrice - selectedMinimumPrice) * FREE_PAN_PADDING,
    selectedMaximumPrice * FREE_PAN_MIN_PADDING,
  )
  const minimumPrice = Math.min(...finite(adaptivePrices.map((price) => price.low)))
  const maximumPrice = Math.max(...finite(adaptivePrices.map((price) => price.high)))
  const maximumYAxisPrice = maximumPrice * (1 + AXIS_HEADROOM)
  const fittedMinimumPrice = Math.max(0, minimumPrice * (1 - AXIS_HEADROOM))

  const yAxisRange = chartMode === CHART_MODE.FREE_PAN
    ? {
        range: [
          Math.max(0, selectedMinimumPrice - selectedPadding),
          selectedMaximumPrice + selectedPadding,
        ],
        fixedrange: false,
      }
    : chartMode === CHART_MODE.FULL_RANGE
      ? { range: [0, maximumYAxisPrice], minallowed: 0, maxallowed: maximumYAxisPrice, fixedrange: true }
      : {
          range: [fittedMinimumPrice, maximumYAxisPrice],
          minallowed: fittedMinimumPrice,
          maxallowed: maximumYAxisPrice,
          fixedrange: true,
        }

  const data = [
    ...priceTraces(series, { candles, interval }),
    ...averageTraces(series, averages),
    ...(volume ? [volumeTrace(series, interval)] : []),
  ]

  return (
    <Plot
      // Plotly does not reliably remove rangebreaks on an update, so day and aggregated views get separate plots.
      key={daily ? 'daily' : 'aggregated'}
      data={data}
      layout={{
        ...baseLayout,
        height: volume ? CHART_HEIGHT + VOLUME_HEIGHT : CHART_HEIGHT,
        margin: margin(MARGIN_LEFT, MARGIN_RIGHT),
        // Bar widths are set per period (periodMs), so Plotly's own bar gap must not shrink them.
        barmode: 'overlay',
        bargap: 0,
        uirevision: revision.x,
        showlegend: data.filter((trace) => trace.showlegend !== false).length > 1,
        legend: legend(LEGEND_Y),
        xaxis: {
          ...baseXAxis,
          range,
          rangeslider: { visible: false },
          // Daily rows only exist on trading days; hide weekends and holidays instead of drawing gaps.
          ...(daily && {
            rangebreaks: [{ bounds: ['sat', 'mon'] }, { values: closedWeekdays(displayedPrices) }],
          }),
          spikesnap: 'cursor',
          hoverformat: hoverFormat,
          anchor: volume ? 'y2' : 'y',
          uirevision: revision.x,
          ...(chartMode === CHART_MODE.FREE_PAN ? {} : { minallowed: dataStart, maxallowed: dataEnd }),
        },
        yaxis: {
          ...baseYAxis,
          ...yAxisRange,
          domain: volume ? [VOLUME_DOMAIN_TOP + PANEL_GAP, 1] : [0, 1],
          uirevision: revision.y,
        },
        ...(volume && {
          yaxis2: {
            domain: [0, VOLUME_DOMAIN_TOP],
            showgrid: false,
            zeroline: false,
            fixedrange: true,
            tickformat: '~s',
          },
        }),
      }}
      config={plotConfig}
      style={plotStyle}
      onRelayout={onRelayout}
    />
  )
}

export default PriceChart
