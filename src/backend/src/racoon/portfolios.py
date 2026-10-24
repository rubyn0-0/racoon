from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from racoon.backtest import (
    INFLOW_FREQUENCIES,
    INVEST_FREQUENCIES,
    MONTHLY,
    backtest,
    common_window,
    fixed_rule,
    limiting_stock,
    market_cap_rule,
    ownership_rule,
    plan,
    target_weights,
)
from racoon.constants import LATEST_FUNDAMENTALS, MANUAL, MARKET_CAP, OWNERSHIP, WEIGHTINGS
from racoon.db import get_conn

router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])

NAME_MAX_LENGTH = 80  # the frontend mirrors this as PORTFOLIO_NAME_MAX_LENGTH
DUPLICATE_NAME_ERROR = "A portfolio with this name already exists."
SIZES_LOADING_ERROR = "Company sizes for this portfolio are still loading. Try again in a moment."
SIZE_COLUMNS = {MARKET_CAP: "market_cap", OWNERSHIP: "shares_outstanding"}  # the column each size weighting reads
CURRENCY = "CHF"
PORTFOLIO_COLUMNS = """
    id, name, weighting, invest_frequency, inflow_amount, inflow_frequency,
    to_char(start_date, 'YYYY-MM-DD') AS start_date, initial_capital
"""
MIN_COMPARE, MAX_COMPARE = 2, 6  # the frontend mirrors these
PRICE_MARGIN_DAYS = 7  # prices fetched before a requested start, so holidays can carry the last close forward
MAX_PLAN_DAYS = 1830  # the plan looks at most five years ahead
DEFAULT_PLAN_DAYS = 366


class HoldingIn(BaseModel):
    ticker: str
    weight: float | None = Field(default=None, gt=0, description="Only used with manual weighting")
    start_shares: float | None = Field(default=None, ge=0, description="Shares transferred when the portfolio opens")
    selected: bool = Field(default=True, description="Whether this available stock is active in the portfolio")


class WeightsIn(BaseModel):
    weighting: Literal[WEIGHTINGS]
    holdings: list[HoldingIn] = Field(min_length=1)


class PortfolioIn(WeightsIn):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    invest_frequency: Literal[INVEST_FREQUENCIES] = MONTHLY
    inflow_amount: float = Field(default=0, ge=0, description=f"{CURRENCY} of new money per inflow period")
    inflow_frequency: Literal[INFLOW_FREQUENCIES] = MONTHLY
    start_date: date | None = Field(default=None, description="Optional portfolio opening date")
    initial_capital: float = Field(default=0, ge=0, description=f"{CURRENCY} invested on the first day")


def fetch_companies(conn, tickers):
    """ticker -> name and the current (newest) market cap and shares outstanding."""
    rows = conn.execute(
        text(f"""
            SELECT c.ticker, c.name, f.market_cap, f.shares_outstanding
            FROM companies c {LATEST_FUNDAMENTALS} WHERE c.ticker = ANY(:tickers)
        """),
        {"tickers": tickers},
    ).mappings().all()
    return {row["ticker"]: row for row in rows}


def resolve_holdings(conn, weighting, holdings, strict=True, companies=None, closes=None):
    """Check the holdings against the companies table and attach each target weight.

    With strict=False a company whose size is not loaded yet leaves the weights empty (None) instead of
    failing, so saved portfolios can still be listed before their stocks have been opened.
    Pass companies (ticker -> row) and closes (ticker -> latest close) when they were already fetched for
    many portfolios at once.
    """
    tickers = [holding["ticker"] for holding in holdings]
    selected = [holding for holding in holdings if holding.get("selected", True)]
    selected_tickers = [holding["ticker"] for holding in selected]
    if len(set(tickers)) != len(tickers):
        raise HTTPException(status_code=422, detail="Each stock can only be added once.")
    if not selected:
        raise HTTPException(status_code=422, detail="Select at least one stock.")
    if weighting == MANUAL and any(holding["weight"] is None for holding in selected):
        raise HTTPException(status_code=422, detail="Give every stock a weight, or pick another weighting.")

    if companies is None:
        companies = fetch_companies(conn, tickers)

    unknown = [ticker for ticker in tickers if ticker not in companies]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown stock: {', '.join(unknown)}")

    sizes = None
    if weighting == MARKET_CAP:
        sizes = {ticker: companies[ticker]["market_cap"] for ticker in selected_tickers}
        missing = [companies[ticker]["name"] for ticker in selected_tickers if not sizes[ticker]]
        if missing and strict:
            raise HTTPException(
                status_code=422,
                detail=f"No market cap stored for {', '.join(missing)}. Open the stock once so it loads.",
            )
        if missing:
            sizes = None
    elif weighting == OWNERSHIP:
        sizes = ownership_sizes(conn, selected_tickers, companies, strict, closes)

    if sizes is None and weighting in (MARKET_CAP, OWNERSHIP):
        weights = dict.fromkeys(selected_tickers)
    else:
        weights = target_weights(selected, weighting, sizes)
    return [
        {
            "ticker": holding["ticker"],
            "company": companies[holding["ticker"]]["name"],
            "selected": holding.get("selected", True),
            "weight": holding["weight"] if weighting == MANUAL and holding.get("selected", True) else None,
            "start_shares": holding.get("start_shares"),
            "target_weight": weights.get(holding["ticker"]),
        }
        for holding in holdings
    ]


def fetch_latest_closes(conn, tickers):
    """ticker -> the most recent close, for the tickers that have one."""
    latest = conn.execute(
        text("""
            SELECT DISTINCT ON (ticker) ticker, close
            FROM prices
            WHERE ticker = ANY(:tickers) AND close IS NOT NULL
            ORDER BY ticker, date DESC
        """),
        {"tickers": tickers},
    ).mappings().all()
    return {row["ticker"]: row["close"] for row in latest}


def ownership_sizes(conn, tickers, companies, strict=True, closes=None):
    """Value of all shares of each company today (shares outstanding x latest close); None if not loaded.

    Pass closes (ticker -> latest close) when they were already fetched; otherwise they are queried here.
    """
    if closes is None:
        closes = fetch_latest_closes(conn, tickers)

    missing = [
        companies[ticker]["name"]
        for ticker in tickers
        if not companies[ticker]["shares_outstanding"] or ticker not in closes
    ]
    if missing:
        if strict:
            raise HTTPException(
                status_code=422,
                detail=f"No share count or prices stored for {', '.join(missing)}. Open the stock once so it loads.",
            )
        return None
    return {ticker: companies[ticker]["shares_outstanding"] * closes[ticker] for ticker in tickers}


def require_portfolio(conn, portfolio_id):
    """404 unless the portfolio exists; cheaper than loading it with its holdings."""
    exists = conn.execute(text("SELECT 1 FROM portfolios WHERE id = :id"), {"id": portfolio_id}).first()
    if exists is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")


def load_portfolio(conn, portfolio_id):
    portfolio = conn.execute(
        text(f"SELECT {PORTFOLIO_COLUMNS} FROM portfolios WHERE id = :id"),
        {"id": portfolio_id},
    ).mappings().first()
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    holdings = conn.execute(
        text("SELECT ticker, weight, start_shares, selected FROM holdings WHERE portfolio_id = :id ORDER BY ticker"),
        {"id": portfolio_id},
    ).mappings().all()

    return {
        **portfolio,
        "holdings": resolve_holdings(conn, portfolio["weighting"], [dict(row) for row in holdings], strict=False),
    }


def load_portfolios(conn, portfolio_ids):
    """Several portfolios with their holdings in four queries in total (five when one of them is weighted
    by ownership, which needs the latest closes once for all of them), in the order of portfolio_ids."""
    rows = conn.execute(
        text(f"SELECT {PORTFOLIO_COLUMNS} FROM portfolios WHERE id = ANY(:ids)"),
        {"ids": portfolio_ids},
    ).mappings().all()
    portfolios = {row["id"]: row for row in rows}
    if any(portfolio_id not in portfolios for portfolio_id in portfolio_ids):
        raise HTTPException(status_code=404, detail="Portfolio not found")

    holding_rows = conn.execute(
        text("""
            SELECT portfolio_id, ticker, weight, start_shares, selected
            FROM holdings WHERE portfolio_id = ANY(:ids) ORDER BY ticker
        """),
        {"ids": portfolio_ids},
    ).mappings().all()
    holdings = {portfolio_id: [] for portfolio_id in portfolio_ids}
    for row in holding_rows:
        holdings[row["portfolio_id"]].append({key: row[key] for key in ("ticker", "weight", "start_shares", "selected")})

    companies = fetch_companies(conn, sorted({row["ticker"] for row in holding_rows}))
    ownership_tickers = sorted({
        holding["ticker"]
        for portfolio_id in portfolio_ids if portfolios[portfolio_id]["weighting"] == OWNERSHIP
        for holding in holdings[portfolio_id]
    })
    closes = fetch_latest_closes(conn, ownership_tickers) if ownership_tickers else None

    loaded = []
    for portfolio_id in portfolio_ids:
        portfolio = portfolios[portfolio_id]
        resolved = resolve_holdings(
            conn, portfolio["weighting"], holdings[portfolio_id], strict=False, companies=companies, closes=closes
        )
        loaded.append({**portfolio, "holdings": resolved})
    return loaded


def selected_holdings(portfolio):
    """The available stocks currently enabled for weighting, simulation and comparison."""
    return [holding for holding in portfolio["holdings"] if holding.get("selected", True)]


def backtest_holdings(portfolio):
    """Strategy stocks plus any unselected stocks with transferred shares."""
    return [
        holding
        for holding in portfolio["holdings"]
        if holding.get("selected", True) or (holding.get("start_shares") or 0) > 0
    ]


def rule_params(body):
    """The portfolio rule columns set by a create or update request."""
    return {
        "name": body.name.strip(),
        "weighting": body.weighting,
        "invest_frequency": body.invest_frequency,
        "inflow_amount": body.inflow_amount,
        "inflow_frequency": body.inflow_frequency,
        "start_date": body.start_date,
        "initial_capital": body.initial_capital,
    }


def save_holdings(conn, portfolio_id, body):
    conn.execute(text("DELETE FROM holdings WHERE portfolio_id = :id"), {"id": portfolio_id})
    conn.execute(
        text("""
            INSERT INTO holdings (portfolio_id, ticker, weight, start_shares, selected)
            VALUES (:id, :ticker, :weight, :start_shares, :selected)
        """),
        [
            {
                "id": portfolio_id,
                "ticker": holding.ticker,
                "weight": holding.weight if body.weighting == MANUAL and holding.selected else None,
                # Starting positions are tracked independently of investment-strategy selection.
                "start_shares": holding.start_shares,
                "selected": holding.selected,
            }
            for holding in body.holdings
        ],
    )


@contextmanager
def conflict_on_duplicate_name(conn):
    """Turn the database refusing a duplicate portfolio name into a 409, after undoing the half-done change."""
    try:
        yield
    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail=DUPLICATE_NAME_ERROR)


def commit_or_conflict(conn):
    with conflict_on_duplicate_name(conn):
        conn.commit()


@router.get("")
def list_portfolios(conn=Depends(get_conn)):
    ids = conn.execute(text("SELECT id FROM portfolios ORDER BY name")).scalars().all()
    return load_portfolios(conn, ids)


@router.post("/weights")
def preview_weights(body: WeightsIn, conn=Depends(get_conn)):
    """Target weights for an unsaved draft, so the editor can show them while you type."""
    return resolve_holdings(conn, body.weighting, [holding.model_dump() for holding in body.holdings])


@router.post("", status_code=201)
def create_portfolio(body: PortfolioIn, conn=Depends(get_conn)):
    resolve_holdings(conn, body.weighting, [holding.model_dump() for holding in body.holdings])
    with conflict_on_duplicate_name(conn):
        portfolio_id = conn.execute(
            text("""
                INSERT INTO portfolios (
                    name, weighting, invest_frequency, inflow_amount, inflow_frequency, start_date, initial_capital
                )
                VALUES (
                    :name, :weighting, :invest_frequency, :inflow_amount, :inflow_frequency, :start_date, :initial_capital
                )
                RETURNING id
            """),
            rule_params(body),
        ).scalar_one()

    save_holdings(conn, portfolio_id, body)
    commit_or_conflict(conn)
    return load_portfolio(conn, portfolio_id)


@router.get("/compare")
def compare_portfolios(
    ids: str = Query(description="Comma separated portfolio ids"),
    start: date | None = None,
    end: date | None = None,
    initial: float = Query(10000, ge=0, description=f"{CURRENCY} invested on the first day"),
    inflow: float = Query(0, ge=0, description=f"{CURRENCY} of new money per inflow period"),
    inflow_frequency: Literal[INFLOW_FREQUENCIES] = MONTHLY,
    conn=Depends(get_conn),
):
    """Run several portfolios on the same days with the same money; each keeps its own stocks and weighting."""
    try:
        portfolio_ids = list(dict.fromkeys(int(part) for part in ids.split(",")))
    except ValueError:
        raise HTTPException(status_code=422, detail="ids must be a comma separated list of numbers")
    if not MIN_COMPARE <= len(portfolio_ids) <= MAX_COMPARE:
        raise HTTPException(status_code=422, detail=f"Pick {MIN_COMPARE} to {MAX_COMPARE} portfolios.")
    if initial + inflow <= 0:
        raise HTTPException(status_code=422, detail="Invest a starting amount, new money, or both.")

    # The prices of every stock involved come from one query, then each portfolio takes its columns.
    portfolios = load_portfolios(conn, portfolio_ids)
    tickers = sorted({holding["ticker"] for portfolio in portfolios for holding in selected_holdings(portfolio)})
    raw_closes, raw_dividends = fetch_prices(conn, tickers, start)
    size_histories = None
    if any(portfolio["weighting"] in (MARKET_CAP, OWNERSHIP) for portfolio in portfolios):
        size_histories = {column: fetch_size_history(conn, tickers, column) for column in SIZE_COLUMNS.values()}

    shared = {"initial": initial, "inflow": inflow, "inflow_frequency": inflow_frequency}
    simulations = [
        build_simulation(conn, portfolio, raw_closes, raw_dividends, start, end, shared, size_histories)
        for portfolio in portfolios
    ]
    first, last = common_window([simulation.closes for simulation in simulations])
    if first > last:
        raise HTTPException(status_code=422, detail="These portfolios have no trading days in common.")

    # Portfolios of different stocks can have different holidays, so line them all up on every day any of them traded.
    dates = sorted(set().union(*[set(simulation.closes.loc[first:last].index) for simulation in simulations]))

    compared = []
    for simulation in simulations:
        result = backtest(
            simulation.closes.reindex(dates, method="ffill"),
            simulation.dividends.reindex(dates).fillna(0.0),
            simulation.rule,
            **simulation.rules,
        )
        compared.append({
            "id": simulation.portfolio["id"],
            "name": simulation.portfolio["name"],
            "weighting": simulation.portfolio["weighting"],
            "invest_frequency": simulation.portfolio["invest_frequency"],
            "summary": result["summary"],
            "values": [row["value"] for row in result["series"]],
            "invested": [row["invested"] for row in result["series"]],
        })

    # The test starts when the last-listed stock does; say which one that is.
    limited_by = next(
        (
            simulation.limited_by
            for simulation in simulations
            if simulation.closes.index[0] == first and simulation.limited_by
        ),
        None,
    )

    # Same days and same money, so the paid-in line is the same for everyone.
    return {
        "start_date": first,
        "end_date": last,
        "settings": {"initial_capital": initial, "inflow_amount": inflow, "inflow_frequency": inflow_frequency},
        "limited_by": limited_by,
        "dates": dates,
        "invested": compared[0]["invested"],
        "portfolios": [{key: value for key, value in item.items() if key != "invested"} for item in compared],
    }


@router.get("/{portfolio_id}")
def get_portfolio(portfolio_id: int, conn=Depends(get_conn)):
    return load_portfolio(conn, portfolio_id)


@router.put("/{portfolio_id}")
def update_portfolio(portfolio_id: int, body: PortfolioIn, conn=Depends(get_conn)):
    require_portfolio(conn, portfolio_id)
    resolve_holdings(conn, body.weighting, [holding.model_dump() for holding in body.holdings])
    with conflict_on_duplicate_name(conn):
        conn.execute(
            text("""
                UPDATE portfolios SET
                    name = :name, weighting = :weighting, invest_frequency = :invest_frequency,
                    inflow_amount = :inflow_amount, inflow_frequency = :inflow_frequency,
                    start_date = :start_date, initial_capital = :initial_capital
                WHERE id = :id
            """),
            {"id": portfolio_id, **rule_params(body)},
        )

    save_holdings(conn, portfolio_id, body)
    commit_or_conflict(conn)
    return load_portfolio(conn, portfolio_id)


@router.delete("/{portfolio_id}", status_code=204)
def delete_portfolio(portfolio_id: int, conn=Depends(get_conn)):
    require_portfolio(conn, portfolio_id)
    conn.execute(text("DELETE FROM portfolios WHERE id = :id"), {"id": portfolio_id})
    conn.commit()
    return Response(status_code=204)


@dataclass
class Simulation:
    """A saved portfolio together with the prices and rules needed to run it."""

    portfolio: dict
    closes: pd.DataFrame
    dividends: pd.DataFrame
    rule: object
    rules: dict
    limited_by: dict | None  # the stock whose late listing shortens the test, if any


def raise_missing_prices(conn, missing):
    """409 while any of these tickers has no prices stored yet, else 422 naming the range that is stored."""
    stored = conn.execute(
        text("SELECT ticker, price_count, price_start, price_end FROM company_load_state WHERE ticker = ANY(:tickers)"),
        {"tickers": missing},
    ).all()
    loaded = {ticker: (first, last) for ticker, count, first, last in stored if count > 0}
    loading = [ticker for ticker in missing if ticker not in loaded]
    if loading:
        raise HTTPException(status_code=409, detail=f"Prices for {', '.join(loading)} are still loading")

    detail = " ".join(
        f"No prices for {ticker} in this date range. Stored: {first:%Y-%m-%d} to {last:%Y-%m-%d}."
        for ticker, (first, last) in loaded.items()
    )
    raise HTTPException(status_code=422, detail=detail)


def fetch_prices(conn, tickers, start=None):
    """Closes and dividends of these tickers as two tables (one column per ticker) on the same days.

    One date-bounded query returning plain tuples. A ticker with no stored prices is still being loaded,
    which is a 409 rather than a silently shorter test. A loaded ticker with nothing in the window is a 422.
    """
    sql = "SELECT date::text, ticker, close, dividends FROM prices WHERE ticker = ANY(:tickers) AND close IS NOT NULL"
    params = {"tickers": list(tickers)}
    if start:
        sql += " AND date >= :since"
        params["since"] = start - timedelta(days=PRICE_MARGIN_DAYS)

    rows = conn.execute(text(sql + " ORDER BY date"), params).all()
    frame = pd.DataFrame(rows, columns=["date", "ticker", "close", "dividends"])

    missing = sorted(set(tickers) - set(frame["ticker"]))
    if missing:
        raise_missing_prices(conn, missing)

    closes = frame.pivot(index="date", columns="ticker", values="close").sort_index()
    dividends = frame.pivot(index="date", columns="ticker", values="dividends").sort_index()
    return closes, dividends


def fetch_size_history(conn, tickers, column):
    """ticker -> [(as_of, value)] oldest first, for "market_cap" or "shares_outstanding"; rows without it are skipped."""
    rows = conn.execute(
        text(f"""
            SELECT ticker, as_of::text, {column} FROM company_fundamentals
            WHERE ticker = ANY(:tickers) AND {column} IS NOT NULL ORDER BY ticker, as_of
        """),
        {"tickers": list(tickers)},
    ).all()
    history = {ticker: [] for ticker in tickers}
    for ticker, as_of, value in rows:
        history[ticker].append((as_of, value))
    return history


def build_simulation(conn, portfolio, raw_closes, raw_dividends, start, end, shared=None, size_histories=None):
    """Cut the price tables down to one portfolio and attach its weight rule and rules.

    `shared` ({initial, inflow, inflow_frequency}) replaces the portfolio's own starting capital and new
    money and drops its starting position, so several portfolios can be run with the same money.
    `size_histories` ({column: fetch_size_history result}) saves fetching the sizes again for each portfolio.
    """
    strategy_holdings = selected_holdings(portfolio)
    holdings = strategy_holdings if shared else backtest_holdings(portfolio)
    tickers = [holding["ticker"] for holding in holdings]
    strategy_tickers = {holding["ticker"] for holding in strategy_holdings}
    weights = {
        holding["ticker"]: holding["target_weight"] if holding["ticker"] in strategy_tickers else 0.0
        for holding in holdings
    }
    if any(weight is None for weight in weights.values()):
        raise HTTPException(status_code=409, detail=SIZES_LOADING_ERROR)
    companies = {holding["ticker"]: holding["company"] for holding in holdings}
    stored_starts = dict(
        conn.execute(
            text("SELECT ticker, price_start FROM company_load_state WHERE ticker = ANY(:tickers)"),
            {"tickers": tickers},
        ).all()
    )

    # Days where only some stocks traded carry the last close forward, and the test starts on the first
    # day every stock has a price.
    wanted = raw_closes[tickers]
    observed_starts = wanted.apply(pd.Series.first_valid_index)
    first_days = pd.Series({
        ticker: stored_starts[ticker].isoformat() if stored_starts.get(ticker) else observed_starts[ticker]
        for ticker in tickers
    })
    closes = wanted.ffill().dropna()
    portfolio_start = None if shared else portfolio["start_date"]
    # A custom backtest start is a hypothetical new opening date. Without one, use the
    # saved opening date; if both are blank, the common price history decides the start.
    effective_start = start.isoformat() if start else portfolio_start
    if effective_start:
        closes = closes[closes.index >= effective_start]
    if end:
        closes = closes[closes.index <= end.isoformat()]
    if closes.empty:
        raise HTTPException(status_code=422, detail="No trading days where all stocks have prices in this range.")

    dividends = raw_dividends[tickers].reindex(closes.index).fillna(0.0)

    limited_by = None
    limiting = limiting_stock(first_days, effective_start)
    if limiting:
        ticker, listed = limiting
        limited_by = {"ticker": ticker, "company": companies[ticker], "date": listed}

    if portfolio["weighting"] in (MARKET_CAP, OWNERSHIP):
        # Sizes are looked up for the day each rule is applied, not only as they are today.
        column = SIZE_COLUMNS[portfolio["weighting"]]
        history = size_histories[column] if size_histories else fetch_size_history(conn, strategy_tickers, column)
        if any(not history.get(ticker) for ticker in strategy_tickers):
            raise HTTPException(status_code=409, detail=SIZES_LOADING_ERROR)
        size_rule = market_cap_rule if portfolio["weighting"] == MARKET_CAP else ownership_rule
        strategy_rule = size_rule(strategy_holdings, history)
        position_only = set(tickers) - strategy_tickers
        rule = lambda prices, day: {**strategy_rule(prices, day), **dict.fromkeys(position_only, 0.0)}
    else:
        rule = fixed_rule(weights)

    rules = {
        "initial": shared["initial"] if shared else portfolio["initial_capital"],
        "inflow": shared["inflow"] if shared else portfolio["inflow_amount"],
        "inflow_frequency": shared["inflow_frequency"] if shared else portfolio["inflow_frequency"],
        "invest_frequency": portfolio["invest_frequency"],
    }
    if not shared and any(holding["start_shares"] is not None for holding in holdings):
        rules["start_shares"] = {holding["ticker"]: holding["start_shares"] or 0 for holding in holdings}

    return Simulation(portfolio, closes, dividends, rule, rules, limited_by)


def load_simulation(conn, portfolio_id, start, end):
    portfolio = load_portfolio(conn, portfolio_id)
    # A custom range overrides the saved opening date, including when it starts earlier.
    since = start or (date.fromisoformat(portfolio["start_date"]) if portfolio["start_date"] else None)
    raw_closes, raw_dividends = fetch_prices(
        conn,
        [holding["ticker"] for holding in backtest_holdings(portfolio)],
        since,
    )
    return build_simulation(conn, portfolio, raw_closes, raw_dividends, start, end)


def name_buys(portfolio, investments):
    companies = {holding["ticker"]: holding["company"] for holding in backtest_holdings(portfolio)}
    for item in investments:
        for buy in item["buys"]:
            buy["company"] = companies[buy["ticker"]]
    return investments


@router.get("/{portfolio_id}/backtest")
def run_backtest(
    portfolio_id: int,
    start: date | None = None,
    end: date | None = None,
    conn=Depends(get_conn),
):
    simulation = load_simulation(conn, portfolio_id, start, end)
    portfolio, rules = simulation.portfolio, simulation.rules

    holdings = backtest_holdings(portfolio)
    has_starting_shares = any((holding["start_shares"] or 0) > 0 for holding in holdings)
    if not has_starting_shares and rules["initial"] + rules["inflow"] <= 0:
        raise HTTPException(status_code=422, detail="Invest a starting amount, new money, or both.")

    result = backtest(simulation.closes, simulation.dividends, simulation.rule, **rules)
    companies = {holding["ticker"]: holding["company"] for holding in holdings}
    for holding in result["holdings"]:
        holding["company"] = companies[holding["ticker"]]
    name_buys(portfolio, result["investments"])

    return {
        "portfolio": {"id": portfolio["id"], "name": portfolio["name"], "weighting": portfolio["weighting"]},
        "settings": {
            "initial_capital": rules["initial"],
            "start_date": portfolio["start_date"],
            "has_starting_position": has_starting_shares,
            "invest_frequency": portfolio["invest_frequency"],
            "inflow_amount": portfolio["inflow_amount"],
            "inflow_frequency": portfolio["inflow_frequency"],
        },
        "limited_by": simulation.limited_by,
        **result,
    }


@router.get("/{portfolio_id}/plan")
def run_plan(
    portfolio_id: int,
    until: date | None = Query(default=None, description="Look ahead to this date"),
    start: date | None = None,
    conn=Depends(get_conn),
):
    """What to buy at the next investing days, assuming prices stay at the last close."""
    simulation = load_simulation(conn, portfolio_id, start, None)

    last_date = date.fromisoformat(simulation.closes.index[-1])
    until = until or last_date + timedelta(days=DEFAULT_PLAN_DAYS)
    if until > last_date + timedelta(days=MAX_PLAN_DAYS):
        raise HTTPException(status_code=422, detail="The plan can look at most five years ahead.")

    result = plan(simulation.closes, simulation.dividends, simulation.rule, until.isoformat(), **simulation.rules)
    name_buys(simulation.portfolio, result["investments"])
    return {
        "until": until.isoformat(),
        "invest_frequency": simulation.portfolio["invest_frequency"],
        "limited_by": simulation.limited_by,
        **result,
    }
