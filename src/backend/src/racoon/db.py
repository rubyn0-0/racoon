from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, text

from racoon.backtest import WEIGHTINGS

BACKEND_DIR = Path(__file__).resolve().parents[2]
WEIGHTING_VALUES = ", ".join(f"'{name}'" for name in WEIGHTINGS)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str


@lru_cache
def get_engine():
    """The one database handle, built from DATABASE_URL in .env."""
    return create_engine(Settings().database_url)


def get_conn():
    """FastAPI dependency: one connection per request."""
    with get_engine().connect() as connection:
        yield connection


def init_db():
    with get_engine().begin() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS companies (
                ticker VARCHAR(20) PRIMARY KEY,
                name TEXT NOT NULL,
                exchange TEXT,
                country TEXT
            )
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS prices (
                ticker VARCHAR(20) NOT NULL REFERENCES companies (ticker),
                date DATE NOT NULL,
                open DOUBLE PRECISION,
                high DOUBLE PRECISION,
                low DOUBLE PRECISION,
                close DOUBLE PRECISION,
                adjusted_close DOUBLE PRECISION,
                volume BIGINT,
                dividends DOUBLE PRECISION,
                stock_splits DOUBLE PRECISION,
                PRIMARY KEY (ticker, date)
            )
        """))
        # Added after the first release; existing databases get the column on the next start.
        connection.execute(text(
            "ALTER TABLE companies ADD COLUMN IF NOT EXISTS market_cap DOUBLE PRECISION"
        ))
        connection.execute(text(f"""
            CREATE TABLE IF NOT EXISTS portfolios (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                weighting TEXT NOT NULL CHECK (weighting IN ({WEIGHTING_VALUES})),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS holdings (
                portfolio_id INTEGER NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
                ticker VARCHAR(20) NOT NULL REFERENCES companies (ticker),
                weight DOUBLE PRECISION CHECK (weight > 0),
                PRIMARY KEY (portfolio_id, ticker)
            )
        """))
        # Added with the portfolio rules; existing databases get the columns on the next start.
        connection.execute(text(
            "ALTER TABLE companies ADD COLUMN IF NOT EXISTS shares_outstanding DOUBLE PRECISION"
        ))
        for column in (
            "invest_frequency TEXT NOT NULL DEFAULT 'monthly'",
            "inflow_amount DOUBLE PRECISION NOT NULL DEFAULT 0",
            "inflow_frequency TEXT NOT NULL DEFAULT 'monthly'",
            "start_date DATE",
            "start_cash DOUBLE PRECISION NOT NULL DEFAULT 0",
        ):
            connection.execute(text(f"ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS {column}"))
        connection.execute(text(
            "ALTER TABLE holdings ADD COLUMN IF NOT EXISTS start_shares DOUBLE PRECISION"
        ))
        # The weighting list grew (ownership), so the original check has to be replaced.
        connection.execute(text("ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_weighting_check"))
        connection.execute(text(
            f"ALTER TABLE portfolios ADD CONSTRAINT portfolios_weighting_check CHECK (weighting IN ({WEIGHTING_VALUES}))"
        ))
        # Added with on-demand loading: what each company's stored history looks like, so listing
        # the stocks never has to scan the price table.
        for column in (
            "in_smi BOOLEAN NOT NULL DEFAULT FALSE",
            "price_start DATE",
            "price_end DATE",
            "price_count INTEGER NOT NULL DEFAULT 0",
            "refreshed_at TIMESTAMPTZ",
            "full_history BOOLEAN NOT NULL DEFAULT FALSE",
        ):
            connection.execute(text(f"ALTER TABLE companies ADD COLUMN IF NOT EXISTS {column}"))
        # Prices stored before these columns existed: summarise them once.
        connection.execute(text("""
            UPDATE companies c SET price_start = a.d_min, price_end = a.d_max, price_count = a.n
            FROM (
                SELECT ticker, min(date) AS d_min, max(date) AS d_max, count(*) AS n
                FROM prices GROUP BY ticker
            ) a
            WHERE a.ticker = c.ticker AND c.price_count = 0
        """))
        # The starting amount is now a saved setting of the portfolio. A portfolio that had a starting
        # position with cash keeps that cash as its starting capital; this runs once (start_cash is zeroed).
        connection.execute(text(
            "ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS initial_capital DOUBLE PRECISION NOT NULL DEFAULT 10000"
        ))
        connection.execute(text("""
            UPDATE portfolios SET initial_capital = start_cash, start_cash = 0
            WHERE start_date IS NOT NULL AND start_cash > 0
        """))
