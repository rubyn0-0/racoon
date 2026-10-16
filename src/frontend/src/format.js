const chfFormat = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 })
const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export function chf(value) {
  return `CHF ${chfFormat.format(value)}`
}

export function chfCompact(value) {
  return `CHF ${compactFormat.format(value)}`
}

export function percent(share, digits = 1) {
  return `${(share * 100).toFixed(digits)}%`
}

export function signedPercent(share) {
  const sign = share >= 0 ? '+' : '−'
  return `${sign}${Math.abs(share * 100).toFixed(1)}%`
}
