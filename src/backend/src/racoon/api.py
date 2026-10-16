from contextlib import asynccontextmanager
from datetime import date
from typing import Literal

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from racoon.analysis import add_moving_averages, aggregate, parse_windows, to_records
from racoon.db import get_conn, init_db
from racoon.portfolios import router as portfolios_router


@asynccontextmanager
async def lifespan(app):
    init_db()  # creates new tables (e.g. portfolios) on an existing database
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)
app.include_router(portfolios_router)


@app.get("/api/health")
def health(conn=Depends(get_conn)):
    conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/stocks")
def list_stocks(conn=Depends(get_conn)):
    rows = conn.execute(text("""
        SELECT c.ticker, c.name AS company, c.market_cap,
               to_char(min(p.date), 'YYYY-MM-DD') AS start_date,
               to_char(max(p.date), 'YYYY-MM-DD') AS end_date,
               count(p.date) AS count
        FROM companies c
        JOIN prices p ON p.ticker = c.ticker
        GROUP BY c.ticker, c.name, c.market_cap
        ORDER BY c.name
    """)).mappings()
    return [dict(row) for row in rows]


@app.get("/api/stocks/{ticker}/prices")
def get_prices(
    ticker: str,
    interval: Literal["day", "week", "month", "year"] = "day",
    ma: str | None = None,
    start: date | None = None,
    end: date | None = None,
    conn=Depends(get_conn),
):
    try:
        windows = parse_windows(ma)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))

    rows = conn.execute(
        text("""
            SELECT to_char(date, 'YYYY-MM-DD') AS date,
                   open, high, low, close, adjusted_close,
                   volume, dividends, stock_splits
            FROM prices
            WHERE ticker = :ticker
            ORDER BY date
        """),
        {"ticker": ticker},
    ).mappings().all()

    if not rows:
        raise HTTPException(status_code=404, detail=f"No prices found for {ticker}")

    df = pd.DataFrame(rows)
    numeric = df.columns.drop("date")
    df[numeric] = df[numeric].apply(pd.to_numeric, errors="coerce")
    df = add_moving_averages(aggregate(df, interval), windows)

    # Trim last so the averages already have their warm-up rows.
    if start:
        df = df[df["date"] >= start.isoformat()]
    if end:
        df = df[df["date"] <= end.isoformat()]

    return {"ticker": ticker, "interval": interval, "count": len(df), "prices": to_records(df)}
