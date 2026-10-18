// Dev tool, shown only in npm run dev, unless VITE_DEV_TOOLS=0 (frontend .env). It needs DEV_TOOLS=1 in the backend .env for /api/debug/loading.
// The red button loads every stock in the CSV through the normal on-demand loader and shows, per stock,
// what is really in the database (not what the screens believe), so loading can be checked by eye.
import { useState } from 'react'
import { fetchDebugLoading } from './api'
import { displayDate, waitForStocks } from './helpers'

const REFRESH_MS = 1000

function stateOf(row) {
  if (row.job?.state) return row.job.state
  return row.rows > 0 ? 'in database' : 'empty'
}

function TestLoader({ stocks, onStocksChanged }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(null)
  const [error, setError] = useState('')

  async function refresh() {
    setRows(await fetchDebugLoading())
  }

  async function loadEverything() {
    setOpen(true)
    setRunning(true)
    setError('')
    setSeconds(null)
    const started = performance.now()
    const timer = setInterval(() => refresh().catch(() => {}), REFRESH_MS)

    try {
      await waitForStocks(stocks.map((stock) => stock.ticker))
      onStocksChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      clearInterval(timer)
      await refresh().catch(() => {})
      setSeconds((performance.now() - started) / 1000)
      setRunning(false)
    }
  }

  const withData = rows.filter((row) => row.rows > 0).length
  const totalRows = rows.reduce((sum, row) => sum + row.rows, 0)

  return (
    <section className="test-loader" aria-label="Temporary loading test">
      <button type="button" className="test-button" onClick={loadEverything} disabled={running}>
        {running ? 'Loading every stock…' : 'TEST: load every stock from the CSV'}
      </button>
      {open && (
        <button type="button" className="quiet" onClick={() => setOpen(false)}>Hide table</button>
      )}

      {open && (
        <>
          <p className="muted" role="status">
            {withData} of {rows.length} stocks have prices, {totalRows.toLocaleString('de-CH')} rows in the database
            {seconds != null && `, finished in ${seconds.toFixed(1)} s`}.
          </p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="table-scroll">
            <table className="holdings-table">
              <thead>
                <tr>
                  <th scope="col">Ticker</th>
                  <th scope="col">Company</th>
                  <th scope="col">State</th>
                  <th scope="col" className="number">Rows in database</th>
                  <th scope="col">First day</th>
                  <th scope="col">Last day</th>
                  <th scope="col" className="number">Load seconds</th>
                  <th scope="col" className="number">Rows fetched</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.ticker} className={row.rows !== row.summary_rows ? 'mismatch' : undefined}>
                    <td>{row.ticker}</td>
                    <td>{row.company}{row.in_smi && <span className="badge">SMI</span>}</td>
                    <td>{stateOf(row)}{row.job?.error && ` (${row.job.error})`}{row.job?.stuck && ` (stuck? waiting ${row.job.waiting_seconds} s)`}</td>
                    <td className="number">
                      {row.rows.toLocaleString('de-CH')}
                      {row.rows !== row.summary_rows && ` (summary says ${row.summary_rows})`}
                    </td>
                    <td>{row.first ? displayDate(row.first) : '–'}</td>
                    <td>{row.last ? displayDate(row.last) : '–'}</td>
                    <td className="number">{row.job?.seconds ?? '–'}</td>
                    <td className="number">{row.job?.fetched ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

export default TestLoader
