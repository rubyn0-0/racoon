import { useEffect, useState } from 'react'
import { fetchBacktest } from './api'
import BacktestChart from './BacktestChart'
import {
  BACKTEST_DEFAULTS,
  BACKTEST_STEPS,
  CURRENCY,
  START_BEFORE_END_ERROR,
  changeClass,
  chf,
  percent,
  signedPercent,
} from './shared'

// The backtest can only start once every holding has prices, and end when the first one stops.
function commonRange(stocks, portfolio) {
  const held = stocks.filter((stock) => portfolio.holdings.some((holding) => holding.ticker === stock.ticker))
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

function BacktestResult({ result }) {
  const { summary, settings, holdings, series } = result
  const paidIn = settings.monthly > 0
    ? `${chf(settings.initial)} start, then ${chf(settings.monthly)} a month`
    : 'One payment at the start'

  return (
    <div className="backtest-result">
      <div className="hero">
        <span className="tile-label">Value on {summary.end_date}</span>
        <span className="hero-value">{chf(summary.final_value)}</span>
        <span className="hero-delta">
          <span className={changeClass(summary.gain)}>{signedPercent(summary.gain_pct)}</span>
          <span className="muted">on {chf(summary.invested)} paid in since {summary.start_date}</span>
        </span>
      </div>

      <div className="tiles">
        <Tile label="Paid in" value={chf(summary.invested)} note={paidIn} />
        <Tile label="Market return" value={chf(summary.gain)} note="Value minus the money paid in" />
        <Tile
          label="Dividends"
          value={chf(summary.dividends)}
          note={settings.reinvest ? 'Reinvested in the same stock' : `Kept as cash, ${chf(summary.cash)} in the value`}
        />
        <Tile label="Largest drop" value={percent(summary.max_drawdown)} note="From a high to the lowest point after it" />
      </div>

      <ShareBar summary={summary} />

      <BacktestChart series={series} />

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
                <td className="number">{holding.shares.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BacktestPanel({ stocks, portfolio }) {
  const [defaults] = useState(() => ({
    ...commonRange(stocks, portfolio),
    ...BACKTEST_DEFAULTS,
  }))
  const [settings, setSettings] = useState(defaults)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(true)

  // Run once with the defaults so a saved portfolio shows results straight away.
  useEffect(() => {
    let current = true
    fetchBacktest(portfolio.id, defaults)
      .then((data) => current && setResult(data))
      .catch((err) => current && setError(err.message))
      .finally(() => current && setRunning(false))
    return () => {
      current = false
    }
  }, [portfolio.id, defaults])

  function update(field, value) {
    setSettings((current) => ({ ...current, [field]: value }))
  }

  async function run(event) {
    event.preventDefault()

    if (settings.start > settings.end) {
      setError(START_BEFORE_END_ERROR)
      return
    }

    setRunning(true)
    setError('')
    try {
      setResult(await fetchBacktest(portfolio.id, settings))
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="panel" aria-label="Backtest">
      <h2>Backtest</h2>
      <p className="muted">
        What {portfolio.name} would be worth today: buy on the first day, add the monthly amount on the
        first trading day of each month, never sell.
      </p>

      <form className="backtest-form" onSubmit={run}>
        <label className="field">
          From
          <input type="date" value={settings.start} min={defaults.start} max={defaults.end} onChange={(event) => update('start', event.target.value)} />
        </label>
        <label className="field">
          To
          <input type="date" value={settings.end} min={defaults.start} max={defaults.end} onChange={(event) => update('end', event.target.value)} />
        </label>
        <label className="field">
          Starting amount ({CURRENCY})
          <input type="number" min="0" step={BACKTEST_STEPS.initial} value={settings.initial} onChange={(event) => update('initial', event.target.value)} />
        </label>
        <label className="field">
          Monthly amount ({CURRENCY})
          <input type="number" min="0" step={BACKTEST_STEPS.monthly} value={settings.monthly} onChange={(event) => update('monthly', event.target.value)} />
        </label>
        <div className="backtest-actions">
          <label className="check">
            <input type="checkbox" checked={settings.reinvest} onChange={(event) => update('reinvest', event.target.checked)} />
            Reinvest dividends
          </label>
          <button type="submit" className="primary" disabled={running}>
            {running ? 'Running…' : 'Run backtest'}
          </button>
        </div>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {result && <BacktestResult result={result} />}
    </section>
  )
}

export default BacktestPanel
