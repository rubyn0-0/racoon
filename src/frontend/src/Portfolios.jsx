// The portfolios screen: a saved-portfolio list on the left, the editor and the backtest on the right.
// Weighting names, help texts, frequencies and defaults are in settings.js.
import { useEffect, useState } from 'react'
import { deletePortfolio, fetchClosesOn, fetchPortfolios, previewWeights, savePortfolio } from './api'
import BacktestPanel from './Backtest'
import Compare from './Compare'
import {
  LoadingNote,
  OptionButtons,
  StockSearch,
  EditableDateField,
  chf,
  chfCompact,
  commitInputOnEnter,
  compact,
  displayDate,
  editableDateValue,
  parseEditableDate,
  percent,
  useStockData,
  waitForStocks,
  weightingById,
} from './helpers'
import {
  CAPITAL_STEP,
  COMPARE_PORTFOLIOS,
  COPY_SUFFIX,
  DEFAULT_INFLOW_FREQUENCY,
  DEFAULT_INVEST_FREQUENCY,
  DEFAULT_WEIGHTING,
  INFLOW_FREQUENCIES,
  INFLOW_STEP,
  INITIAL_CAPITAL_DEFAULT,
  INVEST_FREQUENCIES,
  NEW_PORTFOLIO,
  PORTFOLIO_NAME_MAX_LENGTH,
  PREVIEW_DEBOUNCE_MS,
  WEIGHTING,
  WEIGHTINGS,
  WEIGHTING_HELP,
  WEIGHT_STEP,
  WEIGHT_TOTAL,
} from './settings'

// The screen: list of saved portfolios plus whichever one is selected.
function Portfolios({ stocks, onStocksChanged }) {
  const [portfolios, setPortfolios] = useState(null)
  const [selectedId, setSelectedId] = useState(NEW_PORTFOLIO)
  // A copied portfolio opens as an unsaved draft; `copies` makes each copy a fresh editor.
  const [template, setTemplate] = useState(null)
  const [copies, setCopies] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchPortfolios()
      .then((data) => {
        setPortfolios(data)
        if (data.length > 0) setSelectedId(data[0].id)
      })
      .catch((err) => setError(`Could not load portfolios: ${err.message}`))
  }, [])

  const selected = portfolios?.find((portfolio) => portfolio.id === selectedId) ?? null

  function select(id) {
    setTemplate(null)
    setSelectedId(id)
  }

  function handleCopy(portfolio) {
    setTemplate({ ...portfolio, name: `${portfolio.name}${COPY_SUFFIX}` })
    setCopies((count) => count + 1)
    setSelectedId(NEW_PORTFOLIO)
  }

  function handleSaved(saved) {
    setTemplate(null)
    setPortfolios((current) => {
      const others = current.filter((portfolio) => portfolio.id !== saved.id)
      return [...others, saved].sort((a, b) => a.name.localeCompare(b.name))
    })
    setSelectedId(saved.id)
  }

  function handleDeleted(id) {
    const remaining = portfolios.filter((portfolio) => portfolio.id !== id)
    setPortfolios(remaining)
    select(remaining[0]?.id ?? NEW_PORTFOLIO)
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!portfolios) return <p className="muted">Loading portfolios…</p>

  return (
    <div className="portfolio-layout">
      <aside className="portfolio-list" aria-label="Saved portfolios">
        <button
          type="button"
          className={selectedId === COMPARE_PORTFOLIOS ? 'list-item active' : 'list-item'}
          onClick={() => select(COMPARE_PORTFOLIOS)}
        >
          <span className="list-title">Compare portfolios</span>
        </button>
        <button
          type="button"
          className={selectedId === NEW_PORTFOLIO ? 'list-item active' : 'list-item'}
          onClick={() => select(NEW_PORTFOLIO)}
        >
          <span className="list-title">New portfolio</span>
        </button>
        {portfolios.map((portfolio) => (
          <button
            key={portfolio.id}
            type="button"
            className={selectedId === portfolio.id ? 'list-item active' : 'list-item'}
            aria-current={selectedId === portfolio.id ? 'true' : undefined}
            onClick={() => select(portfolio.id)}
          >
            <span className="list-title">{portfolio.name}</span>
            <span className="list-meta">
              {portfolio.holdings.filter((holding) => holding.selected !== false).length}{' '}
              {portfolio.holdings.filter((holding) => holding.selected !== false).length === 1 ? 'stock' : 'stocks'},{' '}
              {weightingById[portfolio.weighting].name.toLowerCase()}
            </span>
          </button>
        ))}
      </aside>

      <div className="portfolio-main">
        {selectedId === COMPARE_PORTFOLIOS && <Compare portfolios={portfolios} stocks={stocks} onStocksChanged={onStocksChanged} />}
        {selectedId !== COMPARE_PORTFOLIOS && (
          <PortfolioEditor
            // A fresh editor per portfolio or copy, so switching never mixes two drafts.
            key={template ? `copy-${copies}` : (selected?.id ?? NEW_PORTFOLIO)}
            stocks={stocks}
            onStocksChanged={onStocksChanged}
            portfolio={selected}
            template={template}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onCopy={handleCopy}
          />
        )}
        {selected && (
          <BacktestPanel
            // Re-run from scratch whenever anything saved about the portfolio changes.
            key={`${selected.id}-${JSON.stringify(selected)}`}
            stocks={stocks}
            onStocksChanged={onStocksChanged}
            portfolio={selected}
          />
        )}
      </div>
    </div>
  )
}

// Your weights: whole percents. Split 100 as evenly as possible, the first stocks getting the odd percent.
function evenSplit(tickers) {
  const base = Math.floor(WEIGHT_TOTAL / tickers.length)
  const extra = WEIGHT_TOTAL - base * tickers.length
  return Object.fromEntries(tickers.map((ticker, index) => [ticker, base + (index < extra ? 1 : 0)]))
}

// Turn saved relative weights (any numbers) into whole percents that add up to 100.
function toPercents(holdings) {
  const total = holdings.reduce((sum, holding) => sum + holding.weight, 0)
  const exact = holdings.map((holding) => (holding.weight / total) * WEIGHT_TOTAL)
  const result = exact.map(Math.floor)
  let missing = WEIGHT_TOTAL - result.reduce((sum, value) => sum + value, 0)
  const byRemainder = exact.map((value, index) => [value - Math.floor(value), index]).sort((a, b) => b[0] - a[0])

  for (const [, index] of byRemainder) {
    if (missing === 0) break
    result[index] += 1
    missing -= 1
  }

  return Object.fromEntries(holdings.map((holding, index) => [holding.ticker, result[index]]))
}

function initialWeights(portfolio) {
  if (!portfolio) return {}
  const selected = portfolio.holdings.filter((holding) => holding.selected !== false)
  const tickers = selected.map((holding) => holding.ticker)
  return portfolio.weighting === WEIGHTING.MANUAL ? toPercents(selected) : evenSplit(tickers)
}

const round2 = (value) => Math.round(value * 100) / 100

// Everything the API stores about a portfolio, in a fixed shape so a draft can be compared with the saved one.
function makeDraft({
  name,
  weighting,
  rows,
  initialCapital,
  investFrequency,
  inflowAmount,
  inflowFrequency,
  startDate,
}) {
  return {
    name,
    weighting,
    holdings: rows.map((row) => ({
      ticker: row.ticker,
      selected: row.selected,
      weight: weighting === WEIGHTING.MANUAL && row.selected ? row.weight : null,
      start_shares: row.inStartingPosition ? row.startShares : null,
    })),
    initial_capital: round2(initialCapital),
    invest_frequency: investFrequency,
    inflow_amount: inflowAmount,
    inflow_frequency: inflowFrequency,
    start_date: startDate || null,
  }
}

function savedDraft(portfolio) {
  const percents = initialWeights(portfolio)
  return makeDraft({
    name: portfolio.name,
    weighting: portfolio.weighting,
    rows: portfolio.holdings.map((holding) => ({
      ticker: holding.ticker,
      weight: percents[holding.ticker],
      startShares: holding.start_shares ?? 0,
      selected: holding.selected !== false,
      inStartingPosition: holding.start_shares !== null,
    })),
    initialCapital: portfolio.initial_capital,
    investFrequency: portfolio.invest_frequency,
    inflowAmount: portfolio.inflow_amount,
    inflowFrequency: portfolio.inflow_frequency,
    startDate: portfolio.start_date,
  })
}

// A percent control: arrows (1% steps), a slider and a number box. It can only grow by the unallocated percent.
function WeightControl({ label, value, onChange }) {
  return (
    <span className="weight-control">
      <input
        type="number"
        className="weight-input"
        min="0"
        max={WEIGHT_TOTAL}
        step={WEIGHT_STEP}
        value={value}
        aria-label={`Weight for ${label} in percent`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        type="range"
        min="0"
        max={WEIGHT_TOTAL}
        step={WEIGHT_STEP}
        value={value}
        aria-label={`Weight for ${label}`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      %
    </span>
  )
}

// The editor: name, weighting, stocks, how money flows, an optional starting position, and the resulting weights.
function PortfolioEditor({ stocks, portfolio, template, onSaved, onDeleted, onCopy, onStocksChanged }) {
  // A copy starts from the template's values but is still a new, unsaved portfolio.
  const source = portfolio ?? template
  const [name, setName] = useState(source?.name ?? '')
  const [weighting, setWeighting] = useState(source?.weighting ?? DEFAULT_WEIGHTING)
  const [availableTickers, setAvailableTickers] = useState(() => (
    (source?.holdings ?? []).map((holding) => holding.ticker)
  ))
  const [weights, setWeights] = useState(() => initialWeights(source))
  const [initialCapital, setInitialCapital] = useState(String(source?.initial_capital ?? INITIAL_CAPITAL_DEFAULT))
  const [investFrequency, setInvestFrequency] = useState(source?.invest_frequency ?? DEFAULT_INVEST_FREQUENCY)
  const [inflowAmount, setInflowAmount] = useState(String(source?.inflow_amount ?? 0))
  const [inflowFrequency, setInflowFrequency] = useState(source?.inflow_frequency ?? DEFAULT_INFLOW_FREQUENCY)
  const [openingDate, setOpeningDate] = useState(() => editableDateValue(source?.start_date))
  const [positionTickers, setPositionTickers] = useState(() => (
    (source?.holdings ?? []).filter((holding) => holding.start_shares !== null).map((holding) => holding.ticker)
  ))
  const [startShares, setStartShares] = useState(() => Object.fromEntries(
    (source?.holdings ?? []).map((holding) => [holding.ticker, String(holding.start_shares ?? 0)]),
  ))
  const [closes, setCloses] = useState({})
  const [closesDate, setClosesDate] = useState('')
  const [preview, setPreview] = useState({})
  const [previewError, setPreviewError] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(null)

  const manual = weighting === WEIGHTING.MANUAL
  const tickers = Object.keys(weights).sort()
  const tickersKey = tickers.join(',')
  const orderedAvailableTickers = [
    ...availableTickers.filter((ticker) => ticker in weights),
    ...availableTickers.filter((ticker) => !(ticker in weights)),
  ]
  const availableStocks = orderedAvailableTickers
    .map((ticker) => stocks.find((stock) => stock.ticker === ticker))
    .filter(Boolean)
  const allocated = tickers.reduce((sum, ticker) => sum + weights[ticker], 0)
  const unallocated = WEIGHT_TOTAL - allocated

  const parsedOpeningDate = parseEditableDate(openingDate)
  const startDate = parsedOpeningDate.date

  // Transferred shares are independent of the strategy selection and are valued on the opening date.
  const sharesOf = (ticker) => Number(startShares[ticker]) || 0
  const priceOn = (ticker) => (startDate && closesDate === startDate ? closes[ticker] ?? null : null)
  const positionTickersKey = [...positionTickers].sort().join(',')
  const holdingsValue = positionTickers.every((ticker) => priceOn(ticker) !== null)
    ? positionTickers.reduce((sum, ticker) => sum + sharesOf(ticker) * priceOn(ticker), 0)
    : null

  const draft = makeDraft({
    name: name.trim(),
    weighting,
    rows: availableTickers.map((ticker) => ({
      ticker,
      selected: ticker in weights,
      weight: weights[ticker],
      startShares: sharesOf(ticker),
      inStartingPosition: positionTickers.includes(ticker),
    })),
    initialCapital: Number(initialCapital) || 0,
    investFrequency,
    inflowAmount: Number(inflowAmount) || 0,
    inflowFrequency,
    startDate,
  })
  const changed = !portfolio || JSON.stringify(draft) !== JSON.stringify(savedDraft(portfolio))

  // Nothing loads when a portfolio is just opened. Ticking or adding a stock starts loading that stock, and
  // saving loads the stocks first if the weighting needs company sizes (market cap, % of company).
  const [wanted, setWanted] = useState([])
  const data = useStockData(wanted, onStocksChanged)
  const allLoaded = tickers.every((ticker) => stocks.find((stock) => stock.ticker === ticker)?.loaded)
  const positionsLoaded = positionTickers.every((ticker) => stocks.find((stock) => stock.ticker === ticker)?.loaded)
  const needsSizes = weighting === WEIGHTING.MARKET_CAP || weighting === WEIGHTING.OWNERSHIP

  // The close of each stock on the start date, to value the starting shares (one small request).
  useEffect(() => {
    if (!positionTickersKey || !startDate || !positionsLoaded) return undefined

    let current = true
    fetchClosesOn(positionTickersKey.split(','), startDate)
      .then((result) => {
        if (!current) return
        setCloses(result)
        setClosesDate(startDate)
      })
      .catch((err) => current && setPreviewError(`Could not load prices: ${err.message}`))
    return () => {
      current = false
    }
  }, [positionTickersKey, startDate, positionsLoaded])

  // Ask the backend for the resulting weights while editing; it owns the weighting rules.
  // Your weights are just the percentages you typed, so they need no round trip.
  useEffect(() => {
    if (manual || !tickersKey || !allLoaded) return undefined

    let current = true
    const timer = setTimeout(() => {
      previewWeights({ weighting, holdings: tickersKey.split(',').map((ticker) => ({ ticker })) })
        .then((rows) => {
          if (!current) return
          setPreview(Object.fromEntries(rows.map((row) => [row.ticker, row.target_weight])))
          setPreviewError('')
        })
        .catch((err) => current && setPreviewError(err.message))
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [manual, weighting, tickersKey, allLoaded])

  function touch(update) {
    setStatus('')
    update()
  }

  function chooseWeighting(id) {
    touch(() => {
      setWeighting(id)
      setPreviewError('')
      // Your weights need to add up to 100%; start from an even split if they do not.
      if (id === WEIGHTING.MANUAL && allocated !== WEIGHT_TOTAL && tickers.length > 0) {
        setWeights(evenSplit(tickers))
      }
    })
  }

  function addStock(ticker) {
    if (availableTickers.includes(ticker)) return
    touch(() => {
      setAvailableTickers((current) => [...current, ticker])
      setWanted((current) => (current.includes(ticker) ? current : [...current, ticker]))
      setStartShares((current) => ({ ...current, [ticker]: '0' }))
    })
  }

  function toggleStock(ticker) {
    touch(() => {
      setWeights((current) => {
        if (!(ticker in current)) {
          setWanted((wanted) => (wanted.includes(ticker) ? wanted : [...wanted, ticker]))
          return { ...current, [ticker]: 0 }
        }
        const next = { ...current }
        delete next[ticker]
        return next
      })
      if (ticker in weights) {
        setStartShares((current) => ({ ...current, [ticker]: '0' }))
        setPositionTickers((current) => current.filter((item) => item !== ticker))
      }
    })
  }

  function toggleAllStocks() {
    touch(() => {
      if (tickers.length === availableTickers.length) {
        setWeights({})
        setStartShares((current) => Object.fromEntries(
          Object.entries(current).map(([ticker]) => [ticker, '0']),
        ))
        setPositionTickers([])
        return
      }

      const missing = availableTickers.filter((ticker) => !(ticker in weights))
      setWanted((current) => [...new Set([...current, ...missing])])
      setWeights((current) => Object.fromEntries(
        availableTickers.map((ticker) => [ticker, current[ticker] ?? 0]),
      ))
    })
  }

  function removeStock(ticker) {
    touch(() => {
      setAvailableTickers((current) => current.filter((item) => item !== ticker))
      setWanted((current) => current.filter((item) => item !== ticker))
      setWeights((current) => {
        const next = { ...current }
        delete next[ticker]
        return next
      })
      setStartShares((current) => {
        const next = { ...current }
        delete next[ticker]
        return next
      })
      setPositionTickers((current) => current.filter((item) => item !== ticker))
      setCloses((current) => {
        const next = { ...current }
        delete next[ticker]
        return next
      })
      setPreview((current) => {
        const next = { ...current }
        delete next[ticker]
        return next
      })
      setConfirmingRemove(null)
    })
  }

  function addPosition(ticker) {
    if (positionTickers.includes(ticker)) return
    touch(() => {
      setPositionTickers((current) => [...current, ticker])
      setStartShares((current) => ({ ...current, [ticker]: '0' }))
      if (!stocks.find((stock) => stock.ticker === ticker)?.loaded) {
        setWanted((current) => (current.includes(ticker) ? current : [...current, ticker]))
      }
    })
  }

  function removePosition(ticker) {
    touch(() => {
      setPositionTickers((current) => current.filter((item) => item !== ticker))
      setStartShares((current) => ({ ...current, [ticker]: '0' }))
    })
  }

  // A stock can only take as much as is unallocated; to give it more, lower another stock first.
  function changeWeight(ticker, value) {
    touch(() => {
      const limit = weights[ticker] + unallocated
      const next = Math.max(0, Math.min(Math.round(value) || 0, limit))
      setWeights((current) => ({ ...current, [ticker]: next }))
    })
  }

  async function save(event) {
    event.preventDefault()

    if (!draft.name) return setError('Give the portfolio a name.')
    if (tickers.length === 0) return setError('Pick at least one stock.')
    if (manual && (allocated !== WEIGHT_TOTAL || tickers.some((ticker) => weights[ticker] < 1))) {
      return setError(`Your weights must add up to ${WEIGHT_TOTAL}%, with at least 1% per stock.`)
    }
    if (parsedOpeningDate.error) return setError(parsedOpeningDate.error)

    setSaving(true)
    setError('')
    try {
      if (needsSizes) {
        await waitForStocks(tickers)
        onStocksChanged()
      }
      const saved = await savePortfolio(portfolio?.id, draft)
      setStatus(portfolio ? 'Changes saved.' : '')
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await deletePortfolio(portfolio.id)
      onDeleted(portfolio.id)
    } catch (err) {
      setError(err.message)
      setConfirmingDelete(false)
    }
  }

  return (
    <section className="panel" aria-label="Portfolio">
      <h2>{portfolio ? portfolio.name : 'New portfolio'}</h2>

      <form className="portfolio-form" onSubmit={save} onKeyDown={commitInputOnEnter}>
        <label className="field">
          Name
          <input
            type="text"
            value={name}
            maxLength={PORTFOLIO_NAME_MAX_LENGTH}
            placeholder="For example: Swiss defensive"
            onChange={(event) => touch(() => setName(event.target.value))}
          />
        </label>

        <fieldset className="rules">
          <legend>Starting Capital &amp; Cash Inflows</legend>
          <div className="field-row">
            <EditableDateField
              label="Portfolio opening date"
              value={openingDate}
              onChange={(value) => touch(() => setOpeningDate(value))}
            />
            <label className="field">
              Starting capital (CHF)
              <input
                type="number"
                min="0"
                step={CAPITAL_STEP}
                value={initialCapital}
                onChange={(event) => touch(() => setInitialCapital(event.target.value))}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              New money per period (CHF)
              <input
                type="number"
                min="0"
                step={INFLOW_STEP}
                value={inflowAmount}
                onChange={(event) => touch(() => setInflowAmount(event.target.value))}
              />
            </label>
            <div className="field rule-option">
              <OptionButtons
                label="New money arrives"
                showLabel
                options={INFLOW_FREQUENCIES}
                isActive={(id) => inflowFrequency === id}
                onSelect={(id) => touch(() => setInflowFrequency(id))}
              />
            </div>
          </div>
          <div className="field rule-option">
            <OptionButtons
              label="Invest the cash"
              showLabel
              options={INVEST_FREQUENCIES}
              isActive={(id) => investFrequency === id}
              onSelect={(id) => touch(() => setInvestFrequency(id))}
            />
          </div>
        </fieldset>

        <fieldset className="rules investment-strategy">
          <legend>Investment Strategy</legend>
          <div className="field rule-option">
            <OptionButtons
              label="Weighting"
              showLabel
              options={WEIGHTINGS}
              isActive={(id) => weighting === id}
              onSelect={chooseWeighting}
            />
          </div>
          <p className="muted">{WEIGHTING_HELP[weighting]}</p>
          <StockSearch
            label="Add a stock"
            placeholder="Search any stock by name or ticker"
            stocks={stocks}
            value=""
            clearOnSelect
            excludedTickers={availableTickers}
            maxResults={null}
            visibleRows={7}
            onSelect={addStock}
          />
          <span className="option-label">Stocks</span>
          {availableTickers.length > 0 && (
            <button type="button" className="quiet select-all" onClick={toggleAllStocks}>
              {tickers.length === availableTickers.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
          {availableTickers.length === 0 ? (
            <p className="muted">Search for a stock above to add it here.</p>
          ) : (
            <div className="table-scroll">
              <table className="holdings-table">
                <thead>
                  <tr>
                    <th scope="col">Stock</th>
                    {manual && <th scope="col" className="weight-share-heading">Share of portfolio</th>}
                    {weighting === WEIGHTING.MARKET_CAP && <th scope="col" className="number">Market cap</th>}
                    {weighting === WEIGHTING.OWNERSHIP && <th scope="col" className="number">Shares in issue</th>}
                    {!manual && <th scope="col">Share of portfolio</th>}
                    <th scope="col" className="stock-actions" aria-label="Stock actions" />
                  </tr>
                </thead>
                <tbody>
                  {availableStocks.map((stock) => {
                    const isIncluded = stock.ticker in weights
                    const share = manual ? weights[stock.ticker] / WEIGHT_TOTAL : preview[stock.ticker]

                    return (
                      <tr key={stock.ticker} className={isIncluded ? undefined : 'excluded'}>
                        <td>
                          <label className="check">
                            <input type="checkbox" checked={isIncluded} onChange={() => toggleStock(stock.ticker)} />
                            {stock.company}
                          </label>
                        </td>
                        {manual && (
                          <td className="weight-share-cell">
                            {isIncluded && (
                              <WeightControl
                                label={stock.company}
                                value={weights[stock.ticker]}
                                onChange={(value) => changeWeight(stock.ticker, value)}
                              />
                            )}
                          </td>
                        )}
                        {weighting === WEIGHTING.MARKET_CAP && (
                          <td className="number muted">{stock.market_cap ? chfCompact(stock.market_cap) : 'Not loaded'}</td>
                        )}
                        {weighting === WEIGHTING.OWNERSHIP && (
                          <td className="number muted">{stock.shares_outstanding ? compact(stock.shares_outstanding) : 'Not loaded'}</td>
                        )}
                        {!manual && (
                          <td>
                            {isIncluded && share !== undefined && !previewError && (
                              <span className="share">
                                <span className="share-bar" aria-hidden="true">
                                  <span style={{ width: percent(share) }} />
                                </span>
                                {percent(share)}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="stock-actions">
                          {confirmingRemove === stock.ticker ? (
                            <span className="remove-confirmation">
                              <button type="button" className="danger" onClick={() => removeStock(stock.ticker)}>
                                Remove
                              </button>
                              <button type="button" className="quiet" onClick={() => setConfirmingRemove(null)}>
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="remove-stock"
                              aria-label={`Remove ${stock.company}`}
                              title={`Remove ${stock.company}`}
                              onClick={() => setConfirmingRemove(stock.ticker)}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {manual && tickers.length > 0 && (
            <p className={unallocated === 0 ? 'muted' : 'unallocated'} role="status">
              {unallocated === 0 && `All ${WEIGHT_TOTAL}% is spread out.`}
              {unallocated > 0 && `${unallocated}% unallocated. Give it to a stock to reach ${WEIGHT_TOTAL}%.`}
            </p>
          )}
        </fieldset>

        <fieldset className="rules">
          <legend>Starting position</legend>
          <p className="muted">Transfer existing shares when the portfolio opens.</p>
          <StockSearch
            label="Add an existing position"
            placeholder="Search stocks already added above"
            stocks={availableStocks}
            value=""
            clearOnSelect
            excludedTickers={positionTickers}
            maxResults={null}
            visibleRows={7}
            onSelect={addPosition}
          />
          {positionTickers.length > 0 && (
            <div className="position-list" aria-label="Starting positions">
              {positionTickers.map((ticker) => {
                const stock = stocks.find((item) => item.ticker === ticker)
                if (!stock) return null
                const price = priceOn(ticker)
                const value = price === null ? null : sharesOf(ticker) * price

                return (
                  <div key={ticker} className="position-row">
                    <span className="position-company">{stock.company}</span>
                    <label className="position-shares">
                      <span>Shares owned</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={startShares[ticker] ?? '0'}
                        aria-label={`Shares of ${stock.company} owned`}
                        onChange={(event) => touch(() => setStartShares((current) => ({ ...current, [ticker]: event.target.value })))}
                      />
                    </label>
                    <span className="position-value" aria-live="polite">
                      {startDate
                        ? value === null ? 'Price unavailable' : chf(value)
                        : 'Set an opening date to value shares'}
                    </span>
                    <button
                      type="button"
                      className="remove-stock"
                      aria-label={`Remove ${stock.company} starting position`}
                      title={`Remove ${stock.company} starting position`}
                      onClick={() => removePosition(ticker)}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              <p className="muted position-total" role="status">
                {startDate
                  ? holdingsValue === null
                    ? `Some opening-date prices are unavailable for ${displayDate(startDate)}.`
                    : `Total transferred value: ${chf(holdingsValue)} on ${displayDate(startDate)}. Starting capital is added on top.`
                  : 'Enter a portfolio opening date to calculate the transferred value.'}
              </p>
            </div>
          )}
        </fieldset>

        {wanted.length > 0 && !data.ready && <LoadingNote data={data} what="prices" />}
        {previewError && <p className="error" role="alert">{previewError}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={saving || !changed}>
            {portfolio ? 'Save changes' : 'Save portfolio'}
          </button>
          {status && <span className="muted" role="status">{status}</span>}
          {portfolio && changed && <span className="muted">Save to backtest these changes.</span>}

          {portfolio && (
            <span className="danger-zone">
              {confirmingDelete ? (
                <>
                  Delete {portfolio.name}?
                  <button type="button" className="danger" onClick={remove}>Delete</button>
                  <button type="button" className="quiet" onClick={() => setConfirmingDelete(false)}>Keep it</button>
                </>
              ) : (
                <>
                  <button type="button" className="quiet" onClick={() => onCopy(portfolio)}>
                    Copy portfolio
                  </button>
                  <button type="button" className="quiet" onClick={() => setConfirmingDelete(true)}>
                    Delete portfolio
                  </button>
                </>
              )}
            </span>
          )}
        </div>
      </form>
    </section>
  )
}

export default Portfolios
