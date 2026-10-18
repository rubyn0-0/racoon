// The compare screen: run several saved portfolios on the same days with the same money and see which does best.
// Each portfolio keeps its own stocks, weighting and investing frequency; the starting amount and the new money
// are shared. Colors, limits and defaults are in settings.js.
import Plot from 'react-plotly.js'
import { useState } from 'react'
import { fetchCompare } from './api'
import {
  LimitNote,
  OptionButtons,
  baseLayout,
  baseXAxis,
  baseYAxis,
  changeClass,
  chf,
  commitInputOnEnter,
  displayDate,
  frequencyById,
  intervalById,
  legend,
  margin,
  percent,
  plotConfig,
  plotStyle,
  signedPercent,
  waitForStocks,
  weightingById,
} from './helpers'
import {
  BACKTEST_HEIGHT,
  BACKTEST_LEGEND_Y,
  BACKTEST_MARGIN_LEFT,
  BACKTEST_MARGIN_RIGHT,
  CAPITAL_STEP,
  COMPARE_DEFAULTS,
  CURRENCY,
  DAILY_INTERVAL,
  INFLOW_FREQUENCIES,
  INFLOW_STEP,
  LINE_WIDTH,
  MAX_COMPARE,
  MIN_COMPARE,
  START_BEFORE_END_ERROR,
  theme,
} from './settings'

// Portfolio value over time, one line per portfolio, and the money paid in (the same for everyone).
function CompareChart({ result }) {
  return (
    <Plot
      data={[
        ...result.portfolios.map((portfolio, index) => ({
          type: 'scatter',
          mode: 'lines',
          name: portfolio.name,
          x: result.dates,
          y: portfolio.values,
          line: { color: theme.compare[index % theme.compare.length], width: LINE_WIDTH },
          hovertemplate: `${CURRENCY} %{y:,.0f}<extra>${portfolio.name}</extra>`,
        })),
        {
          type: 'scatter',
          mode: 'lines',
          name: 'Money paid in',
          x: result.dates,
          y: result.invested,
          line: { color: theme.muted, width: LINE_WIDTH, shape: 'hv' },
          hovertemplate: `${CURRENCY} %{y:,.0f}<extra>Money paid in</extra>`,
        },
      ]}
      layout={{
        ...baseLayout,
        height: BACKTEST_HEIGHT,
        margin: margin(BACKTEST_MARGIN_LEFT, BACKTEST_MARGIN_RIGHT),
        showlegend: true,
        legend: legend(BACKTEST_LEGEND_Y),
        xaxis: { ...baseXAxis, hoverformat: intervalById[DAILY_INTERVAL].hoverFormat },
        yaxis: {
          ...baseYAxis,
          rangemode: 'tozero',
          tickprefix: `${CURRENCY} `,
          tickformat: ',.0f',
          fixedrange: true,
        },
      }}
      config={plotConfig}
      style={plotStyle}
    />
  )
}

// One row per portfolio, best final value first.
function CompareTable({ result }) {
  const ranked = [...result.portfolios].sort((a, b) => b.summary.final_value - a.summary.final_value)
  const best = ranked[0].summary.final_value

  return (
    <div className="table-scroll">
      <table className="holdings-table">
        <caption>Results from {displayDate(result.start_date)} to {displayDate(result.end_date)}</caption>
        <thead>
          <tr>
            <th scope="col">Portfolio</th>
            <th scope="col">Invests</th>
            <th scope="col" className="number">Final value</th>
            <th scope="col" className="number">Gain</th>
            <th scope="col" className="number">Behind the best</th>
            <th scope="col" className="number">Largest drop</th>
            <th scope="col" className="number">Dividends</th>
            <th scope="col" className="number">Cash waiting</th>
            <th scope="col" className="number">Shares bought</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((portfolio, index) => (
            <tr key={portfolio.id}>
              <td>
                <strong>{portfolio.name}</strong>
                {index === 0 && <span className="badge">Best</span>}
                <span className="muted"> {weightingById[portfolio.weighting].name}</span>
              </td>
              <td>{frequencyById[portfolio.invest_frequency].label}</td>
              <td className="number">{chf(portfolio.summary.final_value)}</td>
              <td className="number">
                <span className={changeClass(portfolio.summary.gain)}>{signedPercent(portfolio.summary.gain_pct)}</span>
              </td>
              <td className="number">{index === 0 ? '–' : chf(portfolio.summary.final_value - best)}</td>
              <td className="number">{percent(portfolio.summary.max_drawdown)}</td>
              <td className="number">{chf(portfolio.summary.dividends)}</td>
              <td className="number">{chf(portfolio.summary.cash)}</td>
              <td className="number">{portfolio.summary.purchases}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The date range every stock of the chosen portfolios has prices for.
function commonRange(stocks, portfolios) {
  const tickers = new Set(portfolios.flatMap((portfolio) => portfolio.holdings
    .filter((holding) => holding.selected !== false)
    .map((holding) => holding.ticker)))
  const held = stocks.filter((stock) => tickers.has(stock.ticker) && stock.start_date)
  if (held.length === 0) return { start: '', end: '' }

  return {
    start: held.reduce((latest, stock) => (stock.start_date > latest ? stock.start_date : latest), held[0].start_date),
    end: held.reduce((earliest, stock) => (stock.end_date < earliest ? stock.end_date : earliest), held[0].end_date),
  }
}

function Compare({ portfolios, stocks, onStocksChanged }) {
  const [selected, setSelected] = useState(() => portfolios.slice(0, MIN_COMPARE).map((portfolio) => portfolio.id))
  const [settings, setSettings] = useState({ start: '', end: '', ...COMPARE_DEFAULTS })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)

  const chosen = portfolios.filter((portfolio) => selected.includes(portfolio.id))

  if (portfolios.length < MIN_COMPARE) {
    return (
      <section className="panel" aria-label="Compare portfolios">
        <h2>Compare portfolios</h2>
        <p className="muted">Save at least {MIN_COMPARE} portfolios to compare them.</p>
      </section>
    )
  }

  const range = commonRange(stocks, chosen)

  function update(field, value) {
    setSettings((current) => ({ ...current, [field]: value }))
  }

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function run(event) {
    event.preventDefault()

    if (settings.start && settings.end && settings.start > settings.end) {
      setError(START_BEFORE_END_ERROR)
      return
    }

    setRunning(true)
    setError('')
    try {
      // Nothing is loaded before this press: the stocks of every chosen portfolio are fetched now.
      await waitForStocks(
        [...new Set(chosen.flatMap((portfolio) => portfolio.holdings
          .filter((holding) => holding.selected !== false)
          .map((holding) => holding.ticker)))],
        setProgress,
      )
      onStocksChanged()
      setResult(await fetchCompare(selected, settings))
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <section className="panel" aria-label="Compare portfolios">
      <h2>Compare portfolios</h2>
      <p className="muted">
        Every portfolio starts on the same day with the same money. Each keeps its own stocks, weighting and investing
        frequency. Starting positions and each portfolio&apos;s own new-money plan are ignored here, so the difference you
        see comes from the strategy.
      </p>

      <form className="portfolio-form" onSubmit={run} onKeyDown={commitInputOnEnter}>
        <fieldset className="rules">
          <legend>Portfolios ({MIN_COMPARE} to {MAX_COMPARE})</legend>
          {portfolios.map((portfolio) => (
            <label key={portfolio.id} className="check">
              <input
                type="checkbox"
                checked={selected.includes(portfolio.id)}
                disabled={!selected.includes(portfolio.id) && selected.length >= MAX_COMPARE}
                onChange={() => toggle(portfolio.id)}
              />
              {portfolio.name}
              <span className="muted"> {weightingById[portfolio.weighting].name}</span>
            </label>
          ))}
        </fieldset>

        <div className="field-row">
          <label className="field">
            From
            <input type="date" value={settings.start} min={range.start} max={range.end} onChange={(event) => update('start', event.target.value)} />
          </label>
          <label className="field">
            To
            <input type="date" value={settings.end} min={range.start} max={range.end} onChange={(event) => update('end', event.target.value)} />
          </label>
          <label className="field">
            Starting amount ({CURRENCY})
            <input type="number" min="0" step={CAPITAL_STEP} value={settings.initial} onChange={(event) => update('initial', event.target.value)} />
          </label>
          <label className="field">
            New money per period ({CURRENCY})
            <input type="number" min="0" step={INFLOW_STEP} value={settings.inflow} onChange={(event) => update('inflow', event.target.value)} />
          </label>
          <div className="field">
            <OptionButtons
              label="New money arrives"
              showLabel
              options={INFLOW_FREQUENCIES}
              isActive={(id) => settings.inflowFrequency === id}
              onSelect={(id) => update('inflowFrequency', id)}
            />
          </div>
        </div>
        <p className="muted">Leave the dates empty to use the longest range all chosen portfolios have prices for.</p>

        <div className="form-actions">
          <button type="submit" className="primary" disabled={running || selected.length < MIN_COMPARE}>
            {!running ? 'Run comparison' : progress && progress.done < progress.total ? `Loading ${progress.done} of ${progress.total}…` : 'Running…'}
          </button>
          {selected.length < MIN_COMPARE && <span className="muted">Pick at least {MIN_COMPARE} portfolios.</span>}
        </div>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <div className="backtest-result">
          <LimitNote limitedBy={result.limited_by} />
          <CompareChart result={result} />
          <CompareTable result={result} />
        </div>
      )}
    </section>
  )
}

export default Compare
