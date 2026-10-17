import pandas as pd

INTERVALS = ("day", "week", "month", "year")
MAX_WINDOWS = 5
MIN_WINDOW, MAX_WINDOW = 2, 400


def average_column(window):
    return f"ma{window}"


def parse_windows(value):
    """Turn "20,50,200" into [20, 50, 200]; raise ValueError on bad input."""
    if not value:
        return []

    try:
        windows = sorted({int(part) for part in value.split(",")})
    except ValueError:
        raise ValueError("ma must be a comma separated list of whole numbers")

    if len(windows) > MAX_WINDOWS:
        raise ValueError(f"ma accepts at most {MAX_WINDOWS} windows")
    if windows[0] < MIN_WINDOW or windows[-1] > MAX_WINDOW:
        raise ValueError(f"ma windows must be between {MIN_WINDOW} and {MAX_WINDOW}")

    return windows


def _period_key(dates, interval):
    if interval == "year":
        return dates.dt.strftime("%Y")
    if interval == "month":
        return dates.dt.strftime("%Y-%m")
    return dates - pd.to_timedelta(dates.dt.weekday, unit="D")  # Monday of that week


def _period_center(dates, interval):
    """Middle of each row's calendar period, so aggregated candles are evenly spaced on a date axis."""
    if interval == "week":
        # Trading week Monday 00:00 to Friday 24:00, so the middle is Wednesday noon.
        start = dates - pd.to_timedelta(dates.dt.weekday, unit="D")
        return start + pd.Timedelta(days=2, hours=12)

    period = dates.dt.to_period("M" if interval == "month" else "Y")
    start = period.dt.start_time
    end = (period + 1).dt.start_time
    return start + (end - start) / 2


def aggregate(df, interval):
    """Roll daily rows up to week/month/year candles; "day" returns the rows unchanged.

    Aggregated rows keep `date` (last trading day, used for ranges) and add `center`
    (middle of the period, used as the candle position).
    """
    if interval == "day" or df.empty:
        return df

    dates = pd.to_datetime(df["date"])
    df = df.assign(center=_period_center(dates, interval).dt.strftime("%Y-%m-%d %H:%M"))
    key = _period_key(dates, interval)

    return df.groupby(key, sort=True).agg(
        center=("center", "first"),
        date=("date", "last"),
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        adjusted_close=("adjusted_close", "last"),
        volume=("volume", "sum"),
        dividends=("dividends", "sum"),
        stock_splits=("stock_splits", "sum"),
    ).reset_index(drop=True)


def add_moving_averages(df, windows):
    """Add a simple moving average of close per window as ma<N>; the first N-1 rows are NaN."""
    df = df.copy()

    for window in windows:
        df[average_column(window)] = df["close"].rolling(window).mean()

    return df


def to_records(df):
    """Rows as plain dicts for JSON: NaN becomes None, volume stays a whole number."""
    df = df.copy()
    df["volume"] = df["volume"].round().astype("Int64")
    return df.astype(object).where(df.notna(), None).to_dict("records")
