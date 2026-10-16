import Plot from 'react-plotly.js'
import { theme } from './chartTheme'

function endLabel(series, key, text, color) {
  const last = series[series.length - 1]
  return {
    x: last.date,
    y: last[key],
    text,
    showarrow: false,
    xanchor: 'left',
    xshift: 6,
    font: { family: theme.font, size: 12, color },
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
          line: { color: theme.value, width: 2 },
          hovertemplate: 'CHF %{y:,.0f}<extra>Portfolio value</extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          name: 'Money paid in',
          x,
          y: series.map((row) => row.invested),
          // Contributions arrive in steps, so draw them as steps.
          line: { color: theme.invested, width: 2, dash: 'dash', shape: 'hv' },
          hovertemplate: 'CHF %{y:,.0f}<extra>Money paid in</extra>',
        },
      ]}
      layout={{
        autosize: true,
        height: 360,
        margin: { l: 72, r: 64, t: 8, b: 40 },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
        font: { family: theme.font, size: 12, color: theme.muted },
        hovermode: 'x unified',
        hoverlabel: { font: { family: theme.font, color: theme.ink }, bgcolor: 'white', bordercolor: theme.hairline },
        showlegend: true,
        legend: { orientation: 'h', x: 0, y: 1.08, font: { color: theme.ink } },
        dragmode: 'pan',
        xaxis: {
          type: 'date',
          showgrid: false,
          showline: true,
          linecolor: theme.hairline,
          hoverformat: '%d %b %Y',
          showspikes: true,
          spikemode: 'across',
          spikethickness: 1,
          spikedash: 'dot',
          spikecolor: theme.muted,
        },
        yaxis: {
          gridcolor: theme.hairline,
          zeroline: false,
          rangemode: 'tozero',
          tickprefix: 'CHF ',
          tickformat: ',.0f',
          fixedrange: true,
        },
        annotations: [
          endLabel(series, 'value', 'Value', theme.ink),
          endLabel(series, 'invested', 'Paid in', theme.ink),
        ],
      }}
      config={{ responsive: true, displaylogo: false, scrollZoom: true }}
      style={{ width: '100%' }}
    />
  )
}

export default BacktestChart
