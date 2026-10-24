import os
import time
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import text

from racoon.analysis import INTERVALS, add_moving_averages, aggregate, parse_windows, to_records
from racoon.constants import ENV_FILE, LATEST_FUNDAMENTALS
from racoon.db import get_conn, init_db
from racoon.loader import debug_snapshot, ensure, reconcile_summaries, seed_companies
from racoon.portfolios import router as portfolios_router

PRICE_ROWS = ("date", "open", "high", "low", "close", "adjusted_close", "volume", "dividends", "stock_splits")
MAX_ENSURE = 60  # more than the ticker list holds
GZIP_MINIMUM_BYTES = 1000


class DevSettings(BaseSettings):
    """Switches for development-only tools; everything is off unless DEV_TOOLS=1 is in .env."""

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    dev_tools: bool = False


@asynccontextmanager
async def lifespan(app):
    init_db()  # upgrades the database to the newest migration (a no-op when it is already there)
    reconcile_summaries()  # fix cached price summaries that disagree with the stored rows (once, not per poll)
    seed_companies()  # every company in the ticker list exists from the start; prices load on demand
    yield


DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]  # the Vite dev server


def frontend_origins(extra=None):
    """The dev origins plus any in FRONTEND_ORIGINS (comma-separated, e.g. https://user.github.io)."""
    extra = os.environ.get("FRONTEND_ORIGINS", "") if extra is None else extra
    return DEV_ORIGINS + [origin.strip().rstrip("/") for origin in extra.split(",") if origin.strip()]


FRONTEND_ORIGINS = frontend_origins()
ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE"]
DEFAULT_INTERVAL = INTERVALS[0]

app = FastAPI(lifespan=lifespan)

app.add_middleware(GZipMiddleware, minimum_size=GZIP_MINIMUM_BYTES)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=ALLOWED_METHODS,
    allow_headers=["*"],
    expose_headers=["Server-Timing"],
)


@app.middleware("http")
async def server_timing(request: Request, call_next):
    """Time every request; the browser's network tab shows it as Server-Timing."""
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["Server-Timing"] = f"total;dur={(time.perf_counter() - started) * 1000:.0f}"
    return response


app.include_router(portfolios_router)


class EnsureIn(BaseModel):
    tickers: list[str] = Field(min_length=1, max_length=MAX_ENSURE)


@app.get("/api/health")
def health(conn=Depends(get_conn)):
    conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/stocks")
def list_stocks(conn=Depends(get_conn)):
    """Every company, SMI members first, with the markets it is in now and a summary of the history stored for it (none until loaded)."""
    rows = conn.execute(text(f"""
        SELECT c.ticker, c.name AS company, f.market_cap, f.shares_outstanding,
               to_char(s.price_start, 'YYYY-MM-DD') AS start_date,
               to_char(s.price_end, 'YYYY-MM-DD') AS end_date,
               s.price_count AS count,
               (s.price_count > 0 AND s.full_history) AS loaded,
               COALESCE(m.markets, ARRAY[]::text[]) AS markets,
               COALESCE('SMI' = ANY(m.markets), FALSE) AS in_smi
        FROM companies c
        JOIN company_load_state s ON s.ticker = c.ticker
        {LATEST_FUNDAMENTALS}
        LEFT JOIN (
            SELECT ticker, array_agg(market ORDER BY market) AS markets
            FROM index_membership WHERE valid_to IS NULL GROUP BY ticker
        ) m ON m.ticker = c.ticker
        ORDER BY in_smi DESC, c.name
    """)).mappings()
    return [dict(row) for row in rows]


@app.post("/api/stocks/ensure")
def ensure_stocks(body: EnsureIn):
    """Start loading missing or old prices for these tickers and report progress. Call again to poll."""
    return ensure(list(dict.fromkeys(body.tickers)))


if DevSettings().dev_tools:  # for checking the on-demand loader, together with TestLoader.jsx

    @app.get("/api/debug/loading")
    def debug_loading():
        """Per company: the rows really in the prices table, the stored summary next to it, and the last load job."""
        return debug_snapshot()


@app.get("/api/prices/on")
def prices_on(
    tickers: str = Query(description="Comma separated yahoo tickers"),
    on: date = Query(description="Day to value them on"),
    conn=Depends(get_conn),
):
    """The close on (or just before) a day for each ticker; one small query for the starting-position value."""
    rows = conn.execute(
        text("""
            SELECT DISTINCT ON (ticker) ticker, close
            FROM prices
            WHERE ticker = ANY(:tickers) AND date <= :on AND close IS NOT NULL
            ORDER BY ticker, date DESC
        """),
        {"tickers": tickers.split(","), "on": on},
    ).all()
    return {ticker: close for ticker, close in rows}


@app.get("/api/stocks/{ticker}/prices")
def get_prices(
    ticker: str,
    interval: Literal[INTERVALS] = DEFAULT_INTERVAL,
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
        text(f"SELECT to_char(date, 'YYYY-MM-DD'), {', '.join(PRICE_ROWS[1:])} FROM prices WHERE ticker = :ticker ORDER BY date"),
        {"ticker": ticker},
    ).all()

    if not rows:
        known = conn.execute(text("SELECT 1 FROM companies WHERE ticker = :ticker"), {"ticker": ticker}).first()
        if known:
            raise HTTPException(status_code=409, detail=f"Prices for {ticker} are still loading")
        raise HTTPException(status_code=404, detail=f"No prices found for {ticker}")

    df = pd.DataFrame(rows, columns=list(PRICE_ROWS))
    numeric = df.columns.drop("date")
    df[numeric] = df[numeric].apply(pd.to_numeric, errors="coerce")
    df = add_moving_averages(aggregate(df, interval), windows)

    # Trim last so the averages already have their warm-up rows.
    if start:
        df = df[df["date"] >= start.isoformat()]
    if end:
        df = df[df["date"] <= end.isoformat()]

    return {"ticker": ticker, "interval": interval, "count": len(df), "prices": to_records(df)}
