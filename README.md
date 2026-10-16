# Racoon

Stock explorer: yfinance -> PostgreSQL -> FastAPI -> React (Plotly).

## Structure
```
backend/                 Python project (uv)
  pyproject.toml, uv.lock, .env.example
  data/                  seed data (six_stocks_tickers.csv)
  src/racoon/
    db.py                the single database handle (DATABASE_URL from backend/.env)
    ingest.py            yfinance -> database
    api.py               FastAPI app
frontend/                Vite + React + Plotly
docs/                    project notes
```

## Setup
1. `cd backend`, copy `.env.example` to `.env` and fill in `DATABASE_URL`.
2. `uv sync`
3. `uv run python -m racoon.ingest` (default: ABB, Nestlé, Novartis; or pass yahoo tickers from the CSV)
4. `uv run uvicorn racoon.api:app --reload` (API on http://localhost:8000, docs at `/docs`)
5. In another terminal: `cd frontend; npm install; npm run dev` (http://localhost:5173)
