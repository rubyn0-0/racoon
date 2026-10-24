"""Split the overloaded companies table (expand step): new tables next to the old columns.

Load bookkeeping, market membership (with history) and company sizes (with history) get their own
tables, and companies gets the exchange timezone. The old columns stay until 0004 so the data can
be checked after the copy.

Notes:
- 0003 and 0004 run in the same start-up, so there is no window in which the old columns can be checked.
- The backfilled values are placeholders, not real history: the SMI membership starts on the stock's
  first price day (2000-01-01 when it has no prices) and the fundamentals row is dated with the day the
  stock was last refreshed (the migration day when it never was).
- downgrade() drops index_membership, so closed memberships, other markets and extra size rows
  (company_fundamentals) are lost; only what the old columns can hold survives, see 0004's downgrade.

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE companies ADD COLUMN exchange_timezone TEXT")

    op.execute("""
        CREATE TABLE company_load_state (
            ticker VARCHAR(20) PRIMARY KEY REFERENCES companies (ticker),
            price_start DATE,
            price_end DATE,
            price_count INTEGER NOT NULL DEFAULT 0,
            refreshed_at TIMESTAMPTZ,
            full_history BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    op.execute("""
        INSERT INTO company_load_state (ticker, price_start, price_end, price_count, refreshed_at, full_history)
        SELECT ticker, price_start, price_end, price_count, refreshed_at, full_history FROM companies
    """)

    # A company is currently in a market while valid_to IS NULL.
    op.execute("""
        CREATE TABLE index_membership (
            market TEXT NOT NULL,
            ticker VARCHAR(20) NOT NULL REFERENCES companies (ticker),
            valid_from DATE NOT NULL,
            valid_to DATE,
            PRIMARY KEY (market, ticker, valid_from)
        )
    """)
    op.execute("""
        INSERT INTO index_membership (market, ticker, valid_from, valid_to)
        SELECT 'SMI', ticker, COALESCE(price_start, DATE '2000-01-01'), NULL FROM companies WHERE in_smi
    """)

    op.execute("""
        CREATE TABLE company_fundamentals (
            ticker VARCHAR(20) NOT NULL REFERENCES companies (ticker),
            as_of DATE NOT NULL,
            market_cap DOUBLE PRECISION,
            shares_outstanding DOUBLE PRECISION,
            PRIMARY KEY (ticker, as_of)
        )
    """)
    op.execute("""
        INSERT INTO company_fundamentals (ticker, as_of, market_cap, shares_outstanding)
        SELECT ticker, COALESCE(refreshed_at::date, CURRENT_DATE), market_cap, shares_outstanding
        FROM companies WHERE market_cap IS NOT NULL OR shares_outstanding IS NOT NULL
    """)


def downgrade():
    # The old columns are still filled at this revision, so dropping the new tables loses nothing
    # except changes made to them after the upgrade.
    op.execute("DROP TABLE company_fundamentals")
    op.execute("DROP TABLE index_membership")
    op.execute("DROP TABLE company_load_state")
    op.execute("ALTER TABLE companies DROP COLUMN exchange_timezone")
