import os
from datetime import date, datetime, timezone

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from racoon.constants import WEIGHTINGS
from racoon.db import alembic_config

needs_database = pytest.mark.skipif(
    "RACOON_TEST_DATABASE_URL" not in os.environ,
    reason="set RACOON_TEST_DATABASE_URL to an empty throwaway database to run",
)


def test_migrations_form_one_straight_line_from_the_baseline():
    script = ScriptDirectory.from_config(alembic_config())

    assert len(script.get_heads()) == 1  # two heads means two people branched; merge them
    chain = [revision.revision for revision in script.walk_revisions()]
    assert chain[0] == "0004"  # walk_revisions goes from the newest back to the baseline
    assert chain[-1] == "0001"


@needs_database
def test_weighting_check_matches_the_weightings_in_the_code():
    from alembic import command

    engine = create_engine(os.environ["RACOON_TEST_DATABASE_URL"])
    config = alembic_config()
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        connection.commit()
        definition = connection.execute(
            text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'portfolios_weighting_check'")
        ).scalar_one()

    # If WEIGHTINGS changes, add a migration that replaces portfolios_weighting_check.
    assert definition.count("::text") == len(WEIGHTINGS)
    assert all(f"'{name}'" in definition for name in WEIGHTINGS)


LEGACY_COMPANY_COLUMNS = (
    "ticker, in_smi, price_start, price_end, price_count, refreshed_at, full_history, market_cap, shares_outstanding"
)


@pytest.fixture
def empty_database():
    """The throwaway database with nothing in it, before and after the test."""
    engine = create_engine(os.environ["RACOON_TEST_DATABASE_URL"])

    def wipe():
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))

    wipe()
    yield engine
    wipe()
    engine.dispose()


def legacy_rows(connection):
    return [tuple(row) for row in connection.execute(
        text(f"SELECT {LEGACY_COMPANY_COLUMNS} FROM companies ORDER BY ticker")
    )]


@needs_database
def test_companies_split_moves_the_data_and_the_downgrade_restores_it(empty_database):
    from alembic import command

    config = alembic_config()
    refreshed = datetime(2026, 3, 4, 12, 0, tzinfo=timezone.utc)
    with empty_database.connect() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0002")
        connection.commit()
        connection.execute(text("""
            INSERT INTO companies (ticker, name, exchange, country, in_smi, market_cap, shares_outstanding,
                                   price_start, price_end, price_count, refreshed_at, full_history)
            VALUES
                ('IN.SW', 'Member', 'SIX', 'CH', TRUE, 5e9, 1e7, '2001-02-05', '2026-03-04', 2, :refreshed, TRUE),
                ('OUT.SW', 'Outsider', 'SIX', 'US', FALSE, NULL, 2e6, '2010-01-04', '2010-01-05', 2, NULL, FALSE),
                ('NEW.SW', 'No prices', 'SIX', 'CH', TRUE, NULL, NULL, NULL, NULL, 0, NULL, FALSE)
        """), {"refreshed": refreshed})
        connection.execute(text("""
            INSERT INTO prices (ticker, date, close) VALUES
                ('IN.SW', '2001-02-05', 1), ('IN.SW', '2026-03-04', 2),
                ('OUT.SW', '2010-01-04', 1), ('OUT.SW', '2010-01-05', 1)
        """))
        connection.commit()
        original = legacy_rows(connection)

        command.upgrade(config, "0004")
        connection.commit()

        columns = set(connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'companies'"
        )).scalars())
        assert columns == {"ticker", "name", "exchange", "country", "exchange_timezone"}

        states = {row[0]: tuple(row[1:]) for row in connection.execute(text(
            "SELECT ticker, price_start, price_end, price_count, refreshed_at, full_history FROM company_load_state"
        ))}
        assert states == {
            "IN.SW": (date(2001, 2, 5), date(2026, 3, 4), 2, refreshed, True),
            "OUT.SW": (date(2010, 1, 4), date(2010, 1, 5), 2, None, False),
            "NEW.SW": (None, None, 0, None, False),
        }
        memberships = [tuple(row) for row in connection.execute(text(
            "SELECT market, ticker, valid_from, valid_to FROM index_membership ORDER BY ticker"
        ))]
        assert memberships == [
            ("SMI", "IN.SW", date(2001, 2, 5), None),
            ("SMI", "NEW.SW", date(2000, 1, 1), None),  # no prices: the default start
        ]
        fundamentals = [tuple(row) for row in connection.execute(text(
            "SELECT ticker, as_of, market_cap, shares_outstanding FROM company_fundamentals ORDER BY ticker"
        ))]
        assert fundamentals == [
            ("IN.SW", date(2026, 3, 4), 5e9, 1e7),
            ("OUT.SW", fundamentals[1][1], None, 2e6),  # never refreshed: dated today
        ]
        assert fundamentals[1][1] == connection.execute(text("SELECT CURRENT_DATE")).scalar_one()

        command.downgrade(config, "0002")
        connection.commit()
        assert legacy_rows(connection) == original
        tables = set(connection.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        )).scalars())
        assert not tables & {"company_load_state", "index_membership", "company_fundamentals"}
