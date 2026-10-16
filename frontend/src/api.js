const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

async function getJson(path) {
  const response = await fetch(`${API_URL}${path}`)

  if (!response.ok) {
    throw new Error(`Server responded with ${response.status}`)
  }

  return response.json()
}

export function fetchStocks() {
  return getJson('/api/stocks')
}

export async function fetchPrices(ticker) {
  const data = await getJson(`/api/stocks/${encodeURIComponent(ticker)}/prices`)
  return data.prices
}
