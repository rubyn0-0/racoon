from datetime import date

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from racoon.db import get_conn

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health(conn=Depends(get_conn)):
    conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/stocks")
def list_stocks(conn=Depends(get_conn)):
    rows = conn.execute(text("""
        SELECT c.ticker, c.name AS company,
               to_char(min(p.date), 'YYYY-MM-DD') AS start_date,
               to_char(max(p.date), 'YYYY-MM-DD') AS end_date,
               count(p.date) AS count
        FROM companies c
        JOIN prices p ON p.ticker = c.ticker
        GROUP BY c.ticker, c.name
        ORDER BY c.name
    """)).mappings()
    return [dict(row) for row in rows]


@app.get("/api/stocks/{ticker}/prices")
def get_prices(
    ticker: str,
    start: date | None = None,
    end: date | None = None,
    conn=Depends(get_conn),
):
    rows = conn.execute(
        text("""
            SELECT to_char(date, 'YYYY-MM-DD') AS date,
                   open, high, low, close, adjusted_close,
                   volume, dividends, stock_splits
            FROM prices
            WHERE ticker = :ticker
              AND (CAST(:start AS date) IS NULL OR date >= :start)
              AND (CAST(:end AS date) IS NULL OR date <= :end)
            ORDER BY date
        """),
        {"ticker": ticker, "start": start, "end": end},
    ).mappings()
    prices = [dict(row) for row in rows]

    if not prices:
        raise HTTPException(status_code=404, detail=f"No prices found for {ticker}")

    return {"ticker": ticker, "count": len(prices), "prices": prices}
