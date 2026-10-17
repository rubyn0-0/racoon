import { useEffect, useState } from 'react'
import { fetchPortfolios } from './api'
import BacktestPanel from './BacktestPanel'
import { NEW_PORTFOLIO, weightingById } from './shared'
import PortfolioEditor from './PortfolioEditor'

function PortfolioPage({ stocks }) {
  const [portfolios, setPortfolios] = useState(null)
  const [selectedId, setSelectedId] = useState(NEW_PORTFOLIO)
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

  function handleSaved(saved) {
    setPortfolios((current) => {
      const others = current.filter((portfolio) => portfolio.id !== saved.id)
      return [...others, saved].sort((a, b) => a.name.localeCompare(b.name))
    })
    setSelectedId(saved.id)
  }

  function handleDeleted(id) {
    const remaining = portfolios.filter((portfolio) => portfolio.id !== id)
    setPortfolios(remaining)
    setSelectedId(remaining[0]?.id ?? NEW_PORTFOLIO)
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!portfolios) return <p className="muted">Loading portfolios…</p>

  return (
    <div className="portfolio-layout">
      <aside className="portfolio-list" aria-label="Saved portfolios">
        <button
          type="button"
          className={selectedId === NEW_PORTFOLIO ? 'list-item active' : 'list-item'}
          onClick={() => setSelectedId(NEW_PORTFOLIO)}
        >
          <span className="list-title">New portfolio</span>
        </button>
        {portfolios.map((portfolio) => (
          <button
            key={portfolio.id}
            type="button"
            className={selectedId === portfolio.id ? 'list-item active' : 'list-item'}
            aria-current={selectedId === portfolio.id ? 'true' : undefined}
            onClick={() => setSelectedId(portfolio.id)}
          >
            <span className="list-title">{portfolio.name}</span>
            <span className="list-meta">
              {portfolio.holdings.length} {portfolio.holdings.length === 1 ? 'stock' : 'stocks'}, {weightingById[portfolio.weighting].name.toLowerCase()}
            </span>
          </button>
        ))}
      </aside>

      <div className="portfolio-main">
        <PortfolioEditor
          // A fresh editor per portfolio, so switching never mixes two drafts.
          key={selected?.id ?? NEW_PORTFOLIO}
          stocks={stocks}
          portfolio={selected}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
        {selected && (
          <BacktestPanel
            // Re-run from scratch whenever the saved holdings change.
            key={`${selected.id}-${JSON.stringify(selected.holdings)}-${selected.weighting}`}
            stocks={stocks}
            portfolio={selected}
          />
        )}
      </div>
    </div>
  )
}

export default PortfolioPage
