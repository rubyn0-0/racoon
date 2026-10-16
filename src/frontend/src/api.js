import { averageWindows } from './chartTheme'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

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

  return response.status === 204 ? null : response.json()
}

export function fetchStocks() {
  return request('/api/stocks')
}

export async function fetchPrices(ticker, interval) {
  const query = new URLSearchParams({ interval, ma: averageWindows.join(',') })
  const data = await request(`/api/stocks/${encodeURIComponent(ticker)}/prices?${query}`)
  return data.prices
}

export function fetchPortfolios() {
  return request('/api/portfolios')
}

export function previewWeights(draft) {
  return request('/api/portfolios/weights', { method: 'POST', body: draft })
}

export function savePortfolio(id, portfolio) {
  return id
    ? request(`/api/portfolios/${id}`, { method: 'PUT', body: portfolio })
    : request('/api/portfolios', { method: 'POST', body: portfolio })
}

export function deletePortfolio(id) {
  return request(`/api/portfolios/${id}`, { method: 'DELETE' })
}

export function fetchBacktest(id, { start, end, initial, monthly, reinvest }) {
  const query = new URLSearchParams({ start, end, initial, monthly, reinvest })
  return request(`/api/portfolios/${id}/backtest?${query}`)
}
