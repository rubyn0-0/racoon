// Plotly cannot read CSS variables, so the chart colors live here.
// Keep --up / --down / --ink / --muted / --hairline in App.css in sync.
export const theme = {
  font: '"Hanken Grotesk Variable", system-ui, sans-serif',
  ink: '#161b22',
  muted: '#5e6877',
  hairline: '#e2e6ec',
  up: '#118a68',
  upEdge: '#0b6b50',
  down: '#d23b2e',
  downEdge: '#a82b20',
  lines: ['#2747d8', '#d23b2e', '#118a68', '#7a4cc2', '#d98e04'],
  averages: { 20: '#d98e04', 50: '#7a4cc2', 200: '#1f2a44' },
  // Backtest pair, checked with the dataviz palette validator (CVD ΔE 33, contrast >= 3:1).
  value: '#2747d8',
  invested: '#c27a00',
}

export const averageWindows = [20, 50, 200]
