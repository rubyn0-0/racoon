// The backtest: what a saved portfolio would be worth today. Form, result tiles, holdings table and chart,
// plus an optional plan of what to buy next. How money flows (inflow, investing frequency) is set on the
// portfolio itself in Portfolios.jsx. Defaults, chart sizes and the currency are in settings.js.
import Plot from './Plot'
import { useEffect, useRef, useState } from 'react'
import { fetchBacktest, fetchPlan } from './api'
import {
  EditableDateField,
  LimitNote,
  OptionButtons,
  baseLayout,
  baseXAxis,
  baseYAxis,
  changeClass,
  chartFont,
  chf,
  commitInputOnEnter,
  dateOnly,
  daysBetween,
  displayDate,
  editableDateValue,
  frequencyById,
  intervalById,
  legend,
  margin,
  percent,
  parseEditableDate,
  plotConfig,
  plotStyle,
  signedPercent,
  waitForStocks,
} from './helpers'
import {
  AXIS_HEADROOM,
  BACKTEST_HEIGHT,
  BACKTEST_LEGEND_Y,
  BACKTEST_MARGIN_LEFT,
  BACKTEST_MARGIN_RIGHT,
  BACKTEST_HIGHLIGHT_OPACITY,
  BACKTEST_PAID_FILL_OPACITY,
  BACKTEST_RETURN_FILL_OPACITY,
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
    font: { ...chartFont, color },
  }
}

function BacktestChart({ series, plan, feature, summary }) {
  const x = series.map((row) => row.date)
  const dataStart = series[0].date
  const dataEnd = series[series.length - 1].date
  const chartEnd = plan?.until ?? dataEnd
  const [visibleRange, setVisibleRange] = useState([dataStart, chartEnd])
  const plannedDays = plan?.next_investing_date ? [plan.next_investing_date] : []
  const paidIn = series.map((row) => row.invested)
  const startingValue = series.map(() => summary.initial_invested)
  const paidInTraces = feature === 'paid-in' ? [
    {
      type: 'scatter', mode: 'lines', x, y: series.map(() => 0),
      line: { width: 0 }, hoverinfo: 'skip', showlegend: false,
    },
    {
      type: 'scatter', mode: 'lines', x, y: startingValue,
      line: { width: 0 }, fill: 'tonexty', fillcolor: theme.invested, opacity: BACKTEST_PAID_FILL_OPACITY,
      hoverinfo: 'skip', showlegend: false,
    },
    {
      type: 'scatter', mode: 'lines', x, y: startingValue,
      line: { width: 0 }, hoverinfo: 'skip', showlegend: false,
    },
    {
      type: 'scatter', mode: 'lines', x, y: paidIn,
      line: { width: 0 }, fill: 'tonexty', fillcolor: theme.periodic, opacity: BACKTEST_PAID_FILL_OPACITY,
      hoverinfo: 'skip', showlegend: false,
    },
  ] : []
  const marketReturnTraces = feature === 'market-return' ? [
    {
      type: 'scatter', mode: 'lines', x, y: paidIn,
      line: { width: 0 }, hoverinfo: 'skip', showlegend: false,
    },
    {
      type: 'scatter', mode: 'lines', x,
      y: series.map((row) => Math.max(row.value, row.invested)),
      line: { width: 0 }, fill: 'tonexty', fillcolor: theme.up, opacity: BACKTEST_RETURN_FILL_OPACITY,
      hoverinfo: 'skip', showlegend: false,
    },
    {
      type: 'scatter', mode: 'lines', x, y: paidIn,
      line: { width: 0 }, hoverinfo: 'skip', showlegend: false,
    },
    {
      type: 'scatter', mode: 'lines', x,
      y: series.map((row) => Math.min(row.value, row.invested)),
      line: { width: 0 }, fill: 'tonexty', fillcolor: theme.down, opacity: BACKTEST_RETURN_FILL_OPACITY,
      hoverinfo: 'skip', showlegend: false,
    },
  ] : []
  const relativeDrop = { start: summary.max_drawdown_start, end: summary.max_drawdown_end }
  const absoluteDrop = { start: summary.max_absolute_drawdown_start, end: summary.max_absolute_drawdown_end }
  const distinctDrops = relativeDrop.start !== absoluteDrop.start || relativeDrop.end !== absoluteDrop.end

  function dropTraces(drop, name, color, dash = 'solid') {
    if (feature !== 'drawdown' || !drop.start) return []
    const values = series.map((row) => (
      row.date >= drop.start && row.date <= drop.end ? row.value : null
    ))

    return [{
      type: 'scatter',
      mode: 'lines',
      name,
      x,
      y: values,
      line: { color, width: LINE_WIDTH * 2, dash },
      opacity: BACKTEST_HIGHLIGHT_OPACITY,
      hovertemplate: `${CURRENCY} %{y:,.0f}<extra>${name}</extra>`,
    }, {
      type: 'scatter',
      mode: 'markers',
      name: `${name} endpoints`,
      x: [drop.start, drop.end],
      y: [
        series.find((row) => row.date === drop.start)?.value,
        series.find((row) => row.date === drop.end)?.value,
      ],
      marker: { color, size: 7 },
      opacity: BACKTEST_HIGHLIGHT_OPACITY,
      hovertemplate: `${CURRENCY} %{y:,.0f}<extra>${name}</extra>`,
      showlegend: false,
    }]
  }

  const drawdownTraces = [
    ...dropTraces(relativeDrop, distinctDrops ? 'Largest percentage drop' : 'Largest drop (% and CHF)', theme.down),
    ...(distinctDrops ? dropTraces(absoluteDrop, 'Largest CHF drop', theme.invested) : []),
  ]

  const visibleStart = dateOnly(visibleRange[0])
  const visibleEnd = dateOnly(visibleRange[1])
  const rowsInView = series.filter((row) => row.date >= visibleStart && row.date <= visibleEnd)
  const fittedRows = rowsInView.length > 0 ? rowsInView : series
  const fittedValues = fittedRows.flatMap((row) => [row.value, row.invested])
  const fittedMaximum = Math.max(...fittedValues)
  const yRange = [0, fittedMaximum * (1 + AXIS_HEADROOM)]

  function updateVisibleRange(event) {
    const nextStart = event['xaxis.range[0]']
    const nextEnd = event['xaxis.range[1]']

    if (nextStart && nextEnd) {
      setVisibleRange([
        new Date(nextStart) < new Date(dataStart) ? dataStart : nextStart,
        new Date(nextEnd) > new Date(chartEnd) ? chartEnd : nextEnd,
      ])
    } else if (event['xaxis.autorange']) {
      setVisibleRange([dataStart, chartEnd])
    }
  }

  return (
    <Plot
      data={[
        ...paidInTraces,
        ...marketReturnTraces,
        {
          type: 'scatter',
          mode: 'lines',
          name: 'Portfolio value',
          x,
          y: series.map((row) => row.value),
          line: { color: theme.value, width: LINE_WIDTH },
          hovertemplate: feature === 'dividends' ? undefined : `${CURRENCY} %{y:,.0f}<extra>Portfolio value</extra>`,
          hoverinfo: feature === 'dividends' ? 'skip' : undefined,
        },
        {
          type: 'scatter',
          mode: 'lines',
          name: 'Money paid in',
          x,
          y: paidIn,
          // Contributions arrive in steps, so draw them as steps.
          line: { color: theme.invested, width: LINE_WIDTH, shape: 'hv' },
          hovertemplate: feature === 'dividends' ? undefined : `${CURRENCY} %{y:,.0f}<extra>Money paid in</extra>`,
          hoverinfo: feature === 'dividends' ? 'skip' : undefined,
        },
        ...(feature === 'dividends' ? [{
          type: 'scatter',
          mode: 'lines',
          name: 'Dividends accumulated',
          x,
          y: series.map((row) => row.dividends),
          customdata: series.map((row) => [
            row.latest_dividend_date
              ? `${chf(row.latest_dividend_payout)} on ${displayDate(row.latest_dividend_date)}`
              : 'No payout yet',
            row.dividend_year,
            percent(row.annual_dividend_return, 2),
            chf(row.annual_dividends),
          ]),
          line: { color: theme.up, width: LINE_WIDTH, shape: 'hv' },
          opacity: BACKTEST_HIGHLIGHT_OPACITY,
          hovertemplate: `${CURRENCY} %{y:,.0f} accumulated<br>Latest payout: %{customdata[0]}<br>%{customdata[1]} dividend return: %{customdata[2]} <span style="color:${theme.muted}">(%{customdata[3]})</span><extra>Dividends</extra>`,
        }] : []),
        ...drawdownTraces,
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
          range: visibleRange,
          minallowed: dataStart,
          maxallowed: chartEnd,
          hoverformat: intervalById[DAILY_INTERVAL].hoverFormat,
        },
        yaxis: {
          ...baseYAxis,
          range: yRange,
          minallowed: 0,
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
      onRelayout={updateVisibleRange}
    />
  )
}

// The plan: how close the next investing day is, and what will be bought then.
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
        <p className="muted">Nothing to buy on {displayDate(plan.next_investing_date)}.</p>
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

function Tile({ label, value, note, feature, active, onPreview, onToggle }) {
  return (
    <button
      type="button"
      className={active ? 'tile interactive active' : 'tile interactive'}
      aria-pressed={active}
      onMouseEnter={() => onPreview(feature)}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview(feature)}
      onBlur={() => onPreview(null)}
      onClick={() => onToggle(feature)}
    >
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </button>
  )
}

function ShareBar({ summary }) {
  if (summary.gain < 0) {
    return (
      <div className="share-split">
        <p className="share-split-title">Where today&apos;s value comes from</p>
        <p className="muted">
          The portfolio is worth {chf(-summary.gain)} less than the money paid in: {chf(summary.initial_invested)} at the
          start{summary.periodic_invested > 0 && ` and ${chf(summary.periodic_invested)} added periodically`}.
        </p>
        {summary.cash > 0 && (
          <p className="share-split-note">{chf(summary.cash)} of today&apos;s value is currently waiting as cash.</p>
        )}
      </div>
    )
  }

  const sources = [
    { key: 'initial', label: 'Starting value', value: summary.initial_invested, className: 'initial' },
    { key: 'periodic', label: 'Periodic contributions', value: summary.periodic_invested, className: 'periodic' },
    { key: 'return', label: 'Market return', value: summary.gain, className: 'return' },
  ].filter((source) => source.value > 0)

  return (
    <div className="share-split">
      <p className="share-split-title">Where today&apos;s value comes from</p>
      <div className="split-bar" aria-hidden="true">
        {sources.map((source) => (
          <span key={source.key} className={`split-${source.className}`} style={{ width: percent(source.value / summary.final_value) }} />
        ))}
      </div>
      <ul className="split-legend">
        {sources.map((source) => (
          <li key={source.key}>
            <span className={`swatch ${source.className}`} />
            {source.label} {percent(source.value / summary.final_value)} ({chf(source.value)})
          </li>
        ))}
      </ul>
      {summary.cash > 0 && (
        <p className="share-split-note">{chf(summary.cash)} of today&apos;s value is currently waiting as cash.</p>
      )}
    </div>
  )
}

// One sentence on how the money got in, from the portfolio's rules.
function paidInNote(settings) {
  const capital = `${chf(settings.initial_capital)} starting capital`
  const start = settings.has_starting_position ? `${capital} and shares you owned` : capital
  if (!settings.inflow_amount) return start
  return `${start}, then ${chf(settings.inflow_amount)} ${frequencyById[settings.inflow_frequency].per}`
}

function dividendsNote(settings) {
  if (settings.invest_frequency === NEVER_INVEST) return 'Kept as cash'
  return `Collected as cash, invested ${frequencyById[settings.invest_frequency].label.toLowerCase()}`
}

function BacktestResult({ result, plan }) {
  const { summary, settings, holdings, series } = result
  const [previewFeature, setPreviewFeature] = useState(null)
  const [pinnedFeature, setPinnedFeature] = useState(null)
  const activeFeature = previewFeature ?? pinnedFeature
  const distinctDrawdowns = (
    summary.max_drawdown_start !== summary.max_absolute_drawdown_start
    || summary.max_drawdown_end !== summary.max_absolute_drawdown_end
  )
  const drawdownValues = (
    <>
      <span>{percent(summary.max_drawdown)} relative</span>
      <span>−{chf(summary.max_absolute_drawdown)} absolute</span>
    </>
  )

  function toggleFeature(feature) {
    setPreviewFeature(null)
    setPinnedFeature((current) => (current === feature ? null : feature))
  }

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
        <Tile label="Paid in" value={chf(summary.invested)} note={paidInNote(settings)} feature="paid-in" active={activeFeature === 'paid-in'} onPreview={setPreviewFeature} onToggle={toggleFeature} />
        <Tile label="Market return" value={chf(summary.gain)} note="Value minus the money paid in" feature="market-return" active={activeFeature === 'market-return'} onPreview={setPreviewFeature} onToggle={toggleFeature} />
        <Tile label="Dividends" value={chf(summary.dividends)} note={dividendsNote(settings)} feature="dividends" active={activeFeature === 'dividends'} onPreview={setPreviewFeature} onToggle={toggleFeature} />
        <Tile label="Largest drops" value={drawdownValues} note={distinctDrawdowns ? 'Different periods' : null} feature="drawdown" active={activeFeature === 'drawdown'} onPreview={setPreviewFeature} onToggle={toggleFeature} />
      </div>

      <ShareBar summary={summary} />

      <BacktestChart
        key={`${summary.start_date}-${summary.end_date}-${plan?.until ?? ''}`}
        series={series}
        plan={plan}
        feature={activeFeature}
        summary={summary}
      />
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
function BacktestPanel({ portfolio, onStocksChanged }) {
  const tickers = portfolio.holdings
    .filter((holding) => holding.selected !== false)
    .map((holding) => holding.ticker)
  const initialRange = { start: portfolio.start_date ?? '', end: '' }
  const [customRange, setCustomRange] = useState({
    start: editableDateValue(initialRange.start),
    end: editableDateValue(initialRange.end),
  })
  // The result together with the settings that produced it, so the plan matches the chart.
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [showRange, setShowRange] = useState(false)
  const [hasStoredCustomRange, setHasStoredCustomRange] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const [plan, setPlan] = useState(null)
  const [planError, setPlanError] = useState('')
  const runSequence = useRef(0)

  // The plan follows the result on screen; it is fetched only while the plan is switched on.
  const ranSettings = run?.settings
  useEffect(() => {
    if (!showPlan || !ranSettings) return undefined

    let current = true
    fetchPlan(portfolio.id, { start: ranSettings.start, until: '' })
      .then((data) => {
        if (!current) return
        const nextDate = data.next_investing_date
        setPlan({
          ...data,
          until: nextDate ?? data.as_of,
          investments: data.investments.filter((item) => item.date === nextDate).slice(0, 1),
        })
        setPlanError('')
      })
      .catch((err) => current && setPlanError(err.message))
    return () => {
      current = false
    }
  }, [showPlan, portfolio.id, ranSettings])

  function update(field, value) {
    setCustomRange((current) => ({ ...current, [field]: value }))
  }

  function parsedCustomRange(committed = {}) {
    const start = committed.start !== undefined ? { date: committed.start, error: '' } : parseEditableDate(customRange.start)
    const end = committed.end !== undefined ? { date: committed.end, error: '' } : parseEditableDate(customRange.end)
    if (start.error) return { error: `From: ${start.error}` }
    if (end.error) return { error: `To: ${end.error}` }
    return { settings: { start: start.date ?? '', end: end.date ?? '' } }
  }

  async function runBacktest(settings) {
    if (settings.start && settings.end && settings.start > settings.end) {
      setError(START_BEFORE_END_ERROR)
      return
    }

    const runId = ++runSequence.current
    setRunning(true)
    setError('')
    try {
      await waitForStocks(tickers, (nextProgress) => {
        if (runSequence.current === runId) setProgress(nextProgress)
      })
      if (runSequence.current !== runId) return
      onStocksChanged()
      const result = await fetchBacktest(portfolio.id, settings)
      if (runSequence.current === runId) setRun({ result, settings })
    } catch (err) {
      if (runSequence.current === runId) setError(err.message)
    } finally {
      if (runSequence.current === runId) {
        setRunning(false)
        setProgress(null)
      }
    }
  }

  function commitCustomRange(field, date) {
    const parsed = parsedCustomRange({ [field]: date })
    if (parsed.error) {
      setError(parsed.error)
      return
    }
    setHasStoredCustomRange(true)
    runBacktest(parsed.settings)
  }

  function toggleRange() {
    if (!showRange) {
      setShowRange(true)
      if (hasStoredCustomRange) {
        const parsed = parsedCustomRange()
        if (!parsed.error) runBacktest(parsed.settings)
      }
      return
    }

    setShowRange(false)
    setPlan(null)
    setError('')
    runBacktest(initialRange)
  }

  function submit(event) {
    event.preventDefault()
    if (!showRange) {
      runBacktest(initialRange)
      return
    }

    const parsed = parsedCustomRange()
    if (parsed.error) {
      setError(parsed.error)
      return
    }
    setHasStoredCustomRange(true)
    runBacktest(parsed.settings)
  }

  const loading = progress && progress.done < progress.total
  const buttonText = !running ? 'Run backtest' : loading ? `Loading ${progress.done} of ${progress.total}…` : 'Running…'

  return (
    <section className="panel" aria-label="Backtest">
      <h2>Backtest</h2>
      <p className="muted">
        What {portfolio.name} would be worth today, following its rules: new money and dividends wait as cash and
        are spent on whole shares on the investing days. Nothing is ever sold.
      </p>

      <form className="backtest-form" onSubmit={submit} onKeyDown={commitInputOnEnter}>
        <div className="backtest-run">
          <button type="submit" className="primary" disabled={running}>{buttonText}</button>
        </div>
        <div className="backtest-actions">
          <OptionButtons
            label="Range"
            options={[{ id: 'range', label: 'Custom range' }]}
            isActive={() => showRange}
            onSelect={toggleRange}
          />
          <OptionButtons
            label="Plan"
            options={[{ id: 'plan', label: 'Show plan' }]}
            isActive={() => showPlan}
            onSelect={() => setShowPlan((current) => !current)}
          />
        </div>
        {showRange && (
          <div className="backtest-range-fields">
            <EditableDateField
              label="From"
              value={customRange.start}
              onChange={(value) => update('start', value)}
              onCommit={(date) => commitCustomRange('start', date)}
            />
            <EditableDateField
              label="To (blank means today)"
              value={customRange.end}
              onChange={(value) => update('end', value)}
              onCommit={(date) => commitCustomRange('end', date)}
            />
          </div>
        )}
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
