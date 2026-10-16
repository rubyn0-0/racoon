function getPeriodKey(dateString, interval) {
  if (interval === 'year') return dateString.slice(0, 4)
  if (interval === 'month') return dateString.slice(0, 7)

  const date = new Date(`${dateString}T00:00:00Z`)
  const day = date.getUTCDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  date.setUTCDate(date.getUTCDate() - daysFromMonday)
  return date.toISOString().slice(0, 10)
}

export function aggregatePrices(prices, interval) {
  if (interval === 'day') return prices

  const periods = new Map()

  prices.forEach((price) => {
    const key = getPeriodKey(price.date, interval)
    const period = periods.get(key)

    if (!period) {
      periods.set(key, { ...price })
      return
    }

    period.date = price.date
    period.high = Math.max(period.high, price.high)
    period.low = Math.min(period.low, price.low)
    period.close = price.close
    period.adjusted_close = price.adjusted_close
    period.volume = (period.volume ?? 0) + (price.volume ?? 0)
    period.dividends = (period.dividends ?? 0) + (price.dividends ?? 0)
    period.stock_splits = (period.stock_splits ?? 0) + (price.stock_splits ?? 0)
  })

  return Array.from(periods.values())
}
