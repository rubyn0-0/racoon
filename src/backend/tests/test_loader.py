from datetime import date, datetime, timedelta, timezone

import pandas as pd

from racoon.backtest import limiting_stock
import racoon.db as db
import racoon.loader as loader
from racoon.loader import FULL, QUEUED_STUCK_AFTER, STUCK_AFTER, TOP_UP, can_requeue, has_split, is_stuck, needs_load, previous_weekday

TODAY = date(2026, 10, 14)  # a Wednesday
NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def meta(
    count=5000, full=True, end=date(2026, 10, 13), refreshed=NOW - timedelta(hours=1), market_cap=1e9, shares=1e6,
    zone=None,
):
    return {
        "price_count": count, "full_history": full, "price_end": end, "refreshed_at": refreshed,
        "market_cap": market_cap, "shares_outstanding": shares, "exchange_timezone": zone,
    }


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
    assert limiting_stock(first_days, "2019-04-09") is None
    # Starting after the youngest listing: nothing is cut short.
    assert limiting_stock(first_days, "2020-01-01") is None
    assert limiting_stock(pd.Series({"A": "2000-01-03", "B": "2000-01-03"})) is None
    assert limiting_stock(pd.Series({"A": "2000-01-03", "B": "2000-01-03"}), "1999-01-01") == (
        "A",
        "2000-01-03",
    )


def test_missing_company_sizes_are_retried_after_the_refresh_pause():
    assert needs_load(meta(market_cap=None, refreshed=NOW - timedelta(hours=30)), TODAY, NOW) == TOP_UP
    assert needs_load(meta(shares=None, refreshed=NOW - timedelta(hours=30)), TODAY, NOW) == TOP_UP
    assert needs_load(meta(market_cap=None, refreshed=NOW - timedelta(hours=1)), TODAY, NOW) is None


def test_a_last_day_stored_while_unfinished_is_topped_up_after_the_pause():
    same_day = meta(end=date(2026, 10, 13), refreshed=datetime(2026, 10, 13, 15, 0, tzinfo=timezone.utc))
    assert needs_load(same_day, TODAY, NOW) == TOP_UP
    # Refreshed the same day but less than 12 h ago: wait.
    recent = meta(end=date(2026, 10, 14), refreshed=NOW - timedelta(hours=1))
    assert needs_load(recent, TODAY, NOW) is None
    # Refreshed on a later day than price_end: final.
    assert needs_load(meta(end=date(2026, 10, 13), refreshed=datetime(2026, 10, 14, 0, 30, tzinfo=timezone.utc)), TODAY, NOW + timedelta(hours=14)) is None


def test_has_split_only_sees_real_split_events():
    def frame(splits):
        return pd.DataFrame({"date": ["2026-10-12", "2026-10-13"], "stock_splits": splits})

    assert has_split(frame([0.0, 2.0]))
    assert has_split(frame([0.5, 0.0]))  # reverse split
    assert not has_split(frame([0.0, 0.0]))
    assert not has_split(frame([float("nan"), 0.0]))
    assert not has_split(None)
    assert not has_split(frame([2.0, 0.0]), after="2026-10-13")  # already stored


def test_stuck_jobs_are_detected_and_only_a_loading_job_without_a_live_thread_is_requeued():
    class Thread:
        def __init__(self, alive):
            self.alive = alive

        def is_alive(self):
            return self.alive

    # A loading job is timed from when it started, not from when it was queued.
    job = {"state": loader.LOADING, "since": 0.0, "started": 100.0}
    assert not is_stuck(job, 100 + STUCK_AFTER)
    assert is_stuck(job, 100 + STUCK_AFTER + 1)
    assert not is_stuck({"state": loader.READY, "since": 0}, 10_000)
    late = 100 + STUCK_AFTER * 3 + 1
    lost, slow = {**job, "thread": Thread(False)}, {**job, "thread": Thread(True)}
    assert not can_requeue(lost, 100 + STUCK_AFTER + 1)  # not late enough yet
    assert can_requeue(lost, late)
    assert not can_requeue(slow, late)  # slow, not lost
    assert not can_requeue(job, late)  # no thread recorded: not a loading job we can judge

    # A queued job waits longer before it counts as stuck, and is never queued again: it will still run.
    queued = {"state": loader.QUEUED, "since": 100.0}
    assert not is_stuck(queued, 100 + QUEUED_STUCK_AFTER)
    assert is_stuck(queued, 100 + QUEUED_STUCK_AFTER + 1)
    assert not can_requeue(queued, 100 + QUEUED_STUCK_AFTER * 10)


def test_the_migration_lock_release_drops_the_connection_when_it_fails_and_never_raises():
    class Connection:
        def __init__(self, fail_on_rollback):
            self.fail_on_rollback = fail_on_rollback
            self.invalidated = False

        def rollback(self):
            if self.fail_on_rollback:
                raise RuntimeError("connection lost")

        def execute(self, *_arguments):
            pass

        def commit(self):
            pass

        def invalidate(self):
            self.invalidated = True

    healthy, broken = Connection(False), Connection(True)
    db._release_migration_lock(healthy)
    db._release_migration_lock(broken)  # does not raise

    assert not healthy.invalidated
    assert broken.invalidated


def test_the_unfinished_day_check_uses_the_calendar_of_the_exchange():
    # Refreshed 02:00 UTC on Oct 14 = still Oct 13 evening in New York: the day of its last stored session.
    new_york = meta(end=date(2026, 10, 13), refreshed=datetime(2026, 10, 14, 2, 0, tzinfo=timezone.utc), zone="America/New_York")
    assert loader.last_day_unfinished(new_york)
    # The same moment judged by UTC would call the day final.
    assert not loader.last_day_unfinished({**new_york, "exchange_timezone": None})
    # Later, on Oct 14 in New York, the session of Oct 13 is certainly complete.
    assert not loader.last_day_unfinished({**new_york, "refreshed_at": datetime(2026, 10, 14, 5, 0, tzinfo=timezone.utc)})

    # East of UTC the other way round: 16:00 UTC on Oct 13 is already Oct 14 in Tokyo, so Oct 13 is final.
    tokyo = meta(end=date(2026, 10, 13), refreshed=datetime(2026, 10, 13, 16, 0, tzinfo=timezone.utc), zone="Asia/Tokyo")
    assert not loader.last_day_unfinished(tokyo)
    assert loader.last_day_unfinished({**tokyo, "exchange_timezone": None})


def test_an_unknown_or_missing_timezone_falls_back_to_utc():
    refreshed = datetime(2026, 10, 14, 2, 0, tzinfo=timezone.utc)

    for zone in (None, "", "Mars/Olympus_Mons"):
        assert loader.exchange_zone(zone) is timezone.utc
        assert not loader.last_day_unfinished(meta(end=date(2026, 10, 13), refreshed=refreshed, zone=zone))
    assert str(loader.exchange_zone("Europe/Zurich")) == "Europe/Zurich"


def test_the_exchange_timezone_decides_whether_a_top_up_is_due():
    stored_evening = datetime(2026, 10, 14, 2, 0, tzinfo=timezone.utc)  # 22:00 on Oct 13 in New York
    stock = meta(end=date(2026, 10, 13), refreshed=stored_evening, zone="America/New_York")

    assert needs_load(stock, date(2026, 10, 14), NOW + timedelta(hours=14)) == TOP_UP
    assert needs_load({**stock, "exchange_timezone": None}, date(2026, 10, 14), NOW + timedelta(hours=14)) is None
