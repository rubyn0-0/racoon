import json
import math
from pathlib import Path

import yfinance as yf


COMPANIES = [
    {"name": "ABB Ltd", "ticker": "ABBN.SW"},
    {"name": "Nestlé SA", "ticker": "NESN.SW"},
    {"name": "Novartis AG", "ticker": "NOVN.SW"},
]

OUTPUT_FILE = Path("data/six_three_companies.json")


def number_or_none(value):
    value = float(value)
    return value if math.isfinite(value) else None


stocks = []

for company in COMPANIES:
    data = yf.Ticker(company["ticker"]).history(
        period="5y",
        interval="1d",
        auto_adjust=False,
        actions=True,
    )

    if data.empty:
        print(f"No data found for {company['ticker']}")
        continue

    prices = []

    for date, row in data.iterrows():
        prices.append(
            {
                "date": date.strftime("%Y-%m-%d"),
                "open": number_or_none(row["Open"]),
                "high": number_or_none(row["High"]),
                "low": number_or_none(row["Low"]),
                "close": number_or_none(row["Close"]),
                "adjusted_close": number_or_none(row["Adj Close"]),
                "volume": int(row["Volume"]) if not math.isnan(row["Volume"]) else None,
                "dividends": number_or_none(row["Dividends"]),
                "stock_splits": number_or_none(row["Stock Splits"]),
            }
        )

    stocks.append(
        {
            "company": company["name"],
            "ticker": company["ticker"],
            "start_date": prices[0]["date"],
            "end_date": prices[-1]["date"],
            "interval": "1d",
            "count": len(prices),
            "prices": prices,
        }
    )

OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

with OUTPUT_FILE.open("w", encoding="utf-8") as file:
    json.dump({"stocks": stocks}, file, indent=2, allow_nan=False)

print(f"Saved data for {len(stocks)} companies to {OUTPUT_FILE}")