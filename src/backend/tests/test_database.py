"""Tests that need a real PostgreSQL. Skipped unless RACOON_TEST_DATABASE_URL names an empty throwaway database."""

import os
import time
from datetime import date, datetime, timezone

import pandas as pd
import pytest
from fastapi import HTTPException
from sqlalchemy import text

import racoon.loader as loader
from racoon.api import list_stocks
from racoon.backtest import MARKET_CAP, OWNERSHIP, backtest, fixed_rule, target_weights
from racoon.db import get_engine, init_db
from racoon.loader import FULL, HISTORY_START, QUEUED, QUEUED_STUCK_AFTER, STUCK_AFTER, TOP_UP
import racoon.portfolios as portfolios
from racoon.portfolios import (
    compare_portfolios,
    conflict_on_duplicate_name,
    fetch_prices,
    load_portfolio,
    load_portfolios,
    load_simulation,
)

pytestmark = pytest.mark.skipif(
    "RACOON_TEST_DATABASE_URL" not in os.environ,
    reason="set RACOON_TEST_DATABASE_URL to an empty throwaway database to run",
)


@pytest.fixture
def conn(monkeypatch):
    """A connection to the throwaway database, with the schema built and every table empty."""
    monkeypatch.setenv("DATABASE_URL", os.environ["RACOON_TEST_DATABASE_URL"])
    get_engine.cache_clear()
    init_db()
    with get_engine().connect() as connection:
        connection.execute(text("TRUNCATE holdings, portfolios, prices, company_fundamentals, index_membership, company_load_state, companies CASCADE"))
        connection.commit()
        yield connection
        connection.rollback()
    get_engine().dispose()
    get_engine.cache_clear()


LOAD_STATE_COLUMNS = ("price_start", "price_end", "price_count", "refreshed_at", "full_history")
SIZE_COLUMNS = ("market_cap", "shares_outstanding")


def add_company(conn, ticker, **columns):
    """A company with its load state; market_cap / shares_outstanding become a fundamentals row dated today."""
    state = {name: columns.pop(name) for name in LOAD_STATE_COLUMNS if name in columns}
    sizes = {name: columns.pop(name) for name in SIZE_COLUMNS if name in columns}
    names = ", ".join(["ticker", "name", *columns])
    values = ", ".join([":ticker", ":label", *(f":{name}" for name in columns)])
    conn.execute(text(f"INSERT INTO companies ({names}) VALUES ({values})"), {"ticker": ticker, "label": ticker, **columns})
    state_names = ", ".join(["ticker", *state])
    state_values = ", ".join([":ticker", *(f":{name}" for name in state)])
    conn.execute(text(f"INSERT INTO company_load_state ({state_names}) VALUES ({state_values})"), {"ticker": ticker, **state})
    if sizes:
        add_fundamentals(conn, ticker, date.today(), **sizes)
    conn.commit()


def add_fundamentals(conn, ticker, as_of, market_cap=None, shares_outstanding=None):
    conn.execute(
        text("INSERT INTO company_fundamentals VALUES (:ticker, :as_of, :market_cap, :shares)"),
        {"ticker": ticker, "as_of": as_of, "market_cap": market_cap, "shares": shares_outstanding},
    )


def add_prices(conn, ticker, days, close=10.0):
    for day in days:
        conn.execute(
            text("INSERT INTO prices (ticker, date, close) VALUES (:ticker, :day, :close)"),
            {"ticker": ticker, "day": day, "close": close},
        )
    conn.commit()


def add_portfolio(conn, name, tickers, weighting="equal"):
    portfolio_id = conn.execute(
        text("INSERT INTO portfolios (name, weighting) VALUES (:name, :weighting) RETURNING id"),
        {"name": name, "weighting": weighting},
    ).scalar_one()
    for ticker in tickers:
        conn.execute(
            text("INSERT INTO holdings (portfolio_id, ticker) VALUES (:id, :ticker)"),
            {"id": portfolio_id, "ticker": ticker},
        )
    conn.commit()
    return portfolio_id


@pytest.fixture
def seed_listing(conn, monkeypatch, tmp_path):
    """seed_listing(rows) writes these CSV rows (without the header) as the stock list and seeds the companies from it."""
    listing = tmp_path / "stocks.csv"
    monkeypatch.setattr(loader, "TICKERS_FILE", listing)

    def seed(rows):
        listing.write_text("ticker,name,exchange,country,yahoo_ticker,market\n" + "\n".join(rows) + "\n", encoding="utf-8")
        loader.seed_companies()
        conn.rollback()  # see the committed state

    return seed


def summary(conn, ticker):
    return tuple(conn.execute(
        text("SELECT price_count, price_start, price_end, full_history, refreshed_at FROM company_load_state WHERE ticker = :t"),
        {"t": ticker},
    ).one())


def test_load_portfolios_matches_load_portfolio_in_the_order_asked(conn):
    for ticker in ("AAA", "BBB"):
        add_company(conn, ticker, market_cap=1e9, shares_outstanding=1e6)
    first = add_portfolio(conn, "first", ["AAA", "BBB"])
    second = add_portfolio(conn, "second", ["BBB"])

    add_prices(conn, "AAA", [date(2026, 1, 2), date(2026, 1, 5)], close=20.0)
    add_prices(conn, "BBB", [date(2026, 1, 2)], close=30.0)
    add_company(conn, "CCC", shares_outstanding=1e6)
    owned = add_portfolio(conn, "owned", ["AAA", "BBB"], weighting="ownership")
    unloaded = add_portfolio(conn, "unloaded", ["BBB", "CCC"], weighting="ownership")  # CCC has no prices

    ids = [second, owned, first, unloaded]
    assert load_portfolios(conn, ids) == [load_portfolio(conn, portfolio_id) for portfolio_id in ids]
    weights = {holding["ticker"]: holding["target_weight"] for holding in load_portfolios(conn, [owned])[0]["holdings"]}
    assert weights == {"AAA": 0.4, "BBB": 0.6}  # sizes 1e6 x 20 and 1e6 x 30


def test_load_portfolios_reports_a_missing_id_as_404(conn):
    first = add_portfolio(conn, "first", [])

    with pytest.raises(HTTPException) as error:
        load_portfolios(conn, [first, first + 1000])
    assert error.value.status_code == 404


def test_a_duplicate_portfolio_name_is_a_409_and_undoes_the_half_done_change(conn):
    add_portfolio(conn, "taken", [])

    with pytest.raises(HTTPException) as error:
        with conflict_on_duplicate_name(conn):
            conn.execute(text("INSERT INTO portfolios (name, weighting) VALUES ('pending', 'equal')"))
            conn.execute(text("INSERT INTO portfolios (name, weighting) VALUES ('taken', 'equal')"))
    assert error.value.status_code == 409

    names = conn.execute(text("SELECT name FROM portfolios")).scalars().all()
    assert names == ["taken"]  # the pending insert was rolled back and the connection is usable again


def test_fetch_prices_says_loading_for_an_empty_stock_and_422_for_a_loaded_one_outside_the_range(conn):
    add_company(conn, "NEW")
    add_company(conn, "OLD", price_count=2, price_start=date(2020, 1, 2), price_end=date(2020, 1, 3))
    add_prices(conn, "OLD", [date(2020, 1, 2), date(2020, 1, 3)])

    with pytest.raises(HTTPException) as loading:
        fetch_prices(conn, ["NEW"])
    assert (loading.value.status_code, loading.value.detail) == (409, "Prices for NEW are still loading")

    with pytest.raises(HTTPException) as outside:
        fetch_prices(conn, ["OLD"], start=date(2024, 1, 1))
    assert outside.value.status_code == 422
    assert outside.value.detail == "No prices for OLD in this date range. Stored: 2020-01-02 to 2020-01-03."


class FakeYahoo:
    """Stands in for yf.Ticker: the first history call is the top-up, the next one the full reload."""

    def __init__(self, frames):
        self.frames = list(frames)
        self.starts = []
        self.fast_info = {"marketCap": 5e9, "shares": 1e6, "timezone": "Europe/Zurich"}

    def history(self, start, **_options):
        self.starts.append(start)
        return self.frames.pop(0)


def yahoo_frame(days, closes, splits):
    return pd.DataFrame(
        {
            "Open": closes, "High": closes, "Low": closes, "Close": closes, "Adj Close": closes,
            "Volume": [100.0] * len(days), "Dividends": [0.0] * len(days), "Stock Splits": splits,
        },
        index=pd.DatetimeIndex(days),
    )


def full_history_after_split():
    """The full reload Yahoo returns after the 2-for-1 split: every day on the post-split basis."""
    return yahoo_frame(["2023-12-29", "2024-01-02", "2024-01-03"], [50.0, 50.0, 50.0], [0.0, 0.0, 2.0])


def add_stock_about_to_split(conn, ticker):
    """A fully loaded stock with one stored day, and the top-up Yahoo returns: a 2-for-1 split on the next day."""
    add_company(conn, ticker, price_count=1, price_start=date(2024, 1, 2), price_end=date(2024, 1, 2), full_history=True)
    add_prices(conn, ticker, [date(2024, 1, 2)], close=100.0)
    return yahoo_frame(["2024-01-02", "2024-01-03"], [100.0, 50.0], [0.0, 2.0])


def test_a_new_split_turns_a_top_up_into_a_full_reload(conn, monkeypatch):
    top_up = add_stock_about_to_split(conn, "SPL")
    fake = FakeYahoo([top_up, full_history_after_split()])
    monkeypatch.setattr(loader.yf, "Ticker", lambda ticker: fake)

    done = loader._load("SPL", TOP_UP)

    assert done["kind"] == FULL
    assert fake.starts == ["2024-01-02", HISTORY_START]
    assert done["stored"] == 3 and done["first"] == "2023-12-29"
    closes = conn.execute(text("SELECT close FROM prices WHERE ticker = 'SPL'")).scalars().all()
    assert closes == [50.0, 50.0, 50.0]  # the old 100.0 row was rewritten with the adjusted history


def test_a_split_reload_scales_the_older_share_counts_but_not_todays_row(conn, monkeypatch):
    top_up = add_stock_about_to_split(conn, "SPS")
    monkeypatch.setattr(loader.yf, "Ticker", lambda ticker: FakeYahoo([top_up, full_history_after_split()]))
    add_fundamentals(conn, "SPS", date(2023, 1, 1), market_cap=1e9, shares_outstanding=100.0)
    add_fundamentals(conn, "SPS", date(2023, 6, 1), market_cap=1e9, shares_outstanding=None)
    conn.commit()

    loader._load("SPS", TOP_UP)

    conn.rollback()
    rows = [tuple(row) for row in conn.execute(text(
        "SELECT as_of, market_cap, shares_outstanding FROM company_fundamentals ORDER BY as_of"
    ))]
    assert rows == [
        (date(2023, 1, 1), 1e9, 200.0),  # 100 shares before the 2-for-1 split are 200 after it
        (date(2023, 6, 1), 1e9, None),  # a missing count stays missing
        (date.today(), 5e9, 1e6),  # today's row comes from Yahoo as it is
    ]

    # The split is stored now, so loading again does not scale the counts a second time.
    conn.execute(text("UPDATE company_fundamentals SET as_of = as_of - 1 WHERE as_of = :today"), {"today": date.today()})
    conn.commit()
    again = yahoo_frame(["2024-01-02", "2024-01-03"], [50.0, 50.0], [0.0, 2.0])
    monkeypatch.setattr(loader.yf, "Ticker", lambda ticker: FakeYahoo([again]))
    loader._load("SPS", TOP_UP)
    conn.rollback()
    assert conn.execute(text("SELECT shares_outstanding FROM company_fundamentals WHERE as_of = :d"), {"d": date(2023, 1, 1)}).scalar_one() == 200.0


def test_a_split_whose_full_reload_comes_back_empty_fails_the_job_and_writes_nothing(conn, monkeypatch):
    top_up = add_stock_about_to_split(conn, "SPE")
    empty = yahoo_frame([], [], [])
    monkeypatch.setattr(loader.yf, "Ticker", lambda ticker: FakeYahoo([top_up, empty]))

    with pytest.raises(RuntimeError, match="after a split"):
        loader._load("SPE", TOP_UP)

    assert conn.execute(text("SELECT count(*) FROM prices WHERE ticker = 'SPE'")).scalar_one() == 1
    assert summary(conn, "SPE")[0] == 1


def test_reconcile_summaries_corrects_a_drifted_count_and_resets_an_emptied_stock(conn):
    add_company(conn, "DRIFT", price_count=5, price_start=date(2020, 1, 1), price_end=date(2020, 1, 9), full_history=True)
    add_prices(conn, "DRIFT", [date(2020, 1, 2), date(2020, 1, 3)])
    add_company(conn, "GONE", price_count=3, full_history=True, refreshed_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    add_company(conn, "DATES", price_count=1, price_start=date(2019, 1, 1), price_end=date(2020, 1, 2), full_history=True)
    add_prices(conn, "DATES", [date(2020, 1, 2)])  # the count matches, the first day does not
    add_company(conn, "FINE", price_count=1, price_start=date(2020, 1, 2), price_end=date(2020, 1, 2), full_history=True)
    add_prices(conn, "FINE", [date(2020, 1, 2)])

    loader.reconcile_summaries()
    conn.rollback()  # start a fresh transaction so the new values are visible

    assert summary(conn, "DRIFT")[:4] == (2, date(2020, 1, 2), date(2020, 1, 3), True)  # recounted, history kept
    assert summary(conn, "GONE") == (0, None, None, False, None)  # nothing left: the next load starts from scratch
    assert summary(conn, "FINE")[0] == 1
    assert summary(conn, "DATES")[:3] == (1, date(2020, 1, 2), date(2020, 1, 2))


class RecordingPool:
    def __init__(self):
        self.submitted = []

    def submit(self, function, *arguments):
        self.submitted.append((function, *arguments))


class FakeThread:
    def __init__(self, alive):
        self.alive = alive

    def is_alive(self):
        return self.alive


def test_ensure_queues_a_loading_job_whose_thread_died_but_never_a_queued_or_live_one(conn, monkeypatch):
    for ticker in ("LOST", "SLOW", "WAITING", "FRESH"):
        add_company(conn, ticker)
    pool = RecordingPool()
    now = time.monotonic()
    old = now - STUCK_AFTER * 4
    loading_since_long_ago = {"state": loader.LOADING, "error": None, "kind": FULL, "since": old, "started": old}
    jobs = {
        "LOST": {**loading_since_long_ago, "thread": FakeThread(False)},
        "SLOW": {**loading_since_long_ago, "thread": FakeThread(True)},
        "WAITING": {"state": QUEUED, "error": None, "kind": FULL, "since": now - QUEUED_STUCK_AFTER - 1},
        "FRESH": {"state": QUEUED, "error": None, "kind": FULL, "since": now},
    }
    monkeypatch.setattr(loader, "_pool", pool)
    monkeypatch.setattr(loader, "_jobs", jobs)

    report = loader.ensure(["LOST", "SLOW", "WAITING", "FRESH"])

    assert pool.submitted == [(loader._run, "LOST", FULL)]  # a queued job will run by itself
    assert all(state["state"] == "loading" for state in report["states"].values())
    stuck = {ticker: state["detail"].get("stuck", False) for ticker, state in report["states"].items()}
    assert stuck == {"LOST": False, "SLOW": True, "WAITING": True, "FRESH": False}  # LOST is a new queued job


def test_seed_companies_keeps_one_open_membership_per_listed_market_and_closes_the_rest(conn, seed_listing):
    def seed(rows):
        seed_listing(rows)
        return [tuple(row) for row in conn.execute(text(
            "SELECT ticker, market, valid_to IS NULL FROM index_membership ORDER BY ticker, market, valid_from"
        ))]

    assert seed(["A,A Ltd,SIX,CH,A.SW,SMI", "B,B Ltd,SIX,CH,B.SW,SMI;SPI", "C,C Ltd,SIX,CH,C.SW,"]) == [
        ("A.SW", "SMI", True), ("B.SW", "SMI", True), ("B.SW", "SPI", True),
    ]
    assert conn.execute(text("SELECT count(*) FROM company_load_state")).scalar_one() == 3  # also for C, in no market
    seed(["A,A Ltd,SIX,CH,A.SW,SMI", "B,B Ltd,SIX,CH,B.SW,SMI;SPI", "C,C Ltd,SIX,CH,C.SW,"])  # nothing changes
    assert conn.execute(text("SELECT count(*) FROM index_membership")).scalar_one() == 3
    conn.execute(text("UPDATE index_membership SET valid_from = valid_from - 30"))  # long-standing memberships
    conn.commit()

    # B leaves the SMI and C joins it: the old row is closed today, the new one opened today.
    changed = seed(["A,A Ltd,SIX,CH,A.SW,SMI", "B,B Ltd,SIX,CH,B.SW,SPI", "C,C Ltd,SIX,CH,C.SW,SMI"])
    assert changed == [("A.SW", "SMI", True), ("B.SW", "SMI", False), ("B.SW", "SPI", True), ("C.SW", "SMI", True)]
    closed = conn.execute(text("SELECT valid_to FROM index_membership WHERE ticker = 'B.SW' AND market = 'SMI'")).scalar_one()
    assert closed == conn.execute(text("SELECT CURRENT_DATE")).scalar_one()

    # Listed again on the same day: the closed row is reopened rather than colliding with its key.
    again = seed(["A,A Ltd,SIX,CH,A.SW,SMI", "B,B Ltd,SIX,CH,B.SW,SMI;SPI", "C,C Ltd,SIX,CH,C.SW,SMI"])
    assert ("B.SW", "SMI", True) in again and len(again) == 5  # the earlier SMI stretch stays as history


def test_a_membership_that_began_today_is_deleted_not_closed_and_a_dropped_stock_is_closed(conn, seed_listing):
    def seed(rows):
        seed_listing(rows)
        return [tuple(row) for row in conn.execute(text(
            "SELECT ticker, market, valid_from < CURRENT_DATE, valid_to IS NULL FROM index_membership ORDER BY ticker, market, valid_from"
        ))]

    assert seed(["A,A Ltd,SIX,CH,A.SW,SMI"]) == [("A.SW", "SMI", False, True)]
    assert seed(["A,A Ltd,SIX,CH,A.SW,"]) == []  # opened and closed today: no zero-length row is left
    assert seed(["A,A Ltd,SIX,CH,A.SW,SMI"]) == [("A.SW", "SMI", False, True)]  # listed again: simply inserted

    conn.execute(text("UPDATE index_membership SET valid_from = valid_from - 30"))
    conn.commit()
    assert seed(["B,B Ltd,SIX,CH,B.SW,SMI"]) == [  # A is gone from the file altogether
        ("A.SW", "SMI", True, False), ("B.SW", "SMI", False, True),
    ]
    assert conn.execute(text("SELECT count(*) FROM index_membership WHERE valid_from = valid_to")).scalar_one() == 0


def test_seeding_gives_each_stock_its_exchange_timezone_until_yahoo_reports_one(conn, seed_listing):
    rows = ["A,A Ltd,SIX,CH,A.SW,", "B,B Ltd,XXX,US,B.XX,"]

    def zones():
        return dict(conn.execute(text("SELECT ticker, exchange_timezone FROM companies")).all())

    seed_listing(rows)
    assert zones() == {"A.SW": "Europe/Zurich", "B.XX": None}  # an unmapped exchange stays unknown (UTC)

    conn.execute(text("UPDATE companies SET exchange_timezone = 'Europe/London' WHERE ticker = 'A.SW'"))
    conn.commit()
    seed_listing(rows)
    assert zones()["A.SW"] == "Europe/London"  # a zone Yahoo gave is not overwritten by the fallback


def test_a_full_load_stores_todays_sizes_and_the_exchange_timezone_and_keeps_them_when_yahoo_omits_them(conn, monkeypatch):
    add_company(conn, "TZ")
    frame = yahoo_frame(["2024-01-02", "2024-01-03"], [10.0, 11.0], [0.0, 0.0])
    fake = FakeYahoo([frame])
    monkeypatch.setattr(loader.yf, "Ticker", lambda ticker: fake)

    loader._load("TZ", FULL)
    conn.rollback()
    assert conn.execute(text("SELECT exchange_timezone FROM companies WHERE ticker = 'TZ'")).scalar_one() == "Europe/Zurich"
    assert [tuple(row) for row in conn.execute(text("SELECT as_of, market_cap, shares_outstanding FROM company_fundamentals"))] == [
        (date.today(), 5e9, 1e6)
    ]

    # A later load on another day where Yahoo only knows the market cap: a new row that keeps the share count.
    conn.execute(text("UPDATE company_fundamentals SET as_of = :old"), {"old": date(2020, 1, 1)})
    conn.commit()
    partial = FakeYahoo([frame])
    partial.fast_info = {"marketCap": 6e9}
    monkeypatch.setattr(loader.yf, "Ticker", lambda ticker: partial)
    loader._load("TZ", FULL)
    conn.rollback()
    rows = [tuple(row) for row in conn.execute(text(
        "SELECT as_of, market_cap, shares_outstanding FROM company_fundamentals ORDER BY as_of"
    ))]
    assert rows == [(date(2020, 1, 1), 5e9, 1e6), (date.today(), 6e9, 1e6)]
    assert conn.execute(text("SELECT exchange_timezone FROM companies WHERE ticker = 'TZ'")).scalar_one() == "Europe/Zurich"
    assert loader._company_meta(["TZ"])["TZ"]["market_cap"] == 6e9  # the sizes of the newest row


def test_company_meta_and_the_stock_list_read_the_newest_fundamentals_and_the_current_markets(conn):
    add_company(conn, "IN", price_count=2, price_start=date(2020, 1, 2), price_end=date(2020, 1, 3), full_history=True)
    add_company(conn, "OUT", shares_outstanding=2e6)
    add_fundamentals(conn, "IN", date(2020, 1, 1), market_cap=1e9, shares_outstanding=1e6)
    add_fundamentals(conn, "IN", date(2021, 1, 1), market_cap=3e9, shares_outstanding=2e6)
    conn.execute(text("""
        INSERT INTO index_membership (market, ticker, valid_from, valid_to) VALUES
            ('SMI', 'IN', '2000-01-01', NULL), ('SPI', 'IN', '2000-01-01', NULL), ('SMIM', 'IN', '1999-01-01', '2005-01-01'),
            ('SMI', 'OUT', '1999-01-01', '2010-01-01')
    """))
    conn.commit()

    meta = loader._company_meta(["IN", "OUT"])
    assert (meta["IN"]["market_cap"], meta["IN"]["shares_outstanding"], meta["IN"]["price_count"]) == (3e9, 2e6, 2)
    assert (meta["OUT"]["market_cap"], meta["OUT"]["shares_outstanding"]) == (None, 2e6)

    stocks = {stock["ticker"]: stock for stock in list_stocks(conn)}
    assert (stocks["IN"]["in_smi"], stocks["IN"]["markets"]) == (True, ["SMI", "SPI"])
    assert (stocks["OUT"]["in_smi"], stocks["OUT"]["markets"]) == (False, [])  # left the SMI in 2010
    assert (stocks["IN"]["market_cap"], stocks["IN"]["count"], stocks["IN"]["loaded"]) == (3e9, 2, True)
    assert list(stocks) == ["IN", "OUT"]  # SMI members first


def add_two_stock_portfolio(conn, weighting):
    """Two stocks with a year of prices (A drifting up, B flat), one fundamentals row each, and a portfolio over them."""
    for ticker in ("A", "B"):
        add_company(conn, ticker)
    days = [day.strftime("%Y-%m-%d") for day in pd.bdate_range("2024-01-01", "2024-12-31")]
    for index, day in enumerate(days):
        conn.execute(
            text("INSERT INTO prices (ticker, date, close) VALUES ('A', :day, :a), ('B', :day, 40)"),
            {"day": day, "a": 20 + index * 0.1},
        )
    conn.execute(
        text("UPDATE company_load_state SET price_start = :first, price_end = :last, price_count = :n, full_history = TRUE"),
        {"first": days[0], "last": days[-1], "n": len(days)},
    )
    add_fundamentals(conn, "A", date(2023, 1, 1), market_cap=6e9, shares_outstanding=3e6)
    add_fundamentals(conn, "B", date(2023, 1, 1), market_cap=2e9, shares_outstanding=1e6)
    return add_portfolio(conn, f"{weighting}-pf", ["A", "B"], weighting=weighting)


def test_size_weighted_backtests_with_one_fundamentals_row_equal_the_single_size_calculation(conn):
    market_cap_id = add_two_stock_portfolio(conn, "market_cap")
    ownership_id = add_portfolio(conn, "ownership-pf", ["A", "B"], weighting="ownership")
    rules = dict(initial=10_000, inflow=200, invest_frequency="monthly")
    holdings = [{"ticker": "A"}, {"ticker": "B"}]

    simulation = load_simulation(conn, market_cap_id, None, None)
    reference = fixed_rule(target_weights(holdings, MARKET_CAP, {"A": 6e9, "B": 2e9}))
    assert backtest(simulation.closes, simulation.dividends, simulation.rule, **rules) == backtest(
        simulation.closes, simulation.dividends, reference, **rules
    )

    simulation = load_simulation(conn, ownership_id, None, None)
    shares = {"A": 3e6, "B": 1e6}
    reference = lambda prices, day: target_weights(
        holdings, OWNERSHIP, {ticker: shares[ticker] * prices[ticker] for ticker in shares}
    )
    result = backtest(simulation.closes, simulation.dividends, simulation.rule, **rules)
    assert result == backtest(simulation.closes, simulation.dividends, reference, **rules)
    assert result["summary"]["purchases"] > 0


def test_a_size_weighted_backtest_uses_the_fundamentals_row_valid_on_each_day(conn):
    portfolio_id = add_two_stock_portfolio(conn, "market_cap")
    add_fundamentals(conn, "A", date(2024, 7, 1), market_cap=2e9, shares_outstanding=3e6)  # A shrinks in July

    simulation = load_simulation(conn, portfolio_id, None, None)
    holdings = [{"ticker": "A"}, {"ticker": "B"}]
    prices_that_day = {"A": 20.0, "B": 40.0}

    early = simulation.rule(prices_that_day, "2024-03-01")
    late = simulation.rule(prices_that_day, "2024-09-02")
    assert early == target_weights(holdings, MARKET_CAP, {"A": 6e9, "B": 2e9})  # the 2023 row
    assert late == target_weights(holdings, MARKET_CAP, {"A": 2e9, "B": 2e9})  # the July 2024 row
    assert simulation.rule(prices_that_day, "2022-01-01") == early  # before the first row: the earliest


def test_size_weighted_portfolios_without_any_stored_size_are_a_409_not_a_crash(conn):
    market_cap_id = add_two_stock_portfolio(conn, "market_cap")
    ownership_id = add_portfolio(conn, "ownership-pf", ["A", "B"], weighting="ownership")
    conn.execute(text("DELETE FROM company_fundamentals"))
    conn.commit()

    for portfolio_id in (market_cap_id, ownership_id):
        with pytest.raises(HTTPException) as error:
            load_simulation(conn, portfolio_id, None, None)
        assert error.value.status_code == 409
        assert "still loading" in error.value.detail


def test_comparing_portfolios_fetches_the_size_histories_once(conn, monkeypatch):
    first = add_two_stock_portfolio(conn, "market_cap")
    second = add_portfolio(conn, "ownership-pf", ["A", "B"], weighting="ownership")
    third = add_portfolio(conn, "equal-pf", ["A", "B"])
    fetched = []
    real = portfolios.fetch_size_history
    monkeypatch.setattr(portfolios, "fetch_size_history", lambda *args: fetched.append(args[2]) or real(*args))

    result = compare_portfolios(f"{first},{second},{third}", None, None, 10000, 0, "monthly", conn)

    assert sorted(fetched) == ["market_cap", "shares_outstanding"]  # two queries in all, not one per portfolio
    assert len(result["portfolios"]) == 3
