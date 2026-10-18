"""One-time data fixes the old start-up code repeated on every boot.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    # Prices stored before the summary columns existed: summarise them once.
    op.execute("""
        UPDATE companies c SET price_start = a.d_min, price_end = a.d_max, price_count = a.n
        FROM (
            SELECT ticker, min(date) AS d_min, max(date) AS d_max, count(*) AS n
            FROM prices GROUP BY ticker
        ) a
        WHERE a.ticker = c.ticker AND c.price_count = 0
    """)
    # The starting amount is now a saved setting of the portfolio. A portfolio that had a starting
    # position with cash keeps that cash as its starting capital (start_cash is zeroed, so this runs once).
    op.execute("""
        UPDATE portfolios SET initial_capital = start_cash, start_cash = 0
        WHERE start_date IS NOT NULL AND start_cash > 0
    """)


def downgrade():
    # Data-only fixes: copying initial_capital back into start_cash would be lossy, so nothing is undone.
    pass
