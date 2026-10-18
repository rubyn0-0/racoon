"""Split the overloaded companies table (contract step): drop the columns that moved.

Notes:
- 0003 and 0004 run in the same start-up, so there is no safety window between copying and dropping.
- downgrade() restores only the newest company_fundamentals row per ticker (market cap, shares) and the
  in_smi flag from an open SMI membership; older size rows and other markets are not kept.
- The values copied by 0003 (membership valid_from, fundamentals as_of) are placeholders, not real
  historical dates, so what comes back here is only as accurate as those.

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

MOVED_COLUMNS = (
    "in_smi", "price_start", "price_end", "price_count", "refreshed_at", "full_history",
    "market_cap", "shares_outstanding",
)


def upgrade():
    for column in MOVED_COLUMNS:
        op.execute(f"ALTER TABLE companies DROP COLUMN {column}")


def downgrade():
    op.execute("""
        ALTER TABLE companies
            ADD COLUMN market_cap DOUBLE PRECISION,
            ADD COLUMN shares_outstanding DOUBLE PRECISION,
            ADD COLUMN in_smi BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN price_start DATE,
            ADD COLUMN price_end DATE,
            ADD COLUMN price_count INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN refreshed_at TIMESTAMPTZ,
            ADD COLUMN full_history BOOLEAN NOT NULL DEFAULT FALSE
    """)
    op.execute("""
        UPDATE companies c SET
            price_start = s.price_start, price_end = s.price_end, price_count = s.price_count,
            refreshed_at = s.refreshed_at, full_history = s.full_history
        FROM company_load_state s WHERE s.ticker = c.ticker
    """)
    op.execute("""
        UPDATE companies c SET in_smi = TRUE
        WHERE EXISTS (
            SELECT 1 FROM index_membership m WHERE m.ticker = c.ticker AND m.market = 'SMI' AND m.valid_to IS NULL
        )
    """)
    op.execute("""
        UPDATE companies c SET market_cap = f.market_cap, shares_outstanding = f.shares_outstanding
        FROM (
            SELECT DISTINCT ON (ticker) ticker, market_cap, shares_outstanding
            FROM company_fundamentals ORDER BY ticker, as_of DESC
        ) f WHERE f.ticker = c.ticker
    """)
