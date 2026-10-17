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
    MANUAL,
    MARKET_CAP,
    MONTHLY,
    OWNERSHIP,
    WEIGHTINGS,
    backtest,
    common_window,
    fixed_rule,
    ownership_rule,
    plan,
    target_weights,
)
from racoon.db import get_conn

router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])

MAX_HOLDINGS = 30
NAME_MAX_LENGTH = 80  # the frontend mirrors this as PORTFOLIO_NAME_MAX_LENGTH
DUPLICATE_NAME_ERROR = "A portfolio with this name already exists."
CURRENCY = "CHF"
MIN_COMPARE, MAX_COMPARE = 2, 6  # the frontend mirrors these
MAX_PLAN_DAYS = 1830  # the plan looks at most five years ahead
DEFAULT_PLAN_DAYS = 366


class HoldingIn(BaseModel):
    ticker: str
    weight: float | None = Field(default=None, gt=0, description="Only used with manual weighting")
    start_shares: float | None = Field(default=None, ge=0, description="Shares held on the portfolio's start date")


class WeightsIn(BaseModel):
    weighting: Literal[WEIGHTINGS]
    holdings: list[HoldingIn] = Field(min_length=1, max_length=MAX_HOLDINGS)


class PortfolioIn(WeightsIn):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    invest_frequency: Literal[INVEST_FREQUENCIES] = MONTHLY
    inflow_amount: float = Field(default=0, ge=0, description=f"{CURRENCY} of new money per inflow period")
    inflow_frequency: Literal[INFLOW_FREQUENCIES] = MONTHLY
    start_date: date | None = Field(default=None, description="Start of the starting position, if there is one")
    start_cash: float = Field(default=0, ge=0, description=f"{CURRENCY} not invested on the start date")


def resolve_holdings(conn, weighting, holdings):
    """Check the holdings against the companies table and attach each target weight."""
    tickers = [holding["ticker"] for holding in holdings]
    if len(set(tickers)) != len(tickers):
        raise HTTPException(status_code=422, detail="Each stock can only be added once.")
    if weighting == MANUAL and any(holding["weight"] is None for holding in holdings):
        raise HTTPException(status_code=422, detail="Give every stock a weight, or pick another weighting.")

    rows = conn.execute(
        text("SELECT ticker, name, market_cap, shares_outstanding FROM companies WHERE ticker = ANY(:tickers)"),
        {"tickers": tickers},
    ).mappings().all()
    companies = {row["ticker"]: row for row in rows}

    unknown = [ticker for ticker in tickers if ticker not in companies]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown stock: {', '.join(unknown)}")

    sizes = None
    if weighting == MARKET_CAP:
        sizes = {ticker: companies[ticker]["market_cap"] for ticker in tickers}
        missing = [companies[ticker]["name"] for ticker in tickers if not sizes[ticker]]
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"No market cap stored for {', '.join(missing)}. Run the ingest again to load it.",
            )
    elif weighting == OWNERSHIP:
        sizes = ownership_sizes(conn, tickers, companies)

    weights = target_weights(holdings, weighting, sizes)
    return [
        {
            "ticker": holding["ticker"],
            "company": companies[holding["ticker"]]["name"],
            "weight": holding["weight"] if weighting == MANUAL else None,
            "start_shares": holding.get("start_shares"),
            "target_weight": weights[holding["ticker"]],
        }
        for holding in holdings
    ]


def ownership_sizes(conn, tickers, companies):
    """Value of all shares of each company today (shares outstanding x latest close)."""
    missing = [companies[ticker]["name"] for ticker in tickers if not companies[ticker]["shares_outstanding"]]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"No share count stored for {', '.join(missing)}. Run the ingest again to load it.",
        )

    latest = conn.execute(
        text("""
            SELECT DISTINCT ON (ticker) ticker, close
            FROM prices
            WHERE ticker = ANY(:tickers) AND close IS NOT NULL
            ORDER BY ticker, date DESC
        """),
        {"tickers": tickers},
    ).mappings().all()
    closes = {row["ticker"]: row["close"] for row in latest}
    return {ticker: companies[ticker]["shares_outstanding"] * closes[ticker] for ticker in tickers}


def load_portfolio(conn, portfolio_id):
    portfolio = conn.execute(
        text("""
            SELECT id, name, weighting, invest_frequency, inflow_amount, inflow_frequency,
                   to_char(start_date, 'YYYY-MM-DD') AS start_date, start_cash
            FROM portfolios WHERE id = :id
        """),
        {"id": portfolio_id},
    ).mappings().first()
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    holdings = conn.execute(
        text("SELECT ticker, weight, start_shares FROM holdings WHERE portfolio_id = :id ORDER BY ticker"),
        {"id": portfolio_id},
    ).mappings().all()

    return {
        **portfolio,
        "holdings": resolve_holdings(conn, portfolio["weighting"], [dict(row) for row in holdings]),
    }


def rule_params(body):
    """The portfolio columns a request sets; a starting position only counts with a start date."""
    return {
        "name": body.name.strip(),
        "weighting": body.weighting,
        "invest_frequency": body.invest_frequency,
        "inflow_amount": body.inflow_amount,
        "inflow_frequency": body.inflow_frequency,
        "start_date": body.start_date,
        "start_cash": body.start_cash if body.start_date else 0,
    }


def save_holdings(conn, portfolio_id, body):
    conn.execute(text("DELETE FROM holdings WHERE portfolio_id = :id"), {"id": portfolio_id})
    conn.execute(
        text("""
            INSERT INTO holdings (portfolio_id, ticker, weight, start_shares)
            VALUES (:id, :ticker, :weight, :start_shares)
        """),
        [
            {
                "id": portfolio_id,
                "ticker": holding.ticker,
                "weight": holding.weight if body.weighting == MANUAL else None,
                "start_shares": (holding.start_shares or 0) if body.start_date else None,
            }
            for holding in body.holdings
        ],
    )


def commit_or_conflict(conn):
    try:
        conn.commit()
    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail=DUPLICATE_NAME_ERROR)


@router.get("")
def list_portfolios(conn=Depends(get_conn)):
    ids = conn.execute(text("SELECT id FROM portfolios ORDER BY name")).scalars().all()
    return [load_portfolio(conn, portfolio_id) for portfolio_id in ids]


@router.post("/weights")
def preview_weights(body: WeightsIn, conn=Depends(get_conn)):
    """Target weights for an unsaved draft, so the editor can show them while you type."""
    return resolve_holdings(conn, body.weighting, [holding.model_dump() for holding in body.holdings])


@router.post("", status_code=201)
def create_portfolio(body: PortfolioIn, conn=Depends(get_conn)):
    resolve_holdings(conn, body.weighting, [holding.model_dump() for holding in body.holdings])
    try:
        portfolio_id = conn.execute(
            text("""
                INSERT INTO portfolios (
                    name, weighting, invest_frequency, inflow_amount, inflow_frequency, start_date, start_cash
                )
                VALUES (
                    :name, :weighting, :invest_frequency, :inflow_amount, :inflow_frequency, :start_date, :start_cash
                )
                RETURNING id
            """),
            rule_params(body),
        ).scalar_one()
    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail=DUPLICATE_NAME_ERROR)

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

    shared = {"inflow": inflow, "inflow_frequency": inflow_frequency}
    simulations = [load_simulation(conn, pid, start, end, initial, shared) for pid in portfolio_ids]
    first, last = common_window([closes for _, closes, _, _, _ in simulations])
    if first > last:
        raise HTTPException(status_code=422, detail="These portfolios have no trading days in common.")

    # Portfolios of different stocks can have different holidays, so line them all up on every day any of them traded.
    dates = sorted(set().union(*[set(closes.loc[first:last].index) for _, closes, _, _, _ in simulations]))

    compared = []
    for portfolio, closes, dividends, rule, rules in simulations:
        result = backtest(
            closes.reindex(dates, method="ffill"), dividends.reindex(dates).fillna(0.0), rule, **rules
        )
        compared.append({
            "id": portfolio["id"],
            "name": portfolio["name"],
            "weighting": portfolio["weighting"],
            "invest_frequency": portfolio["invest_frequency"],
            "summary": result["summary"],
            "values": [row["value"] for row in result["series"]],
            "invested": [row["invested"] for row in result["series"]],
        })

    # Same days and same money, so the paid-in line is the same for everyone.
    return {
        "start_date": first,
        "end_date": last,
        "settings": {"initial": initial, "inflow_amount": inflow, "inflow_frequency": inflow_frequency},
        "dates": dates,
        "invested": compared[0]["invested"],
        "portfolios": [{key: value for key, value in item.items() if key != "invested"} for item in compared],
    }


@router.get("/{portfolio_id}")
def get_portfolio(portfolio_id: int, conn=Depends(get_conn)):
    return load_portfolio(conn, portfolio_id)


@router.put("/{portfolio_id}")
def update_portfolio(portfolio_id: int, body: PortfolioIn, conn=Depends(get_conn)):
    load_portfolio(conn, portfolio_id)
    resolve_holdings(conn, body.weighting, [holding.model_dump() for holding in body.holdings])
    try:
        conn.execute(
            text("""
                UPDATE portfolios SET
                    name = :name, weighting = :weighting, invest_frequency = :invest_frequency,
                    inflow_amount = :inflow_amount, inflow_frequency = :inflow_frequency,
                    start_date = :start_date, start_cash = :start_cash
                WHERE id = :id
            """),
            {"id": portfolio_id, **rule_params(body)},
        )
    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail=DUPLICATE_NAME_ERROR)

    save_holdings(conn, portfolio_id, body)
    commit_or_conflict(conn)
    return load_portfolio(conn, portfolio_id)


@router.delete("/{portfolio_id}", status_code=204)
def delete_portfolio(portfolio_id: int, conn=Depends(get_conn)):
    load_portfolio(conn, portfolio_id)
    conn.execute(text("DELETE FROM portfolios WHERE id = :id"), {"id": portfolio_id})
    conn.commit()
    return Response(status_code=204)


def load_simulation(conn, portfolio_id, start, end, initial, shared=None):
    """Everything backtest() and plan() need for a saved portfolio: prices, dividends, weight rule, rules.

    `shared` ({inflow, inflow_frequency}) replaces the portfolio's own new money and drops its starting
    position, so several portfolios can be run with the same money.
    """
    portfolio = load_portfolio(conn, portfolio_id)
    weights = {holding["ticker"]: holding["target_weight"] for holding in portfolio["holdings"]}

    rows = conn.execute(
        text("""
            SELECT ticker, to_char(date, 'YYYY-MM-DD') AS date, close, dividends
            FROM prices
            WHERE ticker = ANY(:tickers) AND close IS NOT NULL
            ORDER BY date
        """),
        {"tickers": list(weights)},
    ).mappings().all()
    df = pd.DataFrame(rows)

    # One column per stock; days where only some stocks traded carry the last close forward,
    # and the test starts on the first day every stock has a price.
    closes = df.pivot(index="date", columns="ticker", values="close").sort_index().ffill().dropna()
    closes = closes[list(weights)]
    start_date = None if shared else portfolio["start_date"]
    if start_date:
        closes = closes[closes.index >= start_date]
    elif start:
        closes = closes[closes.index >= start.isoformat()]
    if end:
        closes = closes[closes.index <= end.isoformat()]
    if closes.empty:
        raise HTTPException(status_code=422, detail="No trading days where all stocks have prices in this range.")

    dividends = (
        df.pivot(index="date", columns="ticker", values="dividends")
        .reindex(index=closes.index, columns=closes.columns)
        .fillna(0.0)
    )

    if portfolio["weighting"] == OWNERSHIP:
        shares_outstanding = dict(
            conn.execute(
                text("SELECT ticker, shares_outstanding FROM companies WHERE ticker = ANY(:tickers)"),
                {"tickers": list(weights)},
            ).all()
        )
        rule = ownership_rule(portfolio["holdings"], shares_outstanding)
    else:
        rule = fixed_rule(weights)

    rules = {
        "inflow": shared["inflow"] if shared else portfolio["inflow_amount"],
        "inflow_frequency": shared["inflow_frequency"] if shared else portfolio["inflow_frequency"],
        "invest_frequency": portfolio["invest_frequency"],
    }
    if start_date:
        rules["start_shares"] = {holding["ticker"]: holding["start_shares"] or 0 for holding in portfolio["holdings"]}
        rules["start_cash"] = portfolio["start_cash"]
    else:
        rules["initial"] = initial

    return portfolio, closes, dividends, rule, rules


def name_buys(portfolio, investments):
    companies = {holding["ticker"]: holding["company"] for holding in portfolio["holdings"]}
    for item in investments:
        for buy in item["buys"]:
            buy["company"] = companies[buy["ticker"]]
    return investments


@router.get("/{portfolio_id}/backtest")
def run_backtest(
    portfolio_id: int,
    start: date | None = None,
    end: date | None = None,
    initial: float = Query(10000, ge=0, description=f"{CURRENCY} invested on the first day (no starting position)"),
    conn=Depends(get_conn),
):
    portfolio, closes, dividends, rule, rules = load_simulation(conn, portfolio_id, start, end, initial)

    if not portfolio["start_date"] and initial + rules["inflow"] <= 0:
        raise HTTPException(status_code=422, detail="Invest a starting amount, new money, or both.")

    result = backtest(closes, dividends, rule, **rules)
    companies = {holding["ticker"]: holding["company"] for holding in portfolio["holdings"]}
    for holding in result["holdings"]:
        holding["company"] = companies[holding["ticker"]]
    name_buys(portfolio, result["investments"])

    return {
        "portfolio": {"id": portfolio["id"], "name": portfolio["name"], "weighting": portfolio["weighting"]},
        "settings": {
            "initial": None if portfolio["start_date"] else initial,
            "start_date": portfolio["start_date"],
            "invest_frequency": portfolio["invest_frequency"],
            "inflow_amount": portfolio["inflow_amount"],
            "inflow_frequency": portfolio["inflow_frequency"],
        },
        **result,
    }


@router.get("/{portfolio_id}/plan")
def run_plan(
    portfolio_id: int,
    until: date | None = Query(default=None, description="Look ahead to this date"),
    start: date | None = None,
    initial: float = Query(10000, ge=0, description=f"{CURRENCY} invested on the first day (no starting position)"),
    conn=Depends(get_conn),
):
    """What to buy at the next investing days, assuming prices stay at the last close."""
    portfolio, closes, dividends, rule, rules = load_simulation(conn, portfolio_id, start, None, initial)

    last_date = date.fromisoformat(closes.index[-1])
    until = until or last_date + timedelta(days=DEFAULT_PLAN_DAYS)
    if until > last_date + timedelta(days=MAX_PLAN_DAYS):
        raise HTTPException(status_code=422, detail="The plan can look at most five years ahead.")

    result = plan(closes, dividends, rule, until.isoformat(), **rules)
    name_buys(portfolio, result["investments"])
    return {"until": until.isoformat(), "invest_frequency": portfolio["invest_frequency"], **result}
