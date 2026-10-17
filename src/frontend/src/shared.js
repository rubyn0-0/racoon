import { averageWindows } from './chart'

// Formatting.
export const CURRENCY = 'CHF'
const LOCALE = 'de-CH'

const wholeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const priceFormat = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export function chf(value) {
  return `${CURRENCY} ${wholeFormat.format(value)}`
}

export function chfCompact(value) {
  return `${CURRENCY} ${compactFormat.format(value)}`
}

export function price(value) {
  return priceFormat.format(value)
}

export function percent(share, digits = 1) {
  return `${(share * 100).toFixed(digits)}%`
}

export function signedPercent(share) {
  const sign = share >= 0 ? '+' : '−'
  return `${sign}${Math.abs(share * 100).toFixed(1)}%`
}

// CSS class for a gain or loss.
export function changeClass(value) {
  return value >= 0 ? 'change up' : 'change down'
}

// Dates. The API sends `YYYY-MM-DD` dates, and aggregated rows `YYYY-MM-DD HH:MM`.
export const DAY_MS = 86400000

const DATE_LENGTH = 'YYYY-MM-DD'.length
const AXIS_DATE_LENGTH = 'YYYY-MM-DDTHH:MM'.length
// Daily candles sit at noon: weekends are cut out of the daily axis, so a midnight bar would lose half its width.
const NOON = '12:00'

export const dateOnly = (value) => value.slice(0, DATE_LENGTH)
export const utcMidnight = (value) => new Date(`${dateOnly(value)}T00:00:00Z`)
export const noonOf = (date) => `${dateOnly(date)} ${NOON}`

// Plotly date-axis string, `YYYY-MM-DD HH:MM`.
export const toAxisDate = (date) => date.toISOString().slice(0, AXIS_DATE_LENGTH).replace('T', ' ')

// Every candle sits in the middle of its period: `center` from the API, or noon for a daily row.
export const candleCenter = (price) => price.center ?? noonOf(price.date)

// How wide a period is on screen. Candle bodies and volume bars both use it, so every interval
// is drawn the same way and neighbouring periods always touch.
export function periodMs(price, interval) {
  const [year, month] = dateOnly(candleCenter(price)).split('-').map(Number)
  return intervalById[interval].daysIn(year, month) * DAY_MS
}

// The time axis spans the data: from the left edge of the first candle to the right edge of the last.
// Anything narrower cuts a candle in half, and a wide period (a year) shows it most.
export function dataBounds(prices, interval) {
  const first = prices[0]
  const last = prices[prices.length - 1]
  const centerMs = (price) => new Date(`${candleCenter(price).replace(' ', 'T')}:00Z`).getTime()

  return [
    toAxisDate(new Date(centerMs(first) - periodMs(first, interval) / 2)),
    toAxisDate(new Date(centerMs(last) + periodMs(last, interval) / 2)),
  ]
}

// Names and defaults, so a string or number that several files agree on is written once.
const isLeapYear = (year) => new Date(Date.UTC(year, 2, 0)).getUTCDate() === 29
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

// `daysIn(year, month)` is the real length of the period a candle covers.
export const INTERVALS = [
  { id: 'day', label: 'Day', daysIn: () => 1, hoverFormat: '%d %b %Y' },
  { id: 'week', label: 'Week', daysIn: () => 7, hoverFormat: 'Week %V, %Y' },
  { id: 'month', label: 'Month', daysIn: daysInMonth, hoverFormat: '%b %Y' },
  {
    id: 'year',
    label: 'Year',
    daysIn: (year) => (isLeapYear(year) ? 366 : 365),
    hoverFormat: '%Y',
  },
]
export const intervalById = Object.fromEntries(INTERVALS.map((interval) => [interval.id, interval]))

// Daily rows are the finest data we have; they answer "was there trading in this range" for any interval.
export const DAILY_INTERVAL = 'day'
export const DEFAULT_INTERVAL = DAILY_INTERVAL

export const CHART_TYPE = { CANDLES: 'candles', LINE: 'line' }
export const CHART_TYPES = [
  { id: CHART_TYPE.CANDLES, label: 'Candles' },
  { id: CHART_TYPE.LINE, label: 'Line' },
]
export const DEFAULT_CHART_TYPE = CHART_TYPE.CANDLES

export const CHART_MODE = { FREE_PAN: 'free-pan', FULL_RANGE: 'full-range', FITTED: 'fitted' }
export const CHART_MODES = [
  { id: CHART_MODE.FREE_PAN, label: 'Free pan' },
  { id: CHART_MODE.FULL_RANGE, label: 'Full range' },
  { id: CHART_MODE.FITTED, label: 'Fitted' },
]
export const DEFAULT_CHART_MODE = CHART_MODE.FITTED

export const START_BEFORE_END_ERROR = 'The start date must be before the end date.'

// Backtest form: inputs are strings because they come from <input>, and the API accepts them as given.
export const BACKTEST_DEFAULTS = { initial: '10000', monthly: '0', reinvest: true }
export const BACKTEST_STEPS = { initial: 100, monthly: 50 }

// The API names a moving-average column `ma<window>`.
export const averageKey = (window) => `ma${window}`
export const averageLabel = (window) => `MA ${window}`
export const AVERAGE_OPTIONS = averageWindows.map((window) => ({ id: window, label: averageLabel(window) }))

// Portfolio weighting schemes; the ids are the values the API stores. `label` is the editor button, `name` the list text.
export const WEIGHTING = { EQUAL: 'equal', MARKET_CAP: 'market_cap', MANUAL: 'manual' }
export const WEIGHTINGS = [
  { id: WEIGHTING.EQUAL, label: 'Equal', name: 'Equal weight' },
  { id: WEIGHTING.MARKET_CAP, label: 'Market cap (SMI style)', name: 'Market cap' },
  { id: WEIGHTING.MANUAL, label: 'Your weights', name: 'Your weights' },
]
export const weightingById = Object.fromEntries(WEIGHTINGS.map((weighting) => [weighting.id, weighting]))
export const DEFAULT_WEIGHTING = WEIGHTING.EQUAL

// Id of the "New portfolio" entry, which has no saved portfolio behind it.
export const NEW_PORTFOLIO = 'new'

// Mirrors the API limit on a portfolio name (NAME_MAX_LENGTH in the backend).
export const PORTFOLIO_NAME_MAX_LENGTH = 80
