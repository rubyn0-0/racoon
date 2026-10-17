"""Loads price history from Yahoo only when the app asks for it, in background jobs.

The companies table is filled from a CSV when the server starts (no network). A stock's prices are
fetched the first time something needs them (`ensure`), written in bulk, and summarised on the company
row, so listing stocks never scans the price table. Later requests only top up the missing days.
"""

import csv
import io
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import yfinance as yf
from sqlalchemy import text

from racoon.db import BACKEND_DIR, get_engine

LOG = logging.getLogger("uvicorn.error")  # shows up in the terminal the backend runs in
TICKERS_FILE = BACKEND_DIR / "data" / "six_stocks_tickers.csv"
HISTORY_START = "2000-01-01"  # as far back as we ask Yahoo; younger stocks simply start later
MAX_WORKERS = 4  # parallel Yahoo requests
RETRIES = 1  # extra attempts after a failed fetch
REFRESH_AFTER = timedelta(hours=12)
ERROR_COOLDOWN = 60  # seconds before a failed stock is tried again

QUEUED, LOADING, READY, ERROR = "queued", "loading", "ready", "error"
FULL, TOP_UP = "full", "top_up"

PRICE_COLUMNS = (
    "ticker", "date", "open", "high", "low", "close", "adjusted_close", "volume", "dividends", "stock_splits",
)

_jobs = {}  # ticker -> {"state": ..., "error": ...}
_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=MAX_WORKERS)


def load_companies():
    with TICKERS_FILE.open(encoding="utf-8", newline="") as file:
        return [
            {
                "ticker": row["yahoo_ticker"],
                "name": row["name"],
                "exchange": row["exchange"],
                "country": row["country"],
                "in_smi": row["in_smi"].strip().upper() == "Y",
            }
            for row in csv.DictReader(file)
        ]


def seed_companies():
    """Make sure every company in the CSV exists (and is flagged as SMI or not). No prices, no network."""
    with get_engine().begin() as connection:
        connection.execute(
            text("""
                INSERT INTO companies (ticker, name, exchange, country, in_smi)
                VALUES (:ticker, :name, :exchange, :country, :in_smi)
                ON CONFLICT (ticker) DO UPDATE SET
                    name = EXCLUDED.name,
                    exchange = EXCLUDED.exchange,
                    country = EXCLUDED.country,
                    in_smi = EXCLUDED.in_smi
            """),
            load_companies(),
        )


def previous_weekday(today):
    """The last Monday-to-Friday strictly before `today`."""
    day = today - timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


def needs_load(meta, today, now):
    """FULL, TOP_UP or None for a company's stored summary.

    FULL: no prices yet, or only part of the history. TOP_UP: the data is old and was last refreshed
    a while ago. Otherwise there is nothing to do.
    """
    if meta["price_count"] == 0 or not meta["full_history"]:
        return FULL

    behind = meta["price_end"] is None or meta["price_end"] < previous_weekday(today)
    refreshed_long_ago = meta["refreshed_at"] is None or now - meta["refreshed_at"] > REFRESH_AFTER
    return TOP_UP if behind and refreshed_long_ago else None


def _fetch_prices(yahoo, ticker, start):
    data = yahoo.history(start=start, interval="1d", auto_adjust=False, actions=True)
    # A run during trading hours returns today's unfinished session without a close; skip it.
    data = data.dropna(subset=["Close"])
    if data.empty:
        return None

    frame = pd.DataFrame({
        "ticker": ticker,
        "date": data.index.strftime("%Y-%m-%d"),
        "open": data["Open"].to_numpy(),
        "high": data["High"].to_numpy(),
        "low": data["Low"].to_numpy(),
        "close": data["Close"].to_numpy(),
        "adjusted_close": data["Adj Close"].to_numpy(),
        "volume": pd.array(data["Volume"].round().to_numpy(), dtype="Int64"),
        "dividends": data["Dividends"].to_numpy(),
        "stock_splits": data["Stock Splits"].to_numpy(),
    })
    return frame.replace([float("inf"), float("-inf")], pd.NA)


def _write_prices(connection, frame):
    """Bulk upsert through COPY into a temporary table: far faster than row-by-row inserts."""
    buffer = io.StringIO()
    frame.to_csv(buffer, index=False, header=False, na_rep="")
    columns = ", ".join(PRICE_COLUMNS)
    updates = ", ".join(f"{name} = EXCLUDED.{name}" for name in PRICE_COLUMNS[2:])

    connection.execute(text("CREATE TEMP TABLE staged_prices (LIKE prices INCLUDING DEFAULTS) ON COMMIT DROP"))
    with connection.connection.driver_connection.cursor() as cursor:
        with cursor.copy(f"COPY staged_prices ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
            copy.write(buffer.getvalue())
    connection.execute(text(
        f"INSERT INTO prices ({columns}) SELECT {columns} FROM staged_prices "
        f"ON CONFLICT (ticker, date) DO UPDATE SET {updates}"
    ))


def _company_sizes(yahoo):
    try:
        info = yahoo.fast_info
        return info["marketCap"], info["shares"]
    except Exception:
        return None, None


def _clean(value):
    return float(value) if value is not None and pd.notna(value) and value not in (float("inf"), float("-inf")) else None


def _load(ticker, kind):
    """Fetch and store one stock. Returns what was done, for the log and for `ensure`'s report."""
    yahoo = yf.Ticker(ticker)

    with get_engine().connect() as connection:
        price_end = connection.execute(
            text("""
                SELECT max(date) FROM prices WHERE ticker = :ticker
            """),
            {"ticker": ticker},
        ).scalar_one()
    start = HISTORY_START if kind == FULL or price_end is None else price_end.isoformat()
    LOG.info("%s: %s load, asking Yahoo for prices from %s", ticker, kind, start)

    frame = _fetch_prices(yahoo, ticker, start)
    if frame is None and kind == FULL:
        raise RuntimeError(f"Yahoo has no prices for {ticker}")

    market_cap, shares = _company_sizes(yahoo) if kind == FULL else (None, None)
    with get_engine().begin() as connection:
        if frame is not None:
            _write_prices(connection, frame)
        stored = connection.execute(
            text("""
                UPDATE companies c SET
                    price_start = a.d_min, price_end = a.d_max, price_count = a.n,
                    refreshed_at = now(),
                    full_history = c.full_history OR :full,
                    market_cap = COALESCE(:market_cap, c.market_cap),
                    shares_outstanding = COALESCE(:shares, c.shares_outstanding)
                FROM (
                    SELECT min(date) AS d_min, max(date) AS d_max, count(*) AS n
                    FROM prices WHERE ticker = :ticker
                ) a
                WHERE c.ticker = :ticker
                RETURNING c.price_count, c.price_start, c.price_end
            """),
            {
                "ticker": ticker,
                "full": kind == FULL,
                "market_cap": _clean(market_cap),
                "shares": _clean(shares),
            },
        ).one()

    return {
        "kind": kind,
        "start": start,
        "fetched": 0 if frame is None else len(frame),
        "stored": stored[0],
        "first": stored[1].isoformat() if stored[1] else None,
        "last": stored[2].isoformat() if stored[2] else None,
    }


def _run(ticker, kind):
    with _lock:
        _jobs[ticker] = {"state": LOADING, "error": None, "kind": kind}

    started = time.monotonic()
    done, error = {}, None
    for _attempt in range(RETRIES + 1):
        try:
            done = _load(ticker, kind)
            error = None
            break
        except Exception as exc:  # Yahoo and the network fail in many ways; report, do not crash the pool
            error = str(exc) or exc.__class__.__name__

    seconds = round(time.monotonic() - started, 1)
    if error:
        LOG.warning("%s: %s load failed after %s s: %s", ticker, kind, seconds, error)
    else:
        LOG.info(
            "%s: %s load done in %s s: fetched %s rows, %s rows now stored (%s to %s)",
            ticker, kind, seconds, done["fetched"], done["stored"], done["first"], done["last"],
        )

    with _lock:
        _jobs[ticker] = {
            "state": ERROR if error else READY,
            "error": error,
            "at": time.monotonic(),
            "kind": kind,
            "seconds": seconds,
            **done,
        }


def _company_meta(tickers):
    """What is really stored for these tickers, counted from the prices table itself.

    The summary columns on `companies` are only a cache that makes listing stocks cheap. If they disagree
    with the real rows (the table was emptied or edited by hand) they are corrected here, so what gets
    loaded is always decided from the data that is actually there.
    """
    with get_engine().begin() as connection:
        rows = connection.execute(
            text("""
                SELECT c.ticker, c.full_history, c.refreshed_at, c.price_count AS stored_count,
                       coalesce(p.n, 0) AS price_count, p.d_min AS price_start, p.d_max AS price_end
                FROM companies c
                LEFT JOIN (
                    SELECT ticker, count(*) AS n, min(date) AS d_min, max(date) AS d_max
                    FROM prices WHERE ticker = ANY(:tickers) GROUP BY ticker
                ) p ON p.ticker = c.ticker
                WHERE c.ticker = ANY(:tickers)
            """),
            {"tickers": list(tickers)},
        ).mappings().all()

        meta = {}
        for row in rows:
            row = dict(row)
            if row["price_count"] != row["stored_count"]:
                LOG.warning(
                    "%s: summary said %s rows but the table holds %s; correcting it",
                    row["ticker"], row["stored_count"], row["price_count"],
                )
                connection.execute(
                    text("""
                        UPDATE companies SET price_start = :start, price_end = :end, price_count = :count
                        WHERE ticker = :ticker
                    """),
                    {"ticker": row["ticker"], "start": row["price_start"], "end": row["price_end"], "count": row["price_count"]},
                )
                if row["price_count"] == 0:
                    connection.execute(
                        text("UPDATE companies SET full_history = FALSE, refreshed_at = NULL WHERE ticker = :ticker"),
                        {"ticker": row["ticker"]},
                    )
                    row["full_history"], row["refreshed_at"] = False, None
            meta[row["ticker"]] = row
    return meta


def ensure(tickers):
    """Start loading whatever is missing or old for these tickers, and report where each one stands.

    Safe to call repeatedly (the frontend polls it): a ticker that is already loading is not started twice.
    A stale stock that already has data reports `ready` with `refreshing: true`, so screens need not wait.
    Each ticker also carries `detail`: what its last load did (kind, rows fetched, rows stored, seconds).
    """
    meta = _company_meta(tickers)
    now = datetime.now(timezone.utc)
    states = {}

    for ticker in tickers:
        if ticker not in meta:
            states[ticker] = {"state": ERROR, "error": f"Unknown stock {ticker}", "refreshing": False, "detail": {}}
            continue

        kind = needs_load(meta[ticker], date.today(), now)
        with _lock:
            job = _jobs.get(ticker, {"state": READY, "error": None})
            running = job["state"] in (QUEUED, LOADING)
            cooling_down = job["state"] == ERROR and time.monotonic() - job["at"] < ERROR_COOLDOWN
            if kind and not running and not cooling_down:
                _jobs[ticker] = job = {"state": QUEUED, "error": None, "kind": kind}
                _pool.submit(_run, ticker, kind)
                running = True
            detail = {key: value for key, value in job.items() if key not in ("state", "error", "at")}

        has_data = meta[ticker]["price_count"] > 0 and kind != FULL
        if running and has_data:
            states[ticker] = {"state": READY, "error": None, "refreshing": True}
        elif running:
            states[ticker] = {"state": LOADING, "error": None, "refreshing": False}
        elif job["state"] == ERROR and kind:
            states[ticker] = {"state": ERROR, "error": job["error"], "refreshing": False}
        else:
            states[ticker] = {"state": READY, "error": None, "refreshing": False}
        states[ticker]["detail"] = detail

    return {
        "states": states,
        "done": sum(1 for state in states.values() if state["state"] == READY),
        "total": len(states),
    }


def debug_snapshot():
    """TEMPORARY, for checking the loader: per company the real rows in `prices`, the stored summary next
    to it, and the state of its last load job."""
    with get_engine().connect() as connection:
        rows = connection.execute(text("""
            SELECT c.ticker, c.name, c.in_smi, c.price_count AS summary_rows, c.full_history,
                   coalesce(p.n, 0) AS rows, p.d_min, p.d_max
            FROM companies c
            LEFT JOIN (
                SELECT ticker, count(*) AS n, min(date) AS d_min, max(date) AS d_max FROM prices GROUP BY ticker
            ) p ON p.ticker = c.ticker
            ORDER BY c.in_smi DESC, c.name
        """)).mappings().all()

    with _lock:
        jobs = {ticker: dict(job) for ticker, job in _jobs.items()}

    return [
        {
            "ticker": row["ticker"],
            "company": row["name"],
            "in_smi": row["in_smi"],
            "rows": row["rows"],
            "first": row["d_min"].isoformat() if row["d_min"] else None,
            "last": row["d_max"].isoformat() if row["d_max"] else None,
            "summary_rows": row["summary_rows"],
            "full_history": row["full_history"],
            "job": jobs.get(row["ticker"]),
        }
        for row in rows
    ]
