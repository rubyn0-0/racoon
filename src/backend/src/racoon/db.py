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
