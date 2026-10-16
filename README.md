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
      App.jsx              loads the stock list
      StockExplorer.jsx    the chart UI
      api.js               calls to the backend
      prices.js            day/week/month/year aggregation
```

## Setup
1. `cd src/backend`, copy `.env.example` to `.env` and fill in `DATABASE_URL`.
2. `uv sync`
3. `uv run python -m racoon.ingest` (default: ABB, Nestlé, Novartis; or pass yahoo tickers from the CSV)
4. `cd src/frontend; npm install`

## Run
Two terminals, from the repo root:
```
cd src/backend;  uv run uvicorn racoon.api:app --reload    # http://localhost:8000 (docs at /docs)
cd src/frontend; npm run dev                               # http://localhost:5173
```

Health check: http://localhost:8000/api/health
