// Talks to the backend. The address is DEFAULT_API_URL in settings.js unless VITE_API_URL is set.
import { AVERAGE_WINDOWS, DEFAULT_API_URL } from './settings'

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

export function fetchBacktest(id, { start, end, initial }) {
  const query = new URLSearchParams({ start, end, initial })
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
export function fetchPlan(id, { start, initial, until }) {
  const query = new URLSearchParams({ start, initial })
  if (until) query.set('until', until)
  return request(`${routes.plan(id)}?${query}`)
}
