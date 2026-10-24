/* eslint-disable react-refresh/only-export-components -- this file also holds the one shared button component */
// Small tools the screens share: number and date formatting, chart layout pieces, and the button row.
// Nothing here is a screen. Values to tweak live in settings.js; this file only uses them.
import { useEffect, useId, useRef, useState } from 'react'
import { ensureStocks } from './api'
import {
  AVERAGE_WINDOWS,
  CHART_FONT_SIZE,
  CHART_HEIGHT,
  CSS_VARIABLES,
  CURRENCY,
  INFLOW_FREQUENCIES,
  INTERVALS,
  INVEST_FREQUENCIES,
  LOAD_POLL_MS,
  LOCALE,
  MARGIN_BOTTOM,
  MARGIN_TOP,
  SEARCH_VISIBLE_ROWS,
  TYPE_TOKENS,
  WEIGHTINGS,
  WINDOW_PADDING,
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

// Accept a precise Swiss-style date or just a month/year or year. Partial dates
// resolve to the first day of that period.
export function parseEditableDate(value) {
  const input = value.trim()
  if (!input) return { date: null, error: '' }

  let day = 1
  let month = 1
  let year
  let match

  if ((match = input.match(/^(\d{4})$/))) {
    year = Number(match[1])
  } else if ((match = input.match(/^(\d{1,2})\.(\d{4})$/))) {
    month = Number(match[1])
    year = Number(match[2])
  } else if ((match = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) {
    day = Number(match[1])
    month = Number(match[2])
    year = Number(match[3])
  } else {
    return { date: null, error: 'Use YYYY, MM.YYYY, or DD.MM.YYYY.' }
  }

  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    return { date: null, error: 'Enter a valid date.' }
  }

  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    error: '',
  }
}

export function editableDateValue(date) {
  return date ? displayDate(date) : ''
}

const DATE_SEGMENTS = [
  { id: 'day', start: 0, end: 2, width: 2 },
  { id: 'month', start: 3, end: 5, width: 2 },
  { id: 'year', start: 6, end: 10, width: 4 },
]

function dateSegmentAt(position) {
  if (position <= 2) return DATE_SEGMENTS[0]
  if (position <= 5) return DATE_SEGMENTS[1]
  return DATE_SEGMENTS[2]
}

function adjustedDate(date, segment, amount) {
  const [year, month, day] = date.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day))

  if (segment.id === 'day') {
    result.setUTCDate(result.getUTCDate() + amount)
  } else if (segment.id === 'month') {
    result.setUTCDate(1)
    result.setUTCMonth(result.getUTCMonth() + amount)
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
    result.setUTCDate(Math.min(day, lastDay))
  } else {
    const nextYear = Math.min(9999, Math.max(1, year + amount))
    result.setUTCDate(1)
    result.setUTCFullYear(nextYear)
    const lastDay = new Date(Date.UTC(nextYear, month, 0)).getUTCDate()
    result.setUTCDate(Math.min(day, lastDay))
  }

  return result.toISOString().slice(0, 10)
}

export function EditableDateField({ label, value, onChange, onCommit }) {
  const inputRef = useRef(null)
  const pickerRef = useRef(null)
  const segmentEdit = useRef({ id: null, digits: '' })
  const pointerFocus = useRef(false)
  const [blurred, setBlurred] = useState(false)
  const parsed = parseEditableDate(value)
  const invalid = blurred && Boolean(value.trim()) && Boolean(parsed.error)

  function selectSegment(segment) {
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(segment.start, segment.end))
  }

  function openPicker() {
    const picker = pickerRef.current
    if (!picker) return
    try {
      if (picker.showPicker) {
        picker.showPicker()
        return
      }
    } catch {
      // showPicker can refuse (e.g. without a user gesture); fall back to clicking the input
    }
    picker.focus()
    picker.click()
  }

  function handlePicked(event) {
    const iso = event.target.value
    if (!iso) return
    setBlurred(false)
    onChange(editableDateValue(iso))
    onCommit?.(iso)
  }

  function handleMouseUp(event) {
    const input = event.currentTarget
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value) || input.selectionStart !== input.selectionEnd) return
    const segment = dateSegmentAt(input.selectionStart)
    segmentEdit.current = { id: segment.id, digits: '' }
    event.preventDefault()
    input.setSelectionRange(segment.start, segment.end)
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (parsed.error) {
        setBlurred(true)
        return
      }
      event.currentTarget.blur()
      return
    }

    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return

    const input = event.currentTarget
    const wholeDateSelected = input.selectionStart === 0 && input.selectionEnd === value.length
    if (wholeDateSelected && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return

    const current = dateSegmentAt(input.selectionStart)
    const currentIndex = DATE_SEGMENTS.findIndex((segment) => segment.id === current.id)

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const next = DATE_SEGMENTS[Math.min(DATE_SEGMENTS.length - 1, Math.max(0, currentIndex + direction))]
      segmentEdit.current = { id: next.id, digits: '' }
      selectSegment(next)
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!parsed.date) return
      event.preventDefault()
      onChange(editableDateValue(adjustedDate(parsed.date, current, event.key === 'ArrowUp' ? 1 : -1)))
      segmentEdit.current = { id: current.id, digits: '' }
      selectSegment(current)
      return
    }

    if (!/^\d$/.test(event.key) || input.selectionStart !== current.start || input.selectionEnd !== current.end) return

    event.preventDefault()
    const previous = segmentEdit.current.id === current.id ? segmentEdit.current.digits : ''
    const digits = previous.length >= current.width ? event.key : previous + event.key
    segmentEdit.current = { id: current.id, digits }
    const replacement = digits.padStart(current.width, '0')
    onChange(`${value.slice(0, current.start)}${replacement}${value.slice(current.end)}`)
    selectSegment(current)
  }

  return (
    <label className="field">
      {label}
      <span className="date-input">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={value}
          placeholder="DD.MM.YYYY"
          className={invalid ? 'input-error' : undefined}
          aria-invalid={invalid}
          onFocus={(event) => {
            setBlurred(false)
            segmentEdit.current = { id: null, digits: '' }
            if (!pointerFocus.current) event.currentTarget.select()
            requestAnimationFrame(() => {
              pointerFocus.current = false
            })
          }}
          onMouseDown={() => {
            pointerFocus.current = true
          }}
          onMouseUp={handleMouseUp}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setBlurred(true)
            if (!parsed.error) {
              if (parsed.date) onChange(editableDateValue(parsed.date))
              onCommit?.(parsed.date ?? '')
            }
          }}
          onChange={(event) => {
            segmentEdit.current = { id: null, digits: '' }
            onChange(event.target.value)
          }}
        />
        <button
          type="button"
          className="date-picker-button"
          aria-label={`Choose ${label} from calendar`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault()
            openPicker()
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </button>
        <input
          ref={pickerRef}
          type="date"
          className="date-picker-native"
          tabIndex={-1}
          aria-hidden="true"
          value={parsed.date ?? ''}
          onChange={handlePicked}
        />
      </span>
    </label>
  )
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
// The one font every chart text starts from; a text that needs another colour spreads it: { ...chartFont, color }.
export const chartFont = { family: theme.font, size: CHART_FONT_SIZE, color: theme.muted }
export const legend = (y) => ({ orientation: 'h', x: 0, y, font: { ...chartFont, color: theme.ink } })

export const baseLayout = {
  autosize: true,
  paper_bgcolor: theme.surface,
  plot_bgcolor: theme.surface,
  font: chartFont,
  dragmode: 'pan',
  hovermode: 'x unified',
  hoverlabel: { font: { ...chartFont, color: theme.ink }, bgcolor: theme.surface, bordercolor: theme.hairline },
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
    ...TYPE_TOKENS,
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

// Forms use Enter to commit the ordinary field being edited, not to submit the
// whole form. Search boxes keep Enter for choosing an autocomplete result.
export function commitInputOnEnter(event) {
  if (event.key !== 'Enter' || event.defaultPrevented || event.target.tagName !== 'INPUT') return
  if (!['text', 'number', 'date'].includes(event.target.type)) return

  event.preventDefault()
  if (!event.target.checkValidity()) {
    event.target.reportValidity()
    return
  }
  event.target.blur()
}

// Loading prices on demand. The backend fetches a stock's history the first time something asks for it.
// This hook asks (and keeps asking once a second) until every stock is there, then calls `onChange` once
// so the screen can refresh what it knows about the stocks (dates, sizes) and drop any cached prices.
export function useStockData(tickers, onChange) {
  const key = [...new Set(tickers)].sort().join(',')
  const [status, setStatus] = useState({ key: '', ready: false, done: 0, total: 0, error: '' })
  const [attempt, setAttempt] = useState(0)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (!key) return undefined

    let active = true
    let timer
    let waited = false

    async function poll() {
      try {
        const result = await ensureStocks(key.split(','))
        if (!active) return

        const states = Object.values(result.states)
        const failed = states.find((state) => state.state === 'error')
        const loading = states.some((state) => state.state === 'loading')
        const refreshing = states.some((state) => state.refreshing)
        setStatus({ key, ready: !loading && !failed, done: result.done, total: result.total, error: failed?.error ?? '' })

        if (loading || refreshing) {
          waited = true
          timer = setTimeout(poll, LOAD_POLL_MS)
        } else if (waited) {
          onChangeRef.current?.()
        }
      } catch (err) {
        if (active) setStatus({ key, ready: false, done: 0, total: 0, error: err.message })
      }
    }

    poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [key, attempt])

  const retry = () => setAttempt((count) => count + 1)
  if (!key) return { ready: true, done: 0, total: 0, error: '', retry }
  return { ...status, ready: status.key === key && status.ready, error: status.key === key ? status.error : '', retry }
}

// Loads these stocks now and resolves once they are all there. `onProgress` gets the result of every poll,
// and a failed stock throws. Used by the buttons that need prices (Run backtest, Run comparison, Save).
export async function waitForStocks(tickers, onProgress) {
  for (;;) {
    const result = await ensureStocks(tickers)
    onProgress?.(result)

    const states = Object.values(result.states)
    const failed = states.find((state) => state.state === 'error')
    if (failed) throw new Error(failed.error)
    if (!states.some((state) => state.state === 'loading')) return result

    await new Promise((resolve) => setTimeout(resolve, LOAD_POLL_MS))
  }
}

// The message shown instead of a chart or result while prices are still being fetched.
export function LoadingNote({ data, what }) {
  if (data.error) {
    return (
      <p className="error" role="alert">
        Could not load {what}: {data.error}
        <button type="button" className="quiet" onClick={data.retry}>Try again</button>
      </p>
    )
  }

  return (
    <p className="chart-loading" role="status">
      Loading {what}{data.total > 1 ? ` (${data.done} of ${data.total})` : ''}…
    </p>
  )
}

// A search box over the stock list: type a name or ticker, pick from the list (current SMI members first).
// When closed the box shows the name of the chosen stock; with `clearOnSelect` it empties after a pick.
export function StockSearch({
  stocks,
  value,
  onSelect,
  label,
  placeholder = 'Search name or ticker',
  clearOnSelect = false,
  excludedTickers = [],
  maxResults = null,
  visibleRows = SEARCH_VISIBLE_ROWS,
}) {
  const listId = useId()
  const listRef = useRef(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const chosen = stocks.find((stock) => stock.ticker === value)
  const needle = query.trim().toLowerCase()
  const excluded = new Set(excludedTickers)
  const matches = stocks.filter((stock) => (
    !excluded.has(stock.ticker)
    && (!needle || stock.company.toLowerCase().includes(needle) || stock.ticker.toLowerCase().includes(needle))
  ))
  const results = maxResults === null ? matches : matches.slice(0, maxResults)

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function pick(stock) {
    onSelect(stock.ticker)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && open && results[active]) {
      event.preventDefault()
      pick(results[active])
    } else if (event.key === 'Tab' && open && results[active] && query.trim() && !event.shiftKey) {
      // no preventDefault: focus still moves on, the highlighted stock is picked on the way out
      pick(results[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="stock-search">
      <label className="field">
        {label}
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={open || clearOnSelect ? query : (chosen?.company ?? '')}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {open && (
        <ul
          ref={listRef}
          className="search-results"
          id={listId}
          role="listbox"
          style={{ '--search-visible-rows': visibleRows }}
        >
          {results.length === 0 && <li className="muted" role="option" aria-disabled="true">No stock matches.</li>}
          {results.map((stock, index) => (
            <li
              key={stock.ticker}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'active' : undefined}
              // mouse down, not click: the box would lose focus (and close the list) before a click lands
              onMouseDown={(event) => {
                event.preventDefault()
                pick(stock)
              }}
            >
              <span>{stock.company}</span>
              <span className="muted"> {stock.ticker.replace(/\.SW$/, '')}</span>
              {stock.in_smi && <span className="badge">SMI</span>}
              {!stock.loaded && <span className="muted"> not loaded yet</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Why a test is shorter than asked: the stock that was listed last decides where it can start.
export function LimitNote({ limitedBy }) {
  if (!limitedBy) return null

  return (
    <p className="muted" role="status">
      Stock data for {limitedBy.company} is only available from {displayDate(limitedBy.date)}. Remove it to use a
      longer time frame.
    </p>
  )
}

// A range widened by `WINDOW_PADDING` of its length on each side, as plotly date strings.
export function paddedRange([start, end]) {
  const first = utcMidnight(start).getTime()
  const last = utcMidnight(end).getTime()
  const pad = (last - first) * WINDOW_PADDING
  return [toAxisDate(new Date(first - pad)), toAxisDate(new Date(last + pad))]
}

// Only the rows near the visible range: drawing 25 years of candles at once would make zooming sluggish.
export function windowRows(rows, range) {
  const [start, end] = paddedRange(range)
  return rows.filter((row) => row.date >= dateOnly(start) && row.date <= dateOnly(end))
}
