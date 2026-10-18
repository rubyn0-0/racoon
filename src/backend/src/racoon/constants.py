"""Names and paths shared across the backend. Only stdlib imports, so any module can use them."""
import os
from pathlib import Path

# The one place that knows where the backend folder is. If this file moves, change parents[N] here only.
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"
MIGRATIONS_DIR = BACKEND_DIR / "migrations"
# Folder holding the stock list; set RACOON_DATA_DIR to point somewhere else.
DATA_DIR = Path(os.environ.get("RACOON_DATA_DIR", BACKEND_DIR / "data"))
TICKERS_FILE = DATA_DIR / "six_stocks_tickers.csv"

# Timezone of each exchange in the stock list, used until Yahoo reports one for a stock.
EXCHANGE_TIMEZONES = {"SIX": "Europe/Zurich"}

MANUAL, EQUAL, MARKET_CAP, OWNERSHIP = "manual", "equal", "market_cap", "ownership"
WEIGHTINGS = (MANUAL, EQUAL, MARKET_CAP, OWNERSHIP)

# Joins the newest company_fundamentals row (market cap, shares outstanding) as `f` onto a query over `companies c`.
LATEST_FUNDAMENTALS = """
    LEFT JOIN LATERAL (
        SELECT market_cap, shares_outstanding FROM company_fundamentals
        WHERE ticker = c.ticker ORDER BY as_of DESC LIMIT 1
    ) f ON TRUE
"""
