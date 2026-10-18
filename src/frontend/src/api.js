// Talks to the backend. The address is DEFAULT_API_URL in settings.js unless VITE_API_URL is set.
import { AVERAGE_WINDOWS, DEFAULT_API_URL, ENSURE_BATCH_SIZE } from './settings'

const API_URL = import.meta.env.VITE_API_URL ?? DEFAULT_API_URL

const routes = {
  stocks: '/api/stocks',
  prices: (ticker) => `/api/stocks/${encodeURIComponent(ticker)}/prices`,
  portfolios: '/api/portfolios',
  weights: '/api/portfolios/weights',
  portfolio: (id) => `/api/portfolios/${id}`,
  backtest: (id) => `/api/portfolios/${id}/backtest`,
  plan: (id) => `/api/portfolios/${id}/plan`,
  compare: '/api/portfolios/compare',
  ensure: '/api/stocks/ensure',
  closesOn: '/api/prices/on',
  debugLoading: '/api/debug/loading',
}
const NO_CONTENT = 204

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    // FastAPI puts its explanation in `detail`: a string for our own errors, a list for validation errors.
    const data = await response.json().catch(() => null)
    const detail = Array.isArray(data?.detail) ? data.detail.map((item) => item.msg).join(', ') : data?.detail
    throw new Error(detail ?? `Server responded with ${response.status}`)
  }
  
  return response.status === NO_CONTENT ? null : response.json()
}

export function fetchStocks() {
  return request(routes.stocks)
}

// Start loading prices that are missing or old, and report progress per stock. Call again to poll.
// Long lists are split into batches and the answers merged, so callers get one {states, done, total}.
export async function ensureStocks(tickers) {
  function ensureBatch(batch) {
    return request(routes.ensure, { method: 'POST', body: { tickers: batch } })
  }

  if (tickers.length <= ENSURE_BATCH_SIZE) return ensureBatch(tickers)
  const batches = []
  for (let start = 0; start < tickers.length; start += ENSURE_BATCH_SIZE) {
    batches.push(tickers.slice(start, start + ENSURE_BATCH_SIZE))
  }
  const results = await Promise.all(batches.map(ensureBatch))
  return {
    states: Object.assign({}, ...results.map((result) => result.states)),
    done: results.reduce((sum, result) => sum + result.done, 0),
    total: results.reduce((sum, result) => sum + result.total, 0),
  }
}

// TEMPORARY, for TestLoader.jsx: what is really stored per stock, and the last load job.
export function fetchDebugLoading() {
  return request(routes.debugLoading)
}

// The close on (or just before) a day for each ticker: {ticker: close}.
export function fetchClosesOn(tickers, on) {
  const query = new URLSearchParams({ tickers: tickers.join(','), on })
  return request(`${routes.closesOn}?${query}`)
}

export async function fetchPrices(ticker, interval) {
  const query = new URLSearchParams({ interval, ma: AVERAGE_WINDOWS.join(',') })
  const data = await request(`${routes.prices(ticker)}?${query}`)
  return data.prices
}

export function fetchPortfolios() {
  return request(routes.portfolios)
}

export function previewWeights(draft) {
  return request(routes.weights, { method: 'POST', body: draft })
}

export function savePortfolio(id, portfolio) {
  return id
    ? request(routes.portfolio(id), { method: 'PUT', body: portfolio })
    : request(routes.portfolios, { method: 'POST', body: portfolio })
}

export function deletePortfolio(id) {
  return request(routes.portfolio(id), { method: 'DELETE' })
}

// Blank dates mean the full range, so they are left out of the request.
export function fetchBacktest(id, { start, end }) {
  const query = new URLSearchParams()
  if (start) query.set('start', start)
  if (end) query.set('end', end)
  return request(`${routes.backtest(id)}?${query}`)
}

// Several portfolios on the same days with the same money. Blank dates mean the full common range.
export function fetchCompare(ids, { start, end, initial, inflow, inflowFrequency }) {
  const query = new URLSearchParams({ ids: ids.join(','), initial, inflow, inflow_frequency: inflowFrequency })
  if (start) query.set('start', start)
  if (end) query.set('end', end)
  return request(`${routes.compare}?${query}`)
}

// What the portfolio would buy at its next investing days, up to `until` (blank = the API default).
export function fetchPlan(id, { start, until }) {
  const query = new URLSearchParams()
  if (start) query.set('start', start)
  if (until) query.set('until', until)
  return request(`${routes.plan(id)}?${query}`)
}
