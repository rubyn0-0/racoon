// The backtest: what a saved portfolio would be worth today. Form, result tiles, holdings table and chart,
// plus an optional plan of what to buy next. How money flows (inflow, investing frequency) is set on the
// portfolio itself in Portfolios.jsx. Defaults, chart sizes and the currency are in settings.js.
import Plot from 'react-plotly.js'
import { useEffect, useState } from 'react'
import { fetchBacktest, fetchPlan } from './api'
import {
  LimitNote,
  OptionButtons,
  baseLayout,
  baseXAxis,
  baseYAxis,
  changeClass,
  chf,
  daysBetween,
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
} from './helpers'
import {
  BACKTEST_HEIGHT,
  BACKTEST_LEGEND_Y,
  BACKTEST_MARGIN_LEFT,
  BACKTEST_MARGIN_RIGHT,
  CHART_FONT_SIZE,
  CURRENCY,
  DAILY_INTERVAL,
  END_LABEL_SHIFT,
  LINE_WIDTH,
  NEVER_INVEST,
  START_BEFORE_END_ERROR,
  theme,
} from './settings'

// The chart of portfolio value against money paid in. With a plan, it reaches into the future and marks
// the planned investing days.
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

function BacktestChart({ series, plan }) {
  const x = series.map((row) => row.date)
  const plannedDays = plan
    ? [...new Set([plan.next_investing_date, ...plan.investments.map((item) => item.date)].filter(Boolean))]
    : []

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
          line: { color: theme.invested, width: LINE_WIDTH, shape: 'hv' },
          hovertemplate: `${CURRENCY} %{y:,.0f}<extra>Money paid in</extra>`,
        },
        // An empty trace so the planned days get a legend entry.
        ...(plan ? [{
          type: 'scatter',
          mode: 'lines',
          name: 'Planned investing day',
          x: [null],
          y: [null],
          line: { color: theme.muted, width: 1, dash: 'dot' },
          hoverinfo: 'skip',
        }] : []),
      ]}
      layout={{
        ...baseLayout,
        height: BACKTEST_HEIGHT,
        margin: margin(BACKTEST_MARGIN_LEFT, BACKTEST_MARGIN_RIGHT),
        showlegend: true,
        legend: legend(BACKTEST_LEGEND_Y),
        xaxis: {
          ...baseXAxis,
          hoverformat: intervalById[DAILY_INTERVAL].hoverFormat,
          ...(plan && { range: [series[0].date, plan.until] }),
        },
        yaxis: {
          ...baseYAxis,
          rangemode: 'tozero',
          tickprefix: `${CURRENCY} `,
          tickformat: ',.0f',
          fixedrange: true,
        },
        shapes: plannedDays.map((day) => ({
          type: 'line',
          xref: 'x',
          x0: day,
          x1: day,
          yref: 'paper',
          y0: 0,
          y1: 1,
          line: { color: theme.muted, width: 1, dash: 'dot' },
        })),
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

// The plan: how close the next investing day is, and what will be bought on each planned day.
function PlanPanel({ plan, firstDate }) {
  if (plan.invest_frequency === NEVER_INVEST) {
    return (
      <div className="plan">
        <h3>Plan</h3>
        <p className="muted">This portfolio keeps its cash ({chf(plan.cash_now)} now), so nothing will be bought.</p>
      </div>
    )
  }

  const from = plan.last_investing_date ?? firstDate
  const span = Math.max(1, daysBetween(from, plan.next_investing_date))
  const elapsed = Math.min(1, Math.max(0, daysBetween(from, plan.as_of) / span))
  const daysLeft = daysBetween(plan.as_of, plan.next_investing_date)

  return (
    <div className="plan">
      <h3>Plan</h3>
      <p className="muted">
        Assumes prices stay at the last close ({displayDate(plan.as_of)}). New dividends are not guessed. Cash on hand now: {chf(plan.cash_now)}.
      </p>

      <div className="plan-next">
        <span>
          Next investing day: <strong>{displayDate(plan.next_investing_date)}</strong>
          {daysLeft <= 0 ? ' (today)' : ` (in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'})`}
        </span>
        <span className="plan-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(elapsed * 100)}>
          <span style={{ width: percent(elapsed) }} />
        </span>
      </div>

      {plan.investments.length === 0 ? (
        <p className="muted">Nothing to buy before {displayDate(plan.until)}.</p>
      ) : (
        <div className="table-scroll">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Buy</th>
                <th scope="col" className="number">Cost</th>
                <th scope="col" className="number">Cash left</th>
              </tr>
            </thead>
            <tbody>
              {plan.investments.map((item) => (
                <tr key={item.date}>
                  <td>{displayDate(item.date)}</td>
                  <td>{item.buys.map((buy) => `${buy.shares} × ${buy.company}`).join(', ')}</td>
                  <td className="number">{chf(item.cash_before - item.cash_after)}</td>
                  <td className="number">{chf(item.cash_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// The panel: settings form, then the result below it.
// The backtest can only start once every holding has prices, and end when the first one stops.
function commonRange(stocks, portfolio) {
  const held = stocks.filter(
    (stock) => stock.start_date && portfolio.holdings.some((holding) => holding.ticker === stock.ticker),
  )
  if (held.length === 0) return { start: '', end: '' }

  return {
    start: held.reduce((latest, stock) => (stock.start_date > latest ? stock.start_date : latest), held[0].start_date),
    end: held.reduce((earliest, stock) => (stock.end_date < earliest ? stock.end_date : earliest), held[0].end_date),
  }
}

function Tile({ label, value, note }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </div>
  )
}

function ShareBar({ summary }) {
  if (summary.gain < 0) {
    return (
      <p className="muted">
        The portfolio is worth {chf(-summary.gain)} less than the money you paid in, so all of its value is your own money.
      </p>
    )
  }

  return (
    <div className="share-split">
      <p className="share-split-title">Where today&apos;s value comes from</p>
      <div className="split-bar" aria-hidden="true">
        <span className="split-own" style={{ width: percent(summary.new_money_share) }} />
        <span className="split-return" style={{ width: percent(summary.returned_share) }} />
      </div>
      <ul className="split-legend">
        <li><span className="swatch own" />Your money {percent(summary.new_money_share)} ({chf(summary.invested)})</li>
        <li><span className="swatch return" />Market return {percent(summary.returned_share)} ({chf(summary.gain)})</li>
      </ul>
    </div>
  )
}

// One sentence on how the money got in, from the portfolio's rules.
function paidInNote(settings) {
  const capital = `${chf(settings.initial_capital)} starting capital`
  const start = settings.start_date ? `${capital} and shares you owned` : capital
  if (!settings.inflow_amount) return start
  return `${start}, then ${chf(settings.inflow_amount)} ${frequencyById[settings.inflow_frequency].per}`
}

function dividendsNote(settings) {
  if (settings.invest_frequency === NEVER_INVEST) return 'Kept as cash'
  return `Collected as cash, invested ${frequencyById[settings.invest_frequency].label.toLowerCase()}`
}

function BacktestResult({ result, plan }) {
  const { summary, settings, holdings, series } = result

  return (
    <div className="backtest-result">
      <div className="hero">
        <span className="tile-label">Value on {displayDate(summary.end_date)}</span>
        <span className="hero-value">{chf(summary.final_value)}</span>
        <span className="hero-delta">
          <span className={changeClass(summary.gain)}>{signedPercent(summary.gain_pct)}</span>
          <span className="muted">on {chf(summary.invested)} paid in since {displayDate(summary.start_date)}</span>
        </span>
      </div>

      <LimitNote limitedBy={result.limited_by} />

      <div className="tiles">
        <Tile label="Paid in" value={chf(summary.invested)} note={paidInNote(settings)} />
        <Tile label="Market return" value={chf(summary.gain)} note="Value minus the money paid in" />
        <Tile label="Dividends" value={chf(summary.dividends)} note={dividendsNote(settings)} />
        <Tile label="Cash waiting" value={chf(summary.cash)} note={`${summary.purchases} shares bought in total`} />
        <Tile label="Largest drop" value={percent(summary.max_drawdown)} note="From a high to the lowest point after it" />
      </div>

      <ShareBar summary={summary} />

      <BacktestChart series={series} plan={plan} />
      {plan && <PlanPanel plan={plan} firstDate={series[0].date} />}

      <div className="table-scroll">
        <table className="holdings-table">
          <caption>Holdings at the end</caption>
          <thead>
            <tr>
              <th scope="col">Stock</th>
              <th scope="col" className="number">Target share</th>
              <th scope="col" className="number">Share today</th>
              <th scope="col" className="number">Value</th>
              <th scope="col" className="number">Shares</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => (
              <tr key={holding.ticker}>
                <td>{holding.company}</td>
                <td className="number">{percent(holding.target_weight)}</td>
                <td className="number">{percent(holding.weight)}</td>
                <td className="number">{chf(holding.value)}</td>
                <td className="number">{holding.shares.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// The backtest panel. Nothing is loaded or run until you press Run backtest; that loads the portfolio's
// stocks first (with a progress message) and then simulates.
function BacktestPanel({ stocks, portfolio, onStocksChanged }) {
  const tickers = portfolio.holdings.map((holding) => holding.ticker)
  const range = commonRange(stocks, portfolio)
  const [settings, setSettings] = useState({ start: '', end: '' })
  // The result together with the settings that produced it, so the plan matches the chart.
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [showPlan, setShowPlan] = useState(false)
  const [planUntil, setPlanUntil] = useState('')
  const [plan, setPlan] = useState(null)
  const [planError, setPlanError] = useState('')

  // The plan follows the result on screen; it is fetched only while the plan is switched on.
  const ranSettings = run?.settings
  useEffect(() => {
    if (!showPlan || !ranSettings) return undefined

    let current = true
    fetchPlan(portfolio.id, { start: ranSettings.start, until: planUntil })
      .then((data) => {
        if (!current) return
        setPlan(data)
        setPlanError('')
      })
      .catch((err) => current && setPlanError(err.message))
    return () => {
      current = false
    }
  }, [showPlan, planUntil, portfolio.id, ranSettings])

  function update(field, value) {
    setSettings((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()

    if (settings.start && settings.end && settings.start > settings.end) {
      setError(START_BEFORE_END_ERROR)
      return
    }

    setRunning(true)
    setError('')
    try {
      await waitForStocks(tickers, setProgress)
      onStocksChanged()
      setRun({ result: await fetchBacktest(portfolio.id, settings), settings })
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const hasStartingPosition = Boolean(portfolio.start_date)
  const loading = progress && progress.done < progress.total
  const buttonText = !running ? 'Run backtest' : loading ? `Loading ${progress.done} of ${progress.total}…` : 'Running…'

  return (
    <section className="panel" aria-label="Backtest">
      <h2>Backtest</h2>
      <p className="muted">
        What {portfolio.name} would be worth today, following its rules: new money and dividends wait as cash and
        are spent on whole shares on the investing days. Nothing is ever sold.
      </p>

      <form className="backtest-form" onSubmit={submit}>
        {!hasStartingPosition && (
          <label className="field">
            From
            <input type="date" value={settings.start} min={range.start || undefined} max={range.end || undefined} onChange={(event) => update('start', event.target.value)} />
          </label>
        )}
        <label className="field">
          To
          <input type="date" value={settings.end} min={range.start || undefined} max={range.end || undefined} onChange={(event) => update('end', event.target.value)} />
        </label>
        <div className="backtest-actions">
          <OptionButtons
            label="Plan"
            options={[{ id: 'plan', label: 'Show plan' }]}
            isActive={() => showPlan}
            onSelect={() => setShowPlan((current) => !current)}
          />
          {showPlan && (
            <label className="field">
              Look ahead to
              <input type="date" value={planUntil} min={range.end || undefined} onChange={(event) => setPlanUntil(event.target.value)} />
            </label>
          )}
          <button type="submit" className="primary" disabled={running}>{buttonText}</button>
        </div>
      </form>

      {!run && !running && !error && (
        <p className="muted">Press Run backtest to load the prices of these stocks and simulate.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {planError && <p className="error" role="alert">{planError}</p>}
      {run && <BacktestResult result={run.result} plan={showPlan ? plan : null} />}
    </section>
  )
}

export default BacktestPanel
