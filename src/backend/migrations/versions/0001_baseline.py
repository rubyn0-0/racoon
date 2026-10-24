"""Baseline: the schema the app used before migrations existed.

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# Frozen on purpose: a later change to the weighting list gets its own migration, so this file never changes.
WEIGHTINGS = ("manual", "equal", "market_cap", "ownership")


def upgrade():
    weighting_values = ", ".join(f"'{name}'" for name in WEIGHTINGS)
    op.execute("""
        CREATE TABLE companies (
            ticker VARCHAR(20) PRIMARY KEY,
            name TEXT NOT NULL,
            exchange TEXT,
            country TEXT,
            market_cap DOUBLE PRECISION,
            shares_outstanding DOUBLE PRECISION,
            in_smi BOOLEAN NOT NULL DEFAULT FALSE,
            price_start DATE,
            price_end DATE,
            price_count INTEGER NOT NULL DEFAULT 0,
            refreshed_at TIMESTAMPTZ,
            full_history BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    op.execute("""
        CREATE TABLE prices (
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
    """)
    op.execute(f"""
        CREATE TABLE portfolios (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            weighting TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            invest_frequency TEXT NOT NULL DEFAULT 'monthly',
            inflow_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
            inflow_frequency TEXT NOT NULL DEFAULT 'monthly',
            start_date DATE,
            start_cash DOUBLE PRECISION NOT NULL DEFAULT 0,
            initial_capital DOUBLE PRECISION NOT NULL DEFAULT 10000,
            CONSTRAINT portfolios_weighting_check CHECK (weighting IN ({weighting_values}))
        )
    """)
    op.execute("""
        CREATE TABLE holdings (
            portfolio_id INTEGER NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
            ticker VARCHAR(20) NOT NULL REFERENCES companies (ticker),
            weight DOUBLE PRECISION CHECK (weight > 0),
            start_shares DOUBLE PRECISION,
            selected BOOLEAN NOT NULL DEFAULT TRUE,
            PRIMARY KEY (portfolio_id, ticker)
        )
    """)


def downgrade():
    op.execute("DROP TABLE holdings")
    op.execute("DROP TABLE portfolios")
    op.execute("DROP TABLE prices")
    op.execute("DROP TABLE companies")
