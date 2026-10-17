import json

import pandas as pd
import pytest

from racoon.analysis import add_moving_averages, aggregate, parse_windows, to_records

COLUMNS = ["date", "open", "high", "low", "close", "adjusted_close", "volume", "dividends", "stock_splits"]


def frame():
    # Mon-Wed of one week, Mon-Tue of the next (spanning a month end), then one day in January.
    rows = [
        ("2025-01-27", 10, 12, 9, 11, 11, 100, 0.0, 0.0),
        ("2025-01-28", 11, 15, 10, 14, 14, 200, 0.5, 0.0),
        ("2025-01-31", 14, 16, 13, 15, 15, 300, 0.0, 0.0),
        ("2025-02-03", 15, 18, 14, 17, 17, 400, 0.0, 0.0),
        ("2025-02-04", 17, 19, 8, 9, 9, 500, 0.0, 0.0),
        ("2026-01-05", 9, 10, 7, 8, 8, 600, 0.0, 0.0),
    ]
    return pd.DataFrame(rows, columns=COLUMNS)


def test_day_is_unchanged():
    df = frame()
    assert aggregate(df, "day") is df


def test_week_aggregation():
    weeks = aggregate(frame(), "week")

    assert list(weeks["date"]) == ["2025-01-31", "2025-02-04", "2026-01-05"]
    first = weeks.iloc[0]
    assert (first["open"], first["high"], first["low"], first["close"]) == (10, 16, 9, 15)
    assert first["volume"] == 600
    assert first["dividends"] == 0.5
    second = weeks.iloc[1]
    assert (second["open"], second["high"], second["low"], second["close"]) == (15, 19, 8, 9)


def test_candles_sit_at_period_centers():
    weeks = aggregate(frame(), "week")
    # Week of Mon 2025-01-27: Wednesday noon, whatever the last trading day was.
    assert list(weeks["center"]) == ["2025-01-29 12:00", "2025-02-05 12:00", "2026-01-07 12:00"]

    months = aggregate(frame(), "month")
    assert months.iloc[0]["center"] == "2025-01-16 12:00"  # 31 days, middle at 15.5 days
    assert months.iloc[1]["center"] == "2025-02-15 00:00"  # 28 days

    years = aggregate(frame(), "year")
    assert years.iloc[0]["center"] == "2025-07-02 12:00"
    assert "center" not in aggregate(frame(), "day")


def test_month_and_year_aggregation():
    months = aggregate(frame(), "month")
    assert list(months["date"]) == ["2025-01-31", "2025-02-04", "2026-01-05"]
    assert months.iloc[0]["volume"] == 600

    years = aggregate(frame(), "year")
    assert list(years["date"]) == ["2025-02-04", "2026-01-05"]
    assert (years.iloc[0]["open"], years.iloc[0]["close"]) == (10, 9)
    assert years.iloc[0]["volume"] == 1500


def test_moving_average_values_and_leading_nulls():
    df = add_moving_averages(frame(), [2, 3])

    assert df["ma2"].isna().tolist() == [True, False, False, False, False, False]
    assert df["ma2"].iloc[1] == pytest.approx((11 + 14) / 2)
    assert df["ma3"].isna().tolist() == [True, True, False, False, False, False]
    assert df["ma3"].iloc[2] == pytest.approx((11 + 14 + 15) / 3)


def test_to_records_is_valid_json():
    records = to_records(add_moving_averages(frame(), [2]))

    assert records[0]["ma2"] is None
    assert records[1]["volume"] == 200
    json.dumps(records, allow_nan=False)


def test_parse_windows():
    assert parse_windows(None) == []
    assert parse_windows("50,20,20") == [20, 50]

    for bad in ("abc", "1", "401", "2,3,4,5,6,7"):
        with pytest.raises(ValueError):
            parse_windows(bad)
