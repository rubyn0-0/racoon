from datetime import date
from typing import Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from racoon.backtest import backtest, target_weights
from racoon.db import get_conn

router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])


class HoldingIn(BaseModel):
    ticker: str
    weight: float | None = Field(default=None, gt=0, description="Only used with manual weighting")


class WeightsIn(BaseModel):
    weighting: Literal["manual", "equal", "market_cap"]
    holdings: list[HoldingIn] = Field(min_length=1, max_length=30)


class PortfolioIn(WeightsIn):
    name: str = Field(min_length=1, max_length=80)


def resolve_holdings(conn, weighting, holdings):
    """Check the holdings against the companies table and attach each target weight."""
    tickers = [holding["ticker"] for holding in holdings]
    if len(set(tickers)) != len(tickers):
        raise HTTPException(status_code=422, detail="Each stock can only be added once.")
    if weighting == "manual" and any(holding["weight"] is None for holding in holdings):
        raise HTTPException(status_code=422, detail="Give every stock a weight, or pick another weighting.")

    rows = conn.execute(
        text("SELECT ticker, name, market_cap FROM companies WHERE ticker = ANY(:tickers)"),
        {"tickers": tickers},
    ).mappings().all()
    companies = {row["ticker"]: row for row in rows}

    unknown = [ticker for ticker in tickers if ticker not in companies]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown stock: {', '.join(unknown)}")

    market_caps = {ticker: companies[ticker]["market_cap"] for ticker in tickers}
    if weighting == "market_cap":
        missing = [companies[ticker]["name"] for ticker in tickers if not market_caps[ticker]]
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"No market cap stored for {', '.join(missing)}. Run the ingest again to load it.",
            )

    weights = target_weights(holdings, weighting, market_caps)
    return [
        {
            "ticker": holding["ticker"],
            "company": companies[holding["ticker"]]["name"],
            "weight": holding["weight"] if weighting == "manual" else None,
            "target_weight": weights[holding["ticker"]],
        }
        for holding in holdings
    ]


def load_portfolio(conn, portfolio_id):
    portfolio = conn.execute(
        text("SELECT id, name, weighting FROM portfolios WHERE id = :id"),
        {"id": portfolio_id},
    ).mappings().first()
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    holdings = conn.execute(
        text("SELECT ticker, weight FROM holdings WHERE portfolio_id = :id ORDER BY ticker"),
        {"id": portfolio_id},
    ).mappings().all()

    return {
        **portfolio,
        "holdings": resolve_holdings(conn, portfolio["weighting"], [dict(row) for row in holdings]),
    }


def save_holdings(conn, portfolio_id, body):
    conn.execute(text("DELETE FROM holdings WHERE portfolio_id = :id"), {"id": portfolio_id})
    conn.execute(
        text("INSERT INTO holdings (portfolio_id, ticker, weight) VALUES (:id, :ticker, :weight)"),
        [
            {
                "id": portfolio_id,
                "ticker": holding.ticker,
                "weight": holding.weight if body.weighting == "manual" else None,
            }
            for holding in body.holdings
        ],
    )


def commit_or_conflict(conn):
    try:
        conn.commit()
    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail="A portfolio with this name already exists.")


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
            text("INSERT INTO portfolios (name, weighting) VALUES (:name, :weighting) RETURNING id"),
            {"name": body.name.strip(), "weighting": body.weighting},
        ).scalar_one()
    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail="A portfolio with this name already exists.")

    save_holdings(conn, portfolio_id, body)
    commit_or_conflict(conn)
    return load_portfolio(conn, portfolio_id)


@router.get("/{portfolio_id}")
def get_portfolio(portfolio_id: int, conn=Depends(get_conn)):
    return load_portfolio(conn, portfolio_id)


@router.put("/{portfolio_id}")
def update_portfolio(portfolio_id: int, body: PortfolioIn, conn=Depends(get_conn)):
    load_portfolio(conn, portfolio_id)
    resolve_holdings(conn, body.weighting, [holding.model_dump() for holding in body.holdings])
    try:
        conn.execute(
            text("UPDATE portfolios SET name = :name, weighting = :weighting WHERE id = :id"),
            {"id": portfolio_id, "name": body.name.strip(), "weighting": body.weighting},
        )
    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail="A portfolio with this name already exists.")

    save_holdings(conn, portfolio_id, body)
    commit_or_conflict(conn)
    return load_portfolio(conn, portfolio_id)


@router.delete("/{portfolio_id}", status_code=204)
def delete_portfolio(portfolio_id: int, conn=Depends(get_conn)):
    load_portfolio(conn, portfolio_id)
    conn.execute(text("DELETE FROM portfolios WHERE id = :id"), {"id": portfolio_id})
    conn.commit()
    return Response(status_code=204)


@router.get("/{portfolio_id}/backtest")
def run_backtest(
    portfolio_id: int,
    start: date | None = None,
    end: date | None = None,
    initial: float = Query(10000, ge=0, description="CHF invested on the first day"),
    monthly: float = Query(0, ge=0, description="CHF added on the first trading day of each month"),
    reinvest: bool = True,
    conn=Depends(get_conn),
):
    if initial + monthly <= 0:
        raise HTTPException(status_code=422, detail="Invest a starting amount, a monthly amount, or both.")

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
    if start:
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

    result = backtest(closes, dividends, weights, initial, monthly, reinvest)
    companies = {holding["ticker"]: holding["company"] for holding in portfolio["holdings"]}
    for holding in result["holdings"]:
        holding["company"] = companies[holding["ticker"]]

    return {
        "portfolio": {"id": portfolio["id"], "name": portfolio["name"], "weighting": portfolio["weighting"]},
        "settings": {"initial": initial, "monthly": monthly, "reinvest": reinvest},
        **result,
    }
