# Racoon

Stock explorer: yfinance -> PostgreSQL -> FastAPI -> React (Plotly).

## Structure
```
README.md
docs/                      project notes (Plan.md)
src/
  backend/                 Python project (uv)
    pyproject.toml, uv.lock, .env.example, alembic.ini
    migrations/            database schema history (Alembic): versions/0001_baseline.py ... 0004_...
    data/                  the stock list (six_stocks_tickers.csv; its market column lists the markets, e.g. SMI, separated by ;)
    src/racoon/
      db.py                the single database handle (DATABASE_URL from src/backend/.env) and init_db()
      constants.py         shared names and paths (weightings, .env, data folder)
      loader.py            loads price history from Yahoo on demand, in background jobs
      analysis.py          candles, intervals and moving averages for the explorer
      backtest.py          the portfolio simulation: weights, investing days, buying whole shares
      portfolios.py        portfolio routes, saving, comparing and backtesting
      api.py               FastAPI app
    tests/                 pytest (pure functions; the database tests need RACOON_TEST_DATABASE_URL)
  frontend/                Vite + React + Plotly
    src/
      main.jsx             starts the app (theme, then App.jsx)
      App.jsx              loads the stocks, shows the tabs, loads each screen on demand
      Plot.jsx             the slim Plotly build (scatter and bar only) used by every chart
      TestLoader.jsx       dev-only red button that loads every stock and shows what is stored
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
- `GET /api/stocks`: companies with first/last date, row count, `markets` (current memberships) and `in_smi`
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

## Dev tools
The red "load every stock" button shows only while running `npm run dev` (hide it with `VITE_DEV_TOOLS=0` in `src/frontend/.env`), and it needs `DEV_TOOLS=1` in `src/backend/.env`, which turns on `/api/debug/loading`. A load that stays in `loading` for more than 3 minutes (or queued for 15) is flagged as stuck in the backend log and in that table.

## Database changes
Tables: `companies` (identity and exchange timezone), `company_load_state` (what the loader stored), `index_membership` (market, valid_from/valid_to; open while valid_to is NULL) and `company_fundamentals` (market cap and shares per as_of date; backtests use the row valid on each day).

The backend upgrades the database to the newest schema when it starts (`init_db()`), so a change to a table is a new migration:
1. `cd src/backend; uv run alembic revision -m "what changes"` creates `migrations/versions/<id>_what_changes.py`.
2. Write the SQL in `upgrade()` with `op.execute("...")`, and the undo in `downgrade()`.
3. `uv run alembic upgrade head` applies it now; the app also does this on start.
4. Never edit a migration that has been applied. Add a new one instead.

## Deploying
Frontend on GitHub Pages, backend (Docker) on Render, Postgres on Neon.
- Backend env vars: `DATABASE_URL` (a plain `postgresql://...?sslmode=require` URL works) and `FRONTEND_ORIGINS` (the Pages origin, e.g. `https://<user>.github.io`). Leave `DEV_TOOLS` unset. Build from `src/backend/Dockerfile`; the schema is created on first start.
- Frontend: `.github/workflows/deploy-frontend.yml` builds on every push to `main`. Set the repo variable `VITE_API_URL` to the backend URL and Pages source to "GitHub Actions". `VITE_BASE` (`/racoon/` in the workflow) is the sub-path the site is served from; it defaults to `/` locally.
- The API has no login, so anyone with the URL can use it.

## Tests
`cd src/backend; uv run pytest`
