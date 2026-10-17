/* eslint-disable react-refresh/only-export-components -- this file also holds the one shared button component */
// Small tools the screens share: number and date formatting, chart layout pieces, and the button row.
// Nothing here is a screen. Values to tweak live in settings.js; this file only uses them.
import {
  AVERAGE_WINDOWS,
  CHART_FONT_SIZE,
  CHART_HEIGHT,
  CSS_VARIABLES,
  CURRENCY,
  INFLOW_FREQUENCIES,
  INTERVALS,
  INVEST_FREQUENCIES,
  LOCALE,
  MARGIN_BOTTOM,
  MARGIN_TOP,
  WEIGHTINGS,
  theme,
} from './settings'

// Numbers and money
const wholeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const priceFormat = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export function chf(value) {
  return `${CURRENCY} ${wholeFormat.format(value)}`
}

export function chfCompact(value) {
  return `${CURRENCY} ${compactFormat.format(value)}`
}

// 1.2M, 340K: for company sizes and share counts.
export function compact(value) {
  return compactFormat.format(value)
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

// Moving averages. The API names a moving-average column `ma<window>`.
export const averageKey = (window) => `ma${window}`
export const averageLabel = (window) => `MA ${window}`
export const AVERAGE_OPTIONS = AVERAGE_WINDOWS.map((window) => ({ id: window, label: averageLabel(window) }))

// Dates. The API sends `YYYY-MM-DD` dates, and aggregated rows `YYYY-MM-DD HH:MM`.
const DAY_MS = 86400000
const DATE_LENGTH = 'YYYY-MM-DD'.length
const AXIS_DATE_LENGTH = 'YYYY-MM-DDTHH:MM'.length
// Daily candles sit at noon: weekends are cut out of the daily axis, so a midnight bar would lose half its width.
const NOON = '12:00'

export const dateOnly = (value) => value.slice(0, DATE_LENGTH)
export const utcMidnight = (value) => new Date(`${dateOnly(value)}T00:00:00Z`)
export const daysBetween = (from, to) => Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS)
const noonOf = (date) => `${dateOnly(date)} ${NOON}`

// Plotly date-axis string, `YYYY-MM-DD HH:MM`.
const toAxisDate = (date) => date.toISOString().slice(0, AXIS_DATE_LENGTH).replace('T', ' ')

// Every candle sits in the middle of its period: `center` from the API, or noon for a daily row.
export const candleCenter = (row) => row.center ?? noonOf(row.date)

// Look-ups by id for the names shown in tables and notes.
export const weightingById = Object.fromEntries(WEIGHTINGS.map((weighting) => [weighting.id, weighting]))
export const frequencyById = Object.fromEntries([...INVEST_FREQUENCIES, ...INFLOW_FREQUENCIES].map((item) => [item.id, item]))

export const intervalById = Object.fromEntries(INTERVALS.map((interval) => [interval.id, interval]))

// European dates: 17.10.2026.
export function displayDate(value) {
  const [year, month, day] = dateOnly(value).split('-')
  return `${day}.${month}.${year}`
}

// ISO week number (weeks start on Monday, week 1 holds the first Thursday).
function isoWeek(date) {
  const thursday = new Date(date)
  thursday.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1)
  return { week: Math.ceil(((thursday - yearStart) / DAY_MS + 1) / 7), year: thursday.getUTCFullYear() }
}

const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// A candle's period in words that fit the chosen interval: a date, 'Week 42, 2026', 'October 2026' or '2026'.
export function periodLabel(row, interval) {
  if (interval === 'day') return displayDate(row.date)

  const center = utcMidnight(candleCenter(row))
  if (interval === 'week') {
    const { week, year } = isoWeek(center)
    return `Week ${week}, ${year}`
  }
  if (interval === 'month') return monthFormat.format(center)
  return String(center.getUTCFullYear())
}

const isLeapYear = (year) => new Date(Date.UTC(year, 2, 0)).getUTCDate() === 29
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

function periodDays(interval, year, month) {
  const { days } = intervalById[interval]

  if (days === 'month') return daysInMonth(year, month)
  if (days === 'year') return isLeapYear(year) ? 366 : 365
  return days
}

// How wide a period is on screen. Candle bodies and volume bars both use it, so every interval
// is drawn the same way and neighbouring periods always touch.
export function periodMs(row, interval) {
  const [year, month] = dateOnly(candleCenter(row)).split('-').map(Number)
  return periodDays(interval, year, month) * DAY_MS
}

// The time axis spans the data: from the left edge of the first candle to the right edge of the last.
// Anything narrower cuts a candle in half, and a wide period (a year) shows it most.
export function dataBounds(rows, interval) {
  const first = rows[0]
  const last = rows[rows.length - 1]
  const centerMs = (row) => new Date(`${candleCenter(row).replace(' ', 'T')}:00Z`).getTime()

  return [
    toAxisDate(new Date(centerMs(first) - periodMs(first, interval) / 2)),
    toAxisDate(new Date(centerMs(last) + periodMs(last, interval) / 2)),
  ]
}

// Chart layout pieces both charts start from; each chart overrides only what differs.
export const margin = (left, right) => ({ l: left, r: right, t: MARGIN_TOP, b: MARGIN_BOTTOM })
export const legend = (y) => ({ orientation: 'h', x: 0, y, font: { color: theme.ink } })

export const baseLayout = {
  autosize: true,
  paper_bgcolor: theme.surface,
  plot_bgcolor: theme.surface,
  font: { family: theme.font, size: CHART_FONT_SIZE, color: theme.muted },
  dragmode: 'pan',
  hovermode: 'x unified',
  hoverlabel: { font: { family: theme.font, color: theme.ink }, bgcolor: theme.surface, bordercolor: theme.hairline },
}

export const baseXAxis = {
  type: 'date',
  showgrid: false,
  showline: true,
  linecolor: theme.hairline,
  showspikes: true,
  spikemode: 'across',
  spikethickness: 1,
  spikedash: 'dot',
  spikecolor: theme.muted,
}

export const baseYAxis = { gridcolor: theme.hairline, zeroline: false }

export const plotConfig = { responsive: true, displaylogo: false, scrollZoom: true }
export const plotStyle = { width: '100%' }

// Publishes the colors, the font and the chart height to the stylesheet as CSS variables. Run once at start-up.
export function applyThemeVariables() {
  const root = document.documentElement.style
  const variables = {
    ...Object.fromEntries(Object.entries(CSS_VARIABLES).map(([name, key]) => [name, theme[key]])),
    'chart-height': `${CHART_HEIGHT}px`,
  }

  Object.entries(variables).forEach(([name, value]) => root.setProperty(`--${name}`, value))
}

// A row of segmented buttons. Without isActive the buttons are plain actions, not toggles.
export function OptionButtons({ label, options, isActive, onSelect, showLabel = false, disabled = false }) {
  return (
    <div className="option-group" role="group" aria-label={label}>
      {showLabel && <span className="option-label">{label}</span>}
      <div className="segmented">
        {options.map((option) => {
          const active = isActive?.(option.id)

          return (
            <button
              key={option.id}
              type="button"
              className={active ? 'segment active' : 'segment'}
              aria-pressed={isActive ? active : undefined}
              disabled={disabled}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
