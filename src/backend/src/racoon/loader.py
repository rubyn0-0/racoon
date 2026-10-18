"""Loads price history from Yahoo only when the app asks for it, in background jobs.

The companies table is filled from a CSV when the server starts (no network). A stock's prices are
fetched the first time something needs them (`ensure`), written in bulk, and summarised in its
company_load_state row, so listing stocks never scans the price table. Later requests only top up the
missing days.
"""

import csv
import io
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
import yfinance as yf
from sqlalchemy import text

from racoon.constants import EXCHANGE_TIMEZONES, LATEST_FUNDAMENTALS, TICKERS_FILE
from racoon.db import get_engine

LOG = logging.getLogger("uvicorn.error")  # shows up in the terminal the backend runs in
HISTORY_START = "2000-01-01"  # as far back as we ask Yahoo; younger stocks simply start later
MAX_WORKERS = 4  # parallel Yahoo requests
RETRIES = 1  # extra attempts after a failed fetch
REFRESH_AFTER = timedelta(hours=12)
ERROR_COOLDOWN = 60  # seconds before a failed stock is tried again
STUCK_AFTER = 180  # seconds a job may spend loading before it is reported as stuck
QUEUED_STUCK_AFTER = STUCK_AFTER * 5  # a queued job may wait behind others for longer before it counts as stuck

QUEUED, LOADING, READY, ERROR = "queued", "loading", "ready", "error"
FULL, TOP_UP = "full", "top_up"

PRICE_COLUMNS = (
    "ticker", "date", "open", "high", "low", "close", "adjusted_close", "volume", "dividends", "stock_splits",
)

# Bookkeeping kept on each job for stuck detection; never sent to the frontend.
JOB_INTERNAL_KEYS = ("since", "started", "thread", "stuck_logged")

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
                "markets": [market.strip() for market in row["market"].split(";") if market.strip()],
            }
            for row in csv.DictReader(file)
        ]


def close_memberships(connection, condition, params):
    """End today the open memberships matching the SQL `condition`. One that began today is deleted
    instead, so no membership ever lasts zero days."""
    connection.execute(
        text(f"DELETE FROM index_membership WHERE valid_to IS NULL AND valid_from >= CURRENT_DATE AND {condition}"),
        params,
    )
    connection.execute(
        text(f"UPDATE index_membership SET valid_to = CURRENT_DATE WHERE valid_to IS NULL AND {condition}"),
        params,
    )


def sync_memberships(connection, ticker, markets):
    """Make the company's open memberships equal `markets`: close the ones no longer listed, open new ones today."""
    params = {"ticker": ticker, "markets": markets}
    close_memberships(connection, "ticker = :ticker AND NOT (market = ANY(CAST(:markets AS text[])))", params)
    # A zero-length row left by older code can still hold today's key: reopen it rather than collide with it.
    connection.execute(
        text("""
            INSERT INTO index_membership (market, ticker, valid_from)
            SELECT listed, CAST(:ticker AS varchar), CURRENT_DATE FROM unnest(CAST(:markets AS text[])) AS listed
            WHERE NOT EXISTS (
                SELECT 1 FROM index_membership
                WHERE ticker = :ticker AND market = listed AND valid_to IS NULL
            )
            ON CONFLICT (market, ticker, valid_from) DO UPDATE SET valid_to = NULL
        """),
        params,
    )


def seed_companies():
    """Make sure every company in the CSV exists, has a load state row and the markets the CSV lists. No prices, no network."""
    companies = load_companies()
    with get_engine().begin() as connection:
        connection.execute(
            text("""
                INSERT INTO companies (ticker, name, exchange, country, exchange_timezone)
                VALUES (:ticker, :name, :exchange, :country, :zone)
                ON CONFLICT (ticker) DO UPDATE SET
                    name = EXCLUDED.name,
                    exchange = EXCLUDED.exchange,
                    country = EXCLUDED.country,
                    exchange_timezone = COALESCE(companies.exchange_timezone, EXCLUDED.exchange_timezone)
            """),
            [
                {
                    **{key: company[key] for key in ("ticker", "name", "exchange", "country")},
                    "zone": EXCHANGE_TIMEZONES.get(company["exchange"]),
                }
                for company in companies
            ],
        )
        connection.execute(
            text("INSERT INTO company_load_state (ticker) VALUES (:ticker) ON CONFLICT (ticker) DO NOTHING"),
            [{"ticker": company["ticker"]} for company in companies],
        )
        for company in companies:
            sync_memberships(connection, company["ticker"], company["markets"])
        # A stock dropped from the CSV altogether is in no market any more.
        close_memberships(
            connection,
            "NOT (ticker = ANY(CAST(:tickers AS text[])))",
            {"tickers": [company["ticker"] for company in companies]},
        )


def previous_weekday(today):
    """The last Monday-to-Friday strictly before `today`."""
    day = today - timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


def needs_load(meta, today, now):
    """FULL, TOP_UP or None for a company's stored summary.

    FULL: no prices yet, or only part of the history. TOP_UP: the data is old, or the company size
    (market cap, share count) is still missing, and it was last refreshed a while ago, so a failed size
    lookup is retried later. Otherwise there is nothing to do.
    """
    if meta["price_count"] == 0 or not meta["full_history"]:
        return FULL

    behind = meta["price_end"] is None or meta["price_end"] < previous_weekday(today)
    sizes_missing = meta["market_cap"] is None or meta["shares_outstanding"] is None
    refreshed_long_ago = meta["refreshed_at"] is None or now - meta["refreshed_at"] > REFRESH_AFTER
    return TOP_UP if (behind or sizes_missing or last_day_unfinished(meta)) and refreshed_long_ago else None


def exchange_zone(name):
    """The exchange's timezone, or UTC when it is not known (NULL) or not a timezone this system has."""
    try:
        return ZoneInfo(name)
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        return timezone.utc


def last_day_unfinished(meta):
    """True when the last stored day may be an unfinished session: the stock was last refreshed on that
    very day or earlier, by the calendar of its exchange, so Yahoo may have given a partial day that the
    market has since completed."""
    if meta["price_end"] is None or meta["refreshed_at"] is None:
        return False
    zone = exchange_zone(meta.get("exchange_timezone"))
    return meta["refreshed_at"].astimezone(zone).date() <= meta["price_end"]


def new_splits(frame, after=None):
    """The real split factors (positive, non-NaN) in the fetched rows; empty when there are none.

    `after` is an ISO date: only rows on or after it count, so a split already stored is not seen again.
    """
    if frame is None or frame.empty:
        return pd.Series(dtype=float)
    splits = pd.to_numeric(frame["stock_splits"], errors="coerce").fillna(0)
    real = splits > 0
    if after is not None:
        real &= frame["date"] >= after
    return splits[real]


def has_split(frame, after=None):
    """True when the fetched rows hold a real stock split."""
    return not new_splits(frame, after).empty


def split_ratio(frame, after=None):
    """The shares gained per old share by all the new splits together (2.0 for one 2-for-1 split, 1.0 for none)."""
    return float(new_splits(frame, after).prod())


def is_stuck(job, now):
    """True when a loading job has run for over STUCK_AFTER seconds (counted from `started`), or a queued job
    has waited for over QUEUED_STUCK_AFTER seconds (counted from `since`). `now` is time.monotonic()."""
    if job.get("state") == LOADING:
        return now - job.get("started", now) > STUCK_AFTER
    if job.get("state") == QUEUED:
        return now - job.get("since", now) > QUEUED_STUCK_AFTER
    return False


def can_requeue(job, now):
    """A loading job stuck for 3 x STUCK_AFTER whose worker thread is dead may be queued again.

    A queued job is never queued again: its submission still waits in the pool and will run, so a second
    one would load the stock twice. A job whose thread is still alive is slow, not lost, for the same reason.
    """
    thread = job.get("thread")
    if job.get("state") != LOADING or thread is None or now - job["started"] <= STUCK_AFTER * 3:
        return False
    return not thread.is_alive()


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


def _company_sizes(yahoo, ticker):
    """(market cap, share count, exchange timezone); each is None when Yahoo cannot give it, prices still get stored."""
    try:
        info = yahoo.fast_info
    except Exception as exc:  # yfinance raises many types here; a missing size must not fail the load
        LOG.warning("%s: no company size from Yahoo: %s", ticker, exc)
        return None, None, None

    found = []
    for key in ("marketCap", "shares", "timezone"):
        try:
            found.append(info[key])
        except Exception as exc:
            LOG.warning("%s: no %s from Yahoo: %s", ticker, key, exc)
            found.append(None)
    return tuple(found)


def _clean(value):
    """A finite float for the database, or None for missing, NaN and infinite values."""
    if value is None or pd.isna(value):
        return None
    if value in (float("inf"), float("-inf")):
        return None
    return float(value)


def _load(ticker, kind):
    """Fetch and store one stock. Returns what was done, for the log and for `ensure`'s report."""
    yahoo = yf.Ticker(ticker)

    with get_engine().connect() as connection:
        price_end = connection.execute(
            text("SELECT max(date) FROM prices WHERE ticker = :ticker"),
            {"ticker": ticker},
        ).scalar_one()
        sizes_missing, timezone_missing = connection.execute(
            text(f"""
                SELECT f.market_cap IS NULL OR f.shares_outstanding IS NULL, c.exchange_timezone IS NULL
                FROM companies c {LATEST_FUNDAMENTALS} WHERE c.ticker = :ticker
            """),
            {"ticker": ticker},
        ).one()
        split_stored = price_end is not None and connection.execute(
            text("SELECT coalesce(stock_splits, 0) > 0 FROM prices WHERE ticker = :ticker AND date = :day"),
            {"ticker": ticker, "day": price_end},
        ).scalar_one_or_none()
    start = HISTORY_START if kind == FULL or price_end is None else price_end.isoformat()
    LOG.info("%s: %s load, asking Yahoo for prices from %s", ticker, kind, start)

    frame = _fetch_prices(yahoo, ticker, start)
    # Yahoo re-adjusts the whole history after a split, so stored older rows go stale: reload everything.
    # A split already stored on the last day is not new, so it does not trigger this again.
    after = (price_end + timedelta(days=1)).isoformat() if split_stored else None
    ratio = 1.0
    if kind != FULL and has_split(frame, after):
        LOG.info("%s: new stock split found, reloading the full history", ticker)
        ratio = split_ratio(frame, after)
        kind, start = FULL, HISTORY_START
        frame = _fetch_prices(yahoo, ticker, start)
        if frame is None:  # do not mark the stock as fully loaded; the job fails and is retried later
            raise RuntimeError(f"Yahoo returned no prices for {ticker} when reloading after a split")
    if frame is None and kind == FULL:
        raise RuntimeError(f"Yahoo has no prices for {ticker}")

    asks_yahoo = kind == FULL or sizes_missing or timezone_missing
    market_cap, shares, exchange_timezone = _company_sizes(yahoo, ticker) if asks_yahoo else (None, None, None)
    market_cap, shares = _clean(market_cap), _clean(shares)
    with get_engine().begin() as connection:
        if frame is not None:
            _write_prices(connection, frame)
        stored = connection.execute(
            text("""
                INSERT INTO company_load_state AS s (ticker, price_start, price_end, price_count, refreshed_at, full_history)
                SELECT CAST(:ticker AS varchar), min(date), max(date), count(*), now(), CAST(:full AS boolean)
                FROM prices WHERE ticker = :ticker
                ON CONFLICT (ticker) DO UPDATE SET
                    price_start = EXCLUDED.price_start,
                    price_end = EXCLUDED.price_end,
                    price_count = EXCLUDED.price_count,
                    refreshed_at = now(),
                    full_history = s.full_history OR :full
                RETURNING s.price_count, s.price_start, s.price_end
            """),
            {"ticker": ticker, "full": kind == FULL},
        ).mappings().one()
        if ratio != 1.0:
            # Yahoo now gives the whole price history on the post-split basis, so the share counts of
            # earlier days are scaled the same way (the market cap does not change in a split).
            connection.execute(
                text("""
                    UPDATE company_fundamentals SET shares_outstanding = shares_outstanding * :ratio
                    WHERE ticker = :ticker AND as_of < CURRENT_DATE
                """),
                {"ticker": ticker, "ratio": ratio},
            )
        if market_cap is not None or shares is not None:
            # Today's row starts from the newest one, so a size Yahoo did not give this time is kept.
            connection.execute(
                text("""
                    INSERT INTO company_fundamentals AS f (ticker, as_of, market_cap, shares_outstanding)
                    SELECT CAST(:ticker AS varchar), CURRENT_DATE,
                           COALESCE(CAST(:market_cap AS double precision), p.market_cap),
                           COALESCE(CAST(:shares AS double precision), p.shares_outstanding)
                    FROM (SELECT 1) AS one
                    LEFT JOIN LATERAL (
                        SELECT market_cap, shares_outstanding FROM company_fundamentals
                        WHERE ticker = :ticker ORDER BY as_of DESC LIMIT 1
                    ) p ON TRUE
                    ON CONFLICT (ticker, as_of) DO UPDATE SET
                        market_cap = EXCLUDED.market_cap,
                        shares_outstanding = EXCLUDED.shares_outstanding
                """),
                {"ticker": ticker, "market_cap": market_cap, "shares": shares},
            )
        if exchange_timezone:
            connection.execute(
                text("UPDATE companies SET exchange_timezone = :zone WHERE ticker = :ticker"),
                {"ticker": ticker, "zone": exchange_timezone},
            )

    return {
        "kind": kind,
        "start": start,
        "fetched": 0 if frame is None else len(frame),
        "stored": stored["price_count"],
        "first": stored["price_start"].isoformat() if stored["price_start"] else None,
        "last": stored["price_end"].isoformat() if stored["price_end"] else None,
    }


def _run(ticker, kind):
    with _lock:
        started = time.monotonic()
        since = _jobs.get(ticker, {}).get("since", started)  # keep the time it was queued
        _jobs[ticker] = {
            "state": LOADING, "error": None, "kind": kind, "since": since, "started": started,
            "thread": threading.current_thread(),
        }

    done, error = {}, None
    for _attempt in range(RETRIES + 1):
        try:
            done = _load(ticker, kind)
            kind = done["kind"]  # a split can turn a top-up into a full load
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
    """The cached summary of these tickers, read from the company tables only (cheap enough to poll)."""
    with get_engine().connect() as connection:
        rows = connection.execute(
            text(f"""
                SELECT c.ticker, c.exchange_timezone, s.full_history, s.refreshed_at, s.price_count, s.price_start,
                       s.price_end, f.market_cap, f.shares_outstanding
                FROM companies c
                JOIN company_load_state s ON s.ticker = c.ticker
                {LATEST_FUNDAMENTALS}
                WHERE c.ticker = ANY(:tickers)
            """),
            {"tickers": list(tickers)},
        ).mappings().all()
    return {row["ticker"]: dict(row) for row in rows}


def reconcile_summaries():
    """Compare every company's cached summary with the rows really in `prices`, and correct drift.

    The summary in `company_load_state` only caches what the prices table holds. If they disagree (the table
    was emptied or edited by hand) they are corrected here, so what gets loaded is decided from the data
    that is actually there. Runs once at start-up: counting the whole table is too slow to do on every poll.
    """
    with get_engine().begin() as connection:
        rows = connection.execute(
            text("""
                SELECT c.ticker, s.price_count AS stored_count, s.price_start AS stored_start,
                       s.price_end AS stored_end,
                       coalesce(p.n, 0) AS price_count, p.d_min AS price_start, p.d_max AS price_end
                FROM companies c
                JOIN company_load_state s ON s.ticker = c.ticker
                LEFT JOIN (
                    SELECT ticker, count(*) AS n, min(date) AS d_min, max(date) AS d_max
                    FROM prices GROUP BY ticker
                ) p ON p.ticker = c.ticker
            """)
        ).mappings().all()

        for row in rows:
            if (row["price_count"], row["price_start"], row["price_end"]) == (
                row["stored_count"], row["stored_start"], row["stored_end"]
            ):
                continue
            LOG.warning(
                "%s: summary said %s rows (%s to %s) but the table holds %s (%s to %s); correcting it",
                row["ticker"], row["stored_count"], row["stored_start"], row["stored_end"],
                row["price_count"], row["price_start"], row["price_end"],
            )
            connection.execute(
                text("""
                    UPDATE company_load_state SET price_start = :start, price_end = :end, price_count = :count
                    WHERE ticker = :ticker
                """),
                {"ticker": row["ticker"], "start": row["price_start"], "end": row["price_end"], "count": row["price_count"]},
            )
            if row["price_count"] == 0:
                connection.execute(
                    text("UPDATE company_load_state SET full_history = FALSE, refreshed_at = NULL WHERE ticker = :ticker"),
                    {"ticker": row["ticker"]},
                )


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
            now_mono = time.monotonic()
            if running and can_requeue(job, now_mono):
                LOG.warning("%s: job stuck for %s s with no live thread, queueing it again", ticker, round(now_mono - job["started"]))
                running = False
            cooling_down = job["state"] == ERROR and now_mono - job["at"] < ERROR_COOLDOWN
            if kind and not running and not cooling_down:
                _jobs[ticker] = job = {"state": QUEUED, "error": None, "kind": kind, "since": now_mono}
                _pool.submit(_run, ticker, kind)
                running = True
            stuck = is_stuck(job, now_mono)
            if stuck and not job.get("stuck_logged"):
                job["stuck_logged"] = True
                LOG.warning("%s: %s job stuck in %s", ticker, job.get("kind"), job["state"])
            hidden = ("state", "error", "at", *JOB_INTERNAL_KEYS)
            detail = {key: value for key, value in job.items() if key not in hidden}
            if stuck:
                detail["stuck"] = True

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
            SELECT c.ticker, c.name, s.price_count AS summary_rows, s.full_history,
                   EXISTS (
                       SELECT 1 FROM index_membership m
                       WHERE m.ticker = c.ticker AND m.market = 'SMI' AND m.valid_to IS NULL
                   ) AS in_smi,
                   coalesce(p.n, 0) AS rows, p.d_min, p.d_max
            FROM companies c
            JOIN company_load_state s ON s.ticker = c.ticker
            LEFT JOIN (
                SELECT ticker, count(*) AS n, min(date) AS d_min, max(date) AS d_max FROM prices GROUP BY ticker
            ) p ON p.ticker = c.ticker
            ORDER BY in_smi DESC, c.name
        """)).mappings().all()

    with _lock:
        now_mono = time.monotonic()
        jobs = {}
        for ticker, job in _jobs.items():
            shown = {key: value for key, value in job.items() if key not in JOB_INTERNAL_KEYS}
            shown["stuck"] = is_stuck(job, now_mono)
            shown["waiting_seconds"] = round(now_mono - job["since"], 1) if "since" in job else 0
            jobs[ticker] = shown

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
