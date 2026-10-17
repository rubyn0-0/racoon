import Plot from 'react-plotly.js'
import {
  BACKTEST_HEIGHT,
  CHART_FONT_SIZE,
  LINE_WIDTH,
  baseLayout,
  baseXAxis,
  baseYAxis,
  legend,
  margin,
  plotConfig,
  plotStyle,
  theme,
} from './chart'
import { CURRENCY, DAILY_INTERVAL, intervalById } from './shared'

const LEGEND_Y = 1.08
const MARGIN_LEFT = 72
const MARGIN_RIGHT = 64
const END_LABEL_SHIFT = 6

function endLabel(series, key, text, color) {
  const last = series[series.length - 1]
  return {
    x: last.date,
    y: last[key],
    text,
    showarrow: false,
    xanchor: 'left',
    xshift: END_LABEL_SHIFT,
    font: { family: theme.font, size: CHART_FONT_SIZE, color },
  }
}

function BacktestChart({ series }) {
  const x = series.map((row) => row.date)

  return (
    <Plot
      data={[
        {
          type: 'scatter',
          mode: 'lines',
          name: 'Portfolio value',
          x,
          y: series.map((row) => row.value),
          line: { color: theme.value, width: LINE_WIDTH },
          hovertemplate: `${CURRENCY} %{y:,.0f}<extra>Portfolio value</extra>`,
        },
        {
          type: 'scatter',
          mode: 'lines',
          name: 'Money paid in',
          x,
          y: series.map((row) => row.invested),
          // Contributions arrive in steps, so draw them as steps.
          line: { color: theme.invested, width: LINE_WIDTH, dash: 'dash', shape: 'hv' },
          hovertemplate: `${CURRENCY} %{y:,.0f}<extra>Money paid in</extra>`,
        },
      ]}
      layout={{
        ...baseLayout,
        height: BACKTEST_HEIGHT,
        margin: margin(MARGIN_LEFT, MARGIN_RIGHT),
        showlegend: true,
        legend: legend(LEGEND_Y),
        xaxis: {
          ...baseXAxis,
          hoverformat: intervalById[DAILY_INTERVAL].hoverFormat,
        },
        yaxis: {
          ...baseYAxis,
          rangemode: 'tozero',
          tickprefix: `${CURRENCY} `,
          tickformat: ',.0f',
          fixedrange: true,
        },
        annotations: [
          endLabel(series, 'value', 'Value', theme.ink),
          endLabel(series, 'invested', 'Paid in', theme.ink),
        ],
      }}
      config={plotConfig}
      style={plotStyle}
    />
  )
}

export default BacktestChart
