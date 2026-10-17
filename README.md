# Racoon

Stock explorer: yfinance -> PostgreSQL -> FastAPI -> React (Plotly).

## Structure
```
README.md
docs/                      project notes (Plan.md)
src/
  backend/                 Python project (uv)
    pyproject.toml, uv.lock, .env.example
    data/                  seed data (six_stocks_tickers.csv)
    src/racoon/
      db.py                the single database handle (DATABASE_URL from src/backend/.env)
      ingest.py            yfinance -> database
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
3. `uv run python -m racoon.ingest` (default: ABB, Nestlé, Novartis; or pass yahoo tickers from the CSV)
   Re-run it after updating: it also loads each company's share count, which the "% of company" portfolio weighting needs.
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
  (SMI style: by market cap, max 20% per stock once there are 5 or more stocks).
- `POST /api/portfolios/weights`: resulting weights for an unsaved draft.
- `GET /api/portfolios/{id}/backtest?start=&end=&initial=10000&monthly=0&reinvest=true`:
  buy on day one, add `monthly` CHF on the first trading day of each month, dividends
  reinvested or kept as cash. Returns the value over time, money paid in vs market return,
  dividends, largest drop and the holdings at the end.

Market caps come from the ingest; run it again after updating to load them.

## Tests
`cd src/backend; uv run pytest`
