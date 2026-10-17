// The single source of truth for colors and the font. Plotly cannot read CSS variables, so the charts use
// `theme` directly and `applyThemeVariables` publishes the same values to CSS as custom properties.
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
  averages: { 20: '#ffd60a', 50: '#00d4ff', 200: '#ff4fd8' },
  // Backtest pair on the dark surface.
  value: palette.blue,
  invested: palette.amber,
  errorBackground: palette.errorBackground,
  errorText: palette.errorText,
  buttonHover: palette.buttonHover,
}

export const averageWindows = [20, 50, 200]

// CSS custom property name -> theme key. Components style with var(--name); never repeat the hex in CSS.
const cssVariables = {
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

// `extra` carries other values CSS needs from JS, as { name: value }.
export function applyThemeVariables(extra = {}) {
  const root = document.documentElement.style
  const variables = {
    ...Object.fromEntries(Object.entries(cssVariables).map(([name, key]) => [name, theme[key]])),
    ...extra,
  }

  Object.entries(variables).forEach(([name, value]) => root.setProperty(`--${name}`, value))
}

// Plotly settings every chart shares. Charts spread these and override only what differs.
export const CHART_FONT_SIZE = 12
export const LINE_WIDTH = 2
export const CHART_HEIGHT = 440
export const VOLUME_HEIGHT = 100
export const BACKTEST_HEIGHT = 360

const MARGIN_TOP = 8
const MARGIN_BOTTOM = 40

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
