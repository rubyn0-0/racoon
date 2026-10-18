// The one Plotly the app uses: a small core build with only the traces we draw (lines and bars).
// Add a trace here before using a new chart type, or it will not render.
import Plotly from 'plotly.js/lib/core'
import bar from 'plotly.js/lib/bar'
import scatter from 'plotly.js/lib/scatter'
import createPlotlyComponent from 'react-plotly.js/factory'

Plotly.register([bar, scatter])

export default createPlotlyComponent(Plotly)
