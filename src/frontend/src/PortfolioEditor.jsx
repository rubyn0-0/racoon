import { useEffect, useState } from 'react'
import { deletePortfolio, previewWeights, savePortfolio } from './api'
import {
  DEFAULT_WEIGHTING,
  PORTFOLIO_NAME_MAX_LENGTH,
  WEIGHTING,
  WEIGHTINGS,
  chfCompact,
  percent,
} from './shared'
import OptionButtons from './OptionButtons'

const weightingHelp = {
  [WEIGHTING.EQUAL]: 'Every stock gets the same share of the money.',
  [WEIGHTING.MARKET_CAP]: 'Bigger companies get a bigger share, capped at 20% each like the SMI. The cap applies from 5 stocks.',
  [WEIGHTING.MANUAL]: 'Enter any numbers; they are scaled to add up to 100%.',
}
const DEFAULT_WEIGHT = '10'
const PREVIEW_DEBOUNCE_MS = 300

function savedWeights(portfolio) {
  return Object.fromEntries(
    (portfolio?.holdings ?? []).map((holding) => [holding.ticker, holding.weight != null ? String(holding.weight) : DEFAULT_WEIGHT]),
  )
}

function PortfolioEditor({ stocks, portfolio, onSaved, onDeleted }) {
  const [name, setName] = useState(portfolio?.name ?? '')
  const [weighting, setWeighting] = useState(portfolio?.weighting ?? DEFAULT_WEIGHTING)
  const [weights, setWeights] = useState(() => savedWeights(portfolio))
  const [preview, setPreview] = useState({})
  const [previewError, setPreviewError] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const tickers = Object.keys(weights)
  const holdings = tickers.map((ticker) => ({
    ticker,
    weight: weighting === WEIGHTING.MANUAL ? Number(weights[ticker]) || null : null,
  }))
  const draft = { name: name.trim(), weighting, holdings }
  const changed = !portfolio || JSON.stringify(draft) !== JSON.stringify({
    name: portfolio.name,
    weighting: portfolio.weighting,
    holdings: portfolio.holdings.map((holding) => ({
      ticker: holding.ticker,
      weight: portfolio.weighting === WEIGHTING.MANUAL ? holding.weight : null,
    })),
  })
  const holdingsKey = JSON.stringify(holdings)

  // Ask the backend for the resulting weights while editing; it owns the weighting rules.
  useEffect(() => {
    if (tickers.length === 0) return undefined

    let current = true
    const timer = setTimeout(() => {
      previewWeights({ weighting, holdings: JSON.parse(holdingsKey) })
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
  }, [weighting, holdingsKey, tickers.length])

  function toggleStock(ticker) {
    setStatus('')
    setWeights((current) => {
      if (!(ticker in current)) return { ...current, [ticker]: DEFAULT_WEIGHT }
      const next = { ...current }
      delete next[ticker]
      return next
    })
  }

  function changeWeight(ticker, value) {
    setStatus('')
    setWeights((current) => ({ ...current, [ticker]: value }))
  }

  async function save(event) {
    event.preventDefault()

    if (!draft.name) {
      setError('Give the portfolio a name.')
      return
    }
    if (tickers.length === 0) {
      setError('Pick at least one stock.')
      return
    }

    setSaving(true)
    setError('')
    try {
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

      <form className="portfolio-form" onSubmit={save}>
        <label className="field">
          Name
          <input
            type="text"
            value={name}
            maxLength={PORTFOLIO_NAME_MAX_LENGTH}
            placeholder="For example: Swiss defensive"
            onChange={(event) => {
              setName(event.target.value)
              setStatus('')
            }}
          />
        </label>

        <div className="field">
          <OptionButtons
            label="Weighting"
            showLabel
            options={WEIGHTINGS}
            isActive={(id) => weighting === id}
            onSelect={(id) => {
              setWeighting(id)
              setStatus('')
            }}
          />
          <p className="muted">{weightingHelp[weighting]}</p>
        </div>

        <div className="table-scroll">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Stock</th>
                {weighting === WEIGHTING.MANUAL && <th scope="col">Your weight</th>}
                {weighting === WEIGHTING.MARKET_CAP && <th scope="col" className="number">Market cap</th>}
                <th scope="col">Share of portfolio</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((stock) => {
                const included = stock.ticker in weights
                const share = included ? preview[stock.ticker] : undefined

                return (
                  <tr key={stock.ticker} className={included ? undefined : 'excluded'}>
                    <td>
                      <label className="check">
                        <input type="checkbox" checked={included} onChange={() => toggleStock(stock.ticker)} />
                        {stock.company}
                      </label>
                    </td>
                    {weighting === WEIGHTING.MANUAL && (
                      <td>
                        {included && (
                          <input
                            type="number"
                            className="weight-input"
                            min="0"
                            step="any"
                            value={weights[stock.ticker]}
                            aria-label={`Weight for ${stock.company}`}
                            onChange={(event) => changeWeight(stock.ticker, event.target.value)}
                          />
                        )}
                      </td>
                    )}
                    {weighting === WEIGHTING.MARKET_CAP && (
                      <td className="number muted">{stock.market_cap ? chfCompact(stock.market_cap) : 'Not loaded'}</td>
                    )}
                    <td>
                      {share !== undefined && !previewError && (
                        <span className="share">
                          <span className="share-bar" aria-hidden="true">
                            <span style={{ width: percent(share) }} />
                          </span>
                          {percent(share)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

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
                <button type="button" className="quiet" onClick={() => setConfirmingDelete(true)}>
                  Delete portfolio
                </button>
              )}
            </span>
          )}
        </div>
      </form>
    </section>
  )
}

export default PortfolioEditor
