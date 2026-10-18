# Racoon

Stock explorer: yfinance -> PostgreSQL -> FastAPI -> React (Plotly).

## Structure
```
README.md
docs/                      project notes (Plan.md)
src/
  backend/                 Python project (uv)
    pyproject.toml, uv.lock, .env.example
    data/                  the stock list (six_stocks_tickers.csv; in_smi marks the current SMI members)
    src/racoon/
      db.py                the single database handle (DATABASE_URL from src/backend/.env)
      loader.py            loads price history from Yahoo on demand, in background jobs
      api.py               FastAPI app
  frontend/                Vite + React + Plotly
    src/
      main.jsx             starts the app: loads the stocks, shows the two tabs
      settings.js          every colour, size, label and default you might want to change
      helpers.jsx          number and date formatting, chart layout pieces, the button row
      api.js               calls to the backend
      Explorer.jsx         price explorer screen (form, controls, header)
      PriceChart.jsx       the candle/line chart with moving averages and volume
      Portfolios.jsx       saved portfolios and their editor
      Compare.jsx          several portfolios side by side on the same days and money
      Backtest.jsx         backtest form, results and chart
      styles.css           all styling (colours come from settings.js)
```

## Setup
1. `cd src/backend`, copy `.env.example` to `.env` and fill in `DATABASE_URL`.
2. `uv sync`
3. Nothing to load up front: the stock list comes from the CSV, and a stock's history (from 2000) is fetched from Yahoo
   the first time the explorer or a portfolio needs it, with a progress message. Nothing is ever loaded before it is asked for.
4. `cd src/frontend; npm install`

## Run
Two terminals, from the repo root:
```
cd src/backend;  uv run uvicorn racoon.api:app --reload    # http://localhost:8000 (docs at /docs)
cd src/frontend; npm run dev                               # http://localhost:5173
```

Health check: http://localhost:8000/api/health

## API
- `GET /api/stocks`: companies with first/last date and row count
- `GET /api/stocks/{ticker}/prices`: OHLC, volume, dividends, splits. Options:
  - `interval=day|week|month|year` (candles are aggregated on the server)
  - `ma=20,50,200` simple moving averages of close, returned as `ma20`, `ma50`, ...
  - `start=YYYY-MM-DD`, `end=YYYY-MM-DD` (trimmed after the averages are computed)

- `GET/POST /api/portfolios`, `GET/PUT/DELETE /api/portfolios/{id}`: saved portfolios.
  Weighting is `equal`, `manual` (your weights, scaled to 100%) or `market_cap`
  (SMI style: by market cap, max 20% per stock once there are 5 or more stocks). Each portfolio keeps an available
  stock roster; only holdings whose `selected` flag is true participate in weighting and simulation.
- `POST /api/portfolios/weights`: resulting weights for an unsaved draft.
- `GET /api/portfolios/{id}/backtest?start=&end=`: runs the portfolio from its optional opening date (or a custom
  range) using its saved rules: starting capital, new money, investing frequency and optional transferred shares.
  If a selected stock has shorter history, the test starts at that stock's first available date and reports it.
- `GET /api/portfolios/{id}/plan?until=`: what it would buy at the next investing days, at the last close.
- `GET /api/portfolios/compare?ids=1,2&start=&end=&initial=&inflow=&inflow_frequency=`: several portfolios on the
  same days with the same money.
- `POST /api/stocks/ensure` `{tickers}`: starts loading missing prices and reports progress (poll it).
- `GET /api/prices/on?tickers=&on=`: the close on a day, for valuing a starting position.

Market caps and share counts are loaded together with a stock's prices.

## Tests
`cd src/backend; uv run pytest`
