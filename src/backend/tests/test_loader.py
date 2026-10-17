from datetime import date, datetime, timedelta, timezone

import pandas as pd

from racoon.backtest import limiting_stock
from racoon.loader import FULL, TOP_UP, needs_load, previous_weekday

TODAY = date(2026, 10, 14)  # a Wednesday
NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def meta(count=5000, full=True, end=date(2026, 10, 13), refreshed=NOW - timedelta(hours=1)):
    return {"price_count": count, "full_history": full, "price_end": end, "refreshed_at": refreshed}


def test_previous_weekday_skips_the_weekend():
    assert previous_weekday(date(2026, 10, 14)) == date(2026, 10, 13)  # Wednesday -> Tuesday
    assert previous_weekday(date(2026, 10, 12)) == date(2026, 10, 9)  # Monday -> Friday
    assert previous_weekday(date(2026, 10, 11)) == date(2026, 10, 9)  # Sunday -> Friday


def test_a_stock_without_prices_or_with_part_of_the_history_needs_a_full_load():
    assert needs_load(meta(count=0, full=False, end=None, refreshed=None), TODAY, NOW) == FULL
    assert needs_load(meta(full=False), TODAY, NOW) == FULL


def test_old_data_refreshed_long_ago_needs_a_top_up():
    old = meta(end=date(2026, 10, 9), refreshed=NOW - timedelta(hours=30))

    assert needs_load(old, TODAY, NOW) == TOP_UP


def test_fresh_or_recently_refreshed_data_is_left_alone():
    assert needs_load(meta(), TODAY, NOW) is None
    # Behind by days, but refreshed an hour ago (for example a holiday): do not ask Yahoo again yet.
    assert needs_load(meta(end=date(2026, 10, 9), refreshed=NOW - timedelta(hours=1)), TODAY, NOW) is None


def test_the_last_listed_stock_limits_the_test():
    first_days = pd.Series({"A": "2000-01-03", "B": "2019-04-09", "C": "2005-06-01"})

    assert limiting_stock(first_days) == ("B", "2019-04-09")
    assert limiting_stock(first_days, "2000-01-01") == ("B", "2019-04-09")
    # Starting after the youngest listing: nothing is cut short.
    assert limiting_stock(first_days, "2020-01-01") is None
    assert limiting_stock(pd.Series({"A": "2000-01-03", "B": "2000-01-03"})) is None
