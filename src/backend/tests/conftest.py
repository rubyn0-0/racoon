"""Safety net for the database tests: they drop and truncate tables, so they refuse to run unless the
database in RACOON_TEST_DATABASE_URL has a name ending in "_test" and is not the configured DATABASE_URL one."""
import os

import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from racoon.db import Settings


def pytest_configure(config):
    url = os.environ.get("RACOON_TEST_DATABASE_URL")
    if not url:
        return
    name = make_url(url).database or ""
    try:
        owners = make_url(Settings().database_url).database
    except (ValidationError, ValueError):  # no DATABASE_URL configured: nothing to collide with
        owners = None
    if not name.endswith("_test") or name == owners:
        pytest.exit(
            "RACOON_TEST_DATABASE_URL must name a throwaway database whose name ends in '_test' and is not "
            "the database in DATABASE_URL; the database tests wipe their tables.",
            returncode=2,
        )
