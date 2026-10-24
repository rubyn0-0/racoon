import logging
from functools import lru_cache

from alembic import command
from alembic.config import Config
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, text

from racoon.constants import BACKEND_DIR, ENV_FILE, MIGRATIONS_DIR

BASELINE_REVISION = "0001"  # the schema every database had before migrations existed
MIGRATION_LOCK = 7_426_001  # any fixed number; every process that migrates takes the same lock
# What the weighting check allowed when the baseline was written (frozen, like the baseline itself).
BASELINE_WEIGHTINGS = "'manual', 'equal', 'market_cap', 'ownership'"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: str


def normalize_database_url(url):
    """Hosts (Neon, Render) hand out postgresql://; SQLAlchemy would then look for psycopg2, which we don't use."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@lru_cache
def get_engine():
    """The one database handle, built from DATABASE_URL in .env."""
    return create_engine(
        normalize_database_url(Settings().database_url),
        pool_size=10, max_overflow=10, pool_pre_ping=True, pool_recycle=1800,
    )


def get_conn():
    """FastAPI dependency: one connection per request."""
    with get_engine().connect() as connection:
        yield connection


def alembic_config():
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    return config


def init_db():
    """Bring the database to the newest schema (migrations/versions). Cheap when it already is.

    The advisory lock makes two backend processes starting together take turns: the second one finds
    the database already up to date. A database made before migrations existed is brought to the
    baseline shape and stamped, never recreated.
    """
    config = alembic_config()
    with get_engine().connect() as connection:
        connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": MIGRATION_LOCK})
        connection.commit()
        try:
            config.attributes["connection"] = connection
            if _made_before_migrations(connection):
                _catch_up_to_baseline(connection)
                connection.commit()
                command.stamp(config, BASELINE_REVISION)
                connection.commit()
            command.upgrade(config, "head")
            connection.commit()
        finally:
            _release_migration_lock(connection)


def _release_migration_lock(connection):
    """Give the advisory lock back. If that fails, drop the connection: closing it frees a session lock.

    Never raises, so it cannot hide the error of the migration that ran before it.
    """
    try:
        connection.rollback()
        connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": MIGRATION_LOCK})
        connection.commit()
    except Exception:
        logging.getLogger("uvicorn.error").exception("could not release the migration lock; closing its connection")
        connection.invalidate()


def _made_before_migrations(connection):
    return connection.execute(text(
        "SELECT to_regclass('alembic_version') IS NULL AND to_regclass('companies') IS NOT NULL"
    )).scalar_one()


def _catch_up_to_baseline(connection):
    """The old start-up code, kept only to bring a database from any earlier version to the baseline.

    Safe to delete once every database in use has been stamped.
    """
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
    connection.execute(text(f"""
        CREATE TABLE IF NOT EXISTS portfolios (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            weighting TEXT NOT NULL CHECK (weighting IN ({BASELINE_WEIGHTINGS})),
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
    columns = {
        "companies": (
            "market_cap DOUBLE PRECISION",
            "shares_outstanding DOUBLE PRECISION",
            "in_smi BOOLEAN NOT NULL DEFAULT FALSE",
            "price_start DATE",
            "price_end DATE",
            "price_count INTEGER NOT NULL DEFAULT 0",
            "refreshed_at TIMESTAMPTZ",
            "full_history BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        "portfolios": (
            "invest_frequency TEXT NOT NULL DEFAULT 'monthly'",
            "inflow_amount DOUBLE PRECISION NOT NULL DEFAULT 0",
            "inflow_frequency TEXT NOT NULL DEFAULT 'monthly'",
            "start_date DATE",
            "start_cash DOUBLE PRECISION NOT NULL DEFAULT 0",
            "initial_capital DOUBLE PRECISION NOT NULL DEFAULT 10000",
        ),
        "holdings": (
            "start_shares DOUBLE PRECISION",
            "selected BOOLEAN NOT NULL DEFAULT TRUE",
        ),
    }
    for table, definitions in columns.items():
        for definition in definitions:
            connection.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {definition}"))
    # The weighting list grew (ownership), so an older check has to be replaced.
    connection.execute(text("ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_weighting_check"))
    connection.execute(text(
        f"ALTER TABLE portfolios ADD CONSTRAINT portfolios_weighting_check CHECK (weighting IN ({BASELINE_WEIGHTINGS}))"
    ))
