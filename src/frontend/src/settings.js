// Every value you might want to tweak: colors, chart sizes, labels, defaults, messages.
// This file holds plain values only, with no logic. To change how something looks or what it is called,
// look here first. The logic that uses these values is in helpers.jsx and the screen files.

// Colors. Plotly cannot read CSS, so the charts use `theme` directly and helpers.jsx publishes
// the same values to the stylesheet as CSS variables (see CSS_VARIABLES below).
const palette = {
  ground: '#0d1117',
  surface: '#161b22',
  ink: '#e6edf3',
  muted: '#8b949e',
  hairline: '#30363d',
  blue: '#6c8cff',
  green: '#26c281',
  red: '#f0544a',
  amber: '#f0a30a',
  errorBackground: '#3a1a18',
  errorText: '#ff9a92',
  buttonHover: '#c9d1d9',
}

export const theme = {
  font: '"Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
  ground: palette.ground,
  surface: palette.surface,
  ink: palette.ink,
  muted: palette.muted,
  hairline: palette.hairline,
  accent: palette.blue,
  up: palette.green,
  down: palette.red,
  line: palette.blue,
  // Moving average colors, by window length.
  averages: { 20: '#ffd60a', 50: '#00d4ff', 200: '#ff4fd8' },
  // One line color per portfolio on the compare screen.
  compare: ['#6c8cff', '#26c281', '#b38cff', '#00d4ff', '#ff4fd8', '#ffd60a'],
  // Backtest chart: portfolio value and money paid in.
  value: palette.blue,
  invested: palette.amber,
  errorBackground: palette.errorBackground,
  errorText: palette.errorText,
  buttonHover: palette.buttonHover,
}

// CSS variable name -> theme key. The stylesheet uses var(--name), so a color is never written twice.
export const CSS_VARIABLES = {
  font: 'font',
  ground: 'ground',
  surface: 'surface',
  ink: 'ink',
  muted: 'muted',
  hairline: 'hairline',
  accent: 'accent',
  up: 'up',
  down: 'down',
  value: 'value',
  invested: 'invested',
  'error-bg': 'errorBackground',
  'error-text': 'errorText',
  'button-hover': 'buttonHover',
}

// Charts shared by the price and backtest charts.
export const CHART_FONT_SIZE = 12
export const LINE_WIDTH = 2
export const MARGIN_TOP = 8
export const MARGIN_BOTTOM = 40
export const CHART_HEIGHT = 440
export const VOLUME_HEIGHT = 100
export const BACKTEST_HEIGHT = 360

// Price chart.
export const PRICE_MARGIN_LEFT = 56
export const PRICE_MARGIN_RIGHT = 16
export const PRICE_LEGEND_Y = 1.06
export const WICK_WIDTH = 1
export const AVERAGE_LINE_WIDTH = 1.75
export const VOLUME_OPACITY = 0.45
// Price axis headroom above the high and below the low (fitted and full range), as a share of the price.
export const AXIS_HEADROOM = 0.1
// Free pan pads the selected period by a share of its price range, but at least a share of its high.
export const FREE_PAN_PADDING = 0.1
export const FREE_PAN_MIN_PADDING = 0.02
// The volume panel sits under the price panel (shares of the plot height).
export const VOLUME_DOMAIN_TOP = 0.18
export const PANEL_GAP = 0.08

// Backtest chart.
export const BACKTEST_MARGIN_LEFT = 72
export const BACKTEST_MARGIN_RIGHT = 64
export const BACKTEST_LEGEND_Y = 1.08
export const END_LABEL_SHIFT = 6

// Time intervals. `days` is how long one candle lasts; 'month' and 'year' vary, so helpers.jsx works them out.
export const INTERVALS = [
  { id: 'day', label: 'Day', days: 1, hoverFormat: '%d.%m.%Y' },
  { id: 'week', label: 'Week', days: 7, hoverFormat: 'Week %V, %Y' },
  { id: 'month', label: 'Month', days: 'month', hoverFormat: '%b %Y' },
  { id: 'year', label: 'Year', days: 'year', hoverFormat: '%Y' },
]
// Daily rows are the finest data we have; they answer "was there trading in this range" for any interval.
export const DAILY_INTERVAL = 'day'
export const DEFAULT_INTERVAL = DAILY_INTERVAL

// Moving averages, as window lengths in trading days.
export const AVERAGE_WINDOWS = [20, 50, 200]

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

// Quick range buttons under the price chart. `months` counts back from the latest date.
export const PERIODS = [
  { id: '1M', label: '1M', months: 1 },
  { id: '3M', label: '3M', months: 3 },
  { id: '6M', label: '6M', months: 6 },
  { id: '1Y', label: '1Y', months: 12 },
  { id: 'YTD', label: 'YTD' },
  { id: '5Y', label: '5Y', months: 60 },
  { id: 'max', label: 'Max' },
]

// Money and numbers.
export const CURRENCY = 'CHF'
export const LOCALE = 'de-CH'

// Portfolios. The ids are the values the API stores; `label` is the editor button, `name` the list text.
export const WEIGHTING = { EQUAL: 'equal', MARKET_CAP: 'market_cap', MANUAL: 'manual', OWNERSHIP: 'ownership' }
export const WEIGHTINGS = [
  { id: WEIGHTING.EQUAL, label: 'Equal', name: 'Equal weight' },
  { id: WEIGHTING.MARKET_CAP, label: 'Market cap (SMI style)', name: 'Market cap' },
  { id: WEIGHTING.MANUAL, label: 'Your weights', name: 'Your weights' },
  { id: WEIGHTING.OWNERSHIP, label: '% of company', name: 'Equal % of each company' },
]
export const DEFAULT_WEIGHTING = WEIGHTING.EQUAL
export const WEIGHTING_HELP = {
  [WEIGHTING.EQUAL]: 'Every stock gets the same share of the money.',
  [WEIGHTING.MARKET_CAP]: 'Bigger companies get a bigger share, capped at 20% each like the SMI. The cap applies from 5 stocks.',
  [WEIGHTING.MANUAL]: 'Give every stock a percentage. They must add up to 100%, so free some percent in one stock before using it in another.',
  [WEIGHTING.OWNERSHIP]: 'You own the same percentage of every company, so bigger companies get a bigger share of the money. The share counts stay in that ratio as prices move. Needs the share count of each company (run the ingest).',
}
// Your weights: the percentages must add up to this, and move in steps of WEIGHT_STEP.
export const WEIGHT_TOTAL = 100
export const WEIGHT_STEP = 1
// Ids of the two special entries at the top of the portfolio list; neither is a saved portfolio.
export const NEW_PORTFOLIO = 'new'
export const COMPARE_PORTFOLIOS = 'compare'
// A copied portfolio starts as an unsaved draft with this added to its name.
export const COPY_SUFFIX = ' (copy)'
// How many portfolios the compare screen takes (mirrored in the backend).
export const MIN_COMPARE = 2
export const MAX_COMPARE = 6
export const COMPARE_DEFAULTS = { initial: '10000', inflow: '0', inflowFrequency: 'monthly' }
// Mirrors the API limit on a portfolio name (NAME_MAX_LENGTH in the backend).
export const PORTFOLIO_NAME_MAX_LENGTH = 80
// How long the editor waits after you stop typing before it asks the backend for the resulting weights.
export const PREVIEW_DEBOUNCE_MS = 300

// Backtest form. Inputs are strings because they come from <input>, and the API accepts them as given.
export const BACKTEST_DEFAULTS = { initial: '10000' }
export const BACKTEST_STEPS = { initial: 100 }

// Portfolio rules: how often cash is turned into shares, and how often new money arrives.
export const INVEST_FREQUENCIES = [
  { id: 'immediate', label: 'Immediately' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'never', label: 'Keep as cash' },
]
// `per` finishes the sentence "CHF 200 ..." in the backtest summary.
export const INFLOW_FREQUENCIES = [
  { id: 'monthly', label: 'Monthly', per: 'a month' },
  { id: 'quarterly', label: 'Quarterly', per: 'a quarter' },
  { id: 'yearly', label: 'Yearly', per: 'a year' },
]
export const NEVER_INVEST = 'never'
export const DEFAULT_INVEST_FREQUENCY = 'monthly'
export const DEFAULT_INFLOW_FREQUENCY = 'monthly'
export const INFLOW_STEP = 50

// Messages.
// Shown in place of the end date in the price header when the chart reaches the latest data.
export const TODAY_LABEL = 'today'
export const START_BEFORE_END_ERROR = 'The start date must be before the end date.'

// Backend address; set VITE_API_URL to point somewhere else (see .env.example).
export const DEFAULT_API_URL = 'http://localhost:8000'

// The two tabs at the top of the app.
export const VIEWS = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'portfolios', label: 'Portfolios' },
]
export const DEFAULT_VIEW = 'explorer'
