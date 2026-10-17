import csv
import math
import sys

import yfinance as yf
from sqlalchemy import text

from racoon.db import BACKEND_DIR, get_engine, init_db

TICKERS_FILE = BACKEND_DIR / "data" / "six_stocks_tickers.csv"
DEFAULT_TICKERS = ["ABBN.SW", "NESN.SW", "NOVN.SW"]

UPSERT_COMPANY = text("""
    INSERT INTO companies (ticker, name, exchange, country, market_cap)
    VALUES (:ticker, :name, :exchange, :country, :market_cap)
    ON CONFLICT (ticker) DO UPDATE SET
        name = EXCLUDED.name,
        exchange = EXCLUDED.exchange,
        country = EXCLUDED.country,
        market_cap = COALESCE(EXCLUDED.market_cap, companies.market_cap)
""")

UPSERT_PRICE = text("""
    INSERT INTO prices (
        ticker, date, open, high, low, close,
        adjusted_close, volume, dividends, stock_splits
    )
    VALUES (
        :ticker, :date, :open, :high, :low, :close,
        :adjusted_close, :volume, :dividends, :stock_splits
    )
    ON CONFLICT (ticker, date) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        adjusted_close = EXCLUDED.adjusted_close,
        volume = EXCLUDED.volume,
        dividends = EXCLUDED.dividends,
        stock_splits = EXCLUDED.stock_splits
""")


def number_or_none(value):
    value = float(value)
    return value if math.isfinite(value) else None


def load_companies():
    with TICKERS_FILE.open(encoding="utf-8", newline="") as file:
        return {
            row["yahoo_ticker"]: {
                "ticker": row["yahoo_ticker"],
                "name": row["name"],
                "exchange": row["exchange"],
                "country": row["country"],
            }
            for row in csv.DictReader(file)
        }


def fetch_prices(ticker):
    data = yf.Ticker(ticker).history(
        period="5y",
        interval="1d",
        auto_adjust=False,
        actions=True,
    )
    # A run during trading hours returns today's unfinished session without a close; skip it.
    data = data.dropna(subset=["Close"])

    return [
        {
            "ticker": ticker,
            "date": date.strftime("%Y-%m-%d"),
            "open": number_or_none(row["Open"]),
            "high": number_or_none(row["High"]),
            "low": number_or_none(row["Low"]),
            "close": number_or_none(row["Close"]),
            "adjusted_close": number_or_none(row["Adj Close"]),
            "volume": int(row["Volume"]) if math.isfinite(row["Volume"]) else None,
            "dividends": number_or_none(row["Dividends"]),
            "stock_splits": number_or_none(row["Stock Splits"]),
        }
        for date, row in data.iterrows()
    ]


def fetch_market_cap(ticker):
    """Current market capitalisation (used for SMI-style weights); None if Yahoo has none."""
    try:
        return number_or_none(yf.Ticker(ticker).fast_info["marketCap"])
    except Exception:
        return None


def ingest(tickers):
    companies = load_companies()
    init_db()

    for ticker in tickers:
        if ticker not in companies:
            print(f"{ticker} is not in {TICKERS_FILE.name}, skipped")
            continue

        prices = fetch_prices(ticker)
        if not prices:
            print(f"No data found for {ticker}")
            continue

        company = {**companies[ticker], "market_cap": fetch_market_cap(ticker)}

        with get_engine().begin() as connection:
            connection.execute(UPSERT_COMPANY, company)
            connection.execute(UPSERT_PRICE, prices)

        cap = f"market cap {company['market_cap']:,.0f}" if company["market_cap"] else "no market cap"
        print(f"{ticker}: stored {len(prices)} rows, {cap}")


if __name__ == "__main__":
    ingest(sys.argv[1:] or DEFAULT_TICKERS)
