"""Portfolio weights and backtest simulation. Pure functions: no database, no HTTP."""

import pandas as pd

MANUAL, EQUAL, MARKET_CAP, OWNERSHIP = "manual", "equal", "market_cap", "ownership"
WEIGHTINGS = (MANUAL, EQUAL, MARKET_CAP, OWNERSHIP)
SMI_CAP = 0.20  # the SMI caps every company at 20% of the index

IMMEDIATE, MONTHLY, QUARTERLY, YEARLY, NEVER = "immediate", "monthly", "quarterly", "yearly", "never"
INVEST_FREQUENCIES = (IMMEDIATE, MONTHLY, QUARTERLY, YEARLY, NEVER)  # how often cash is turned into shares
INFLOW_FREQUENCIES = (MONTHLY, QUARTERLY, YEARLY)  # how often new money arrives


def cap_weights(weights, cap=SMI_CAP):
    """Cap each weight and hand the excess to the uncapped ones, pro rata (SMI style).

    With fewer than 1 / cap holdings the cap cannot be met, so the weights are returned unchanged.
    """
    if len(weights) * cap < 1:
        return dict(weights)

    weights = dict(weights)
    capped = set()

    while True:
        over = [ticker for ticker, weight in weights.items() if weight > cap + 1e-12 and ticker not in capped]
        if not over:
            return weights

        for ticker in over:
            weights[ticker] = cap
            capped.add(ticker)

        free = [ticker for ticker in weights if ticker not in capped]
        excess = 1 - sum(weights.values())
        free_total = sum(weights[ticker] for ticker in free)
        for ticker in free:
            weights[ticker] += excess * weights[ticker] / free_total


def target_weights(holdings, weighting, market_caps=None):
    """Weights summing to 1 for holdings [{ticker, weight}] under the given weighting.

    `market_caps` is the size of each company for the market cap weighting, and for the ownership
    weighting the value of all its shares (shares outstanding x price), which is the same thing
    without the cap.
    """
    if weighting == EQUAL:
        raw = {holding["ticker"]: 1.0 for holding in holdings}
    elif weighting == MANUAL:
        raw = {holding["ticker"]: float(holding["weight"]) for holding in holdings}
    elif weighting in (MARKET_CAP, OWNERSHIP):
        raw = {holding["ticker"]: float(market_caps[holding["ticker"]]) for holding in holdings}
    else:
        raise ValueError(f"unknown weighting {weighting!r}")

    total = sum(raw.values())
    weights = {ticker: value / total for ticker, value in raw.items()}
    return cap_weights(weights) if weighting == MARKET_CAP else weights


def fixed_rule(weights):
    """A weight rule that ignores prices: the same target weights every day."""
    return lambda prices: weights


def ownership_rule(holdings, shares_outstanding):
    """Own the same share of every company: the target follows each company's total value day by day."""
    return lambda prices: target_weights(
        holdings,
        OWNERSHIP,
        {holding["ticker"]: shares_outstanding[holding["ticker"]] * prices[holding["ticker"]] for holding in holdings},
    )


def _period(date, frequency):
    year, month = int(date[:4]), int(date[5:7])
    if frequency == YEARLY:
        return year
    if frequency == QUARTERLY:
        return year, (month - 1) // 3
    return year, month


def is_period_end(dates, index, frequency):
    """True on the last trading day of a month / quarter / year. The final row is never one: its period is unfinished."""
    if index + 1 >= len(dates):
        return False
    return _period(dates[index], frequency) != _period(dates[index + 1], frequency)


def is_investing_day(dates, index, frequency):
    if frequency == NEVER:
        return False
    return frequency == IMMEDIATE or is_period_end(dates, index, frequency)


def allocate(cash, prices, shares, weights):
    """Spend cash on whole shares, nearest to the target weights. Returns (shares, cash, purchases).

    Target value per stock is weight x (holdings + cash). One share at a time goes to the most
    under-target stock that is affordable and short by at least half a share; no selling.
    """
    shares = dict(shares)
    purchases = dict.fromkeys(shares, 0)
    total = cash + sum(shares[ticker] * prices[ticker] for ticker in shares)

    while True:
        best, best_shortfall = None, 0.0
        for ticker in shares:
            price = prices[ticker]
            if price <= 0 or price > cash or weights[ticker] <= 0:
                continue
            shortfall = weights[ticker] * total - shares[ticker] * price
            if shortfall >= price / 2 and shortfall > best_shortfall:
                best, best_shortfall = ticker, shortfall

        if best is None:
            return shares, cash, purchases

        shares[best] += 1
        purchases[best] += 1
        cash -= prices[best]


def backtest(
    closes,
    dividends,
    weight_rule,
    initial=0.0,
    inflow=0.0,
    inflow_frequency=MONTHLY,
    invest_frequency=MONTHLY,
    start_shares=None,
    start_cash=0.0,
):
    """Simulate buy-and-hold with a cash balance, whole shares and scheduled investing.

    closes / dividends: DataFrames indexed by "YYYY-MM-DD", one column per ticker, no gaps.
    weight_rule(prices) gives the target weights for a day.

    Start: either `initial` cash, invested on the first day, or a starting position
    (`start_shares` {ticker: shares} plus `start_cash`) that is simply held until the next investing day.
    Dividends and `inflow` (credited on the last trading day of each inflow period) go to the cash balance.
    Whenever the invest frequency says so, the whole balance is spent on whole shares. Nothing is ever sold.
    """
    tickers = list(closes.columns)
    dates = list(closes.index)
    shares = {ticker: float((start_shares or {}).get(ticker, 0)) for ticker in tickers}
    first_prices = closes.iloc[0]
    holding_start = sum(shares[ticker] * first_prices[ticker] for ticker in tickers)

    cash = float(start_cash) if start_shares is not None else float(initial)
    invested = holding_start + cash
    dividends_paid = 0.0
    peak = max_drawdown = 0.0
    series, investments = [], []

    for index, (date, prices) in enumerate(closes.iterrows()):
        for ticker in tickers:
            per_share = dividends.at[date, ticker]
            if per_share:
                payout = shares[ticker] * per_share
                dividends_paid += payout
                cash += payout

        if inflow and index > 0 and is_period_end(dates, index, inflow_frequency):
            cash += inflow
            invested += inflow

        first_day_purchase = index == 0 and start_shares is None
        if cash > 0 and (first_day_purchase or is_investing_day(dates, index, invest_frequency)):
            cash_before = cash
            shares, cash, purchases = allocate(cash, prices, shares, weight_rule(prices))
            bought = [
                {"ticker": ticker, "shares": count, "price": float(prices[ticker])}
                for ticker, count in purchases.items()
                if count
            ]
            if bought:
                investments.append({"date": date, "cash_before": cash_before, "cash_after": cash, "buys": bought})

        value = float(sum(shares[ticker] * prices[ticker] for ticker in tickers) + cash)
        peak = max(peak, value)
        if peak:
            max_drawdown = min(max_drawdown, value / peak - 1)
        series.append({"date": date, "value": value, "invested": invested, "cash": cash})

    last_prices = closes.iloc[-1]
    final_value = series[-1]["value"]
    gain = final_value - invested
    holdings_value = {ticker: float(shares[ticker] * last_prices[ticker]) for ticker in tickers}
    final_weights = weight_rule(last_prices)

    summary = {
        "start_date": series[0]["date"],
        "end_date": series[-1]["date"],
        "invested": invested,
        "final_value": final_value,
        "gain": gain,
        "gain_pct": gain / invested if invested else None,
        "dividends": dividends_paid,
        "cash": cash,
        # Of today's value: how much is money you paid in, and how much the market returned.
        "new_money_share": invested / final_value if final_value else None,
        "returned_share": gain / final_value if final_value else None,
        "max_drawdown": max_drawdown,
        "purchases": sum(buy["shares"] for item in investments for buy in item["buys"]),
    }
    holdings = [
        {
            "ticker": ticker,
            "target_weight": final_weights[ticker],
            "shares": float(shares[ticker]),
            "value": holdings_value[ticker],
            "weight": holdings_value[ticker] / final_value if final_value else None,
        }
        for ticker in tickers
    ]
    return {"summary": summary, "holdings": holdings, "series": series, "investments": investments}


def common_window(frames):
    """First and last date that every price table has, so portfolios can be compared on the same days."""
    return max(frame.index[0] for frame in frames), min(frame.index[-1] for frame in frames)


def next_weekdays(last_date, until):
    """Weekday dates after `last_date` up to and including `until`, as "YYYY-MM-DD" strings."""
    days = pd.bdate_range(pd.Timestamp(last_date) + pd.Timedelta(days=1), pd.Timestamp(until))
    return [day.strftime("%Y-%m-%d") for day in days]


def plan(closes, dividends, weight_rule, until, **rules):
    """What the portfolio will do from the last known day up to `until`, assuming prices stay where they are.

    Continues the same simulation over future weekdays at the last close with no new dividends, so only
    the scheduled inflow and the cash already collected are invested. The last known day counts as still
    to do (its period may be unfinished in the real data), so an investing day on it is the next one.
    Returns the upcoming investments, the investing days around it, and the cash on hand now.
    """
    last_date = closes.index[-1]
    future = next_weekdays(last_date, until)
    extended_closes, extended_dividends = closes, dividends
    if future:
        extended_closes = pd.concat([closes, pd.DataFrame([closes.iloc[-1]] * len(future), index=future)])
        extended_dividends = pd.concat([dividends, pd.DataFrame(0.0, index=future, columns=dividends.columns)])

    real = backtest(closes, dividends, weight_rule, **rules)
    result = backtest(extended_closes, extended_dividends, weight_rule, **rules)

    dates = list(extended_closes.index)
    frequency = rules.get("invest_frequency", MONTHLY)
    investing_days = [date for index, date in enumerate(dates) if is_investing_day(dates, index, frequency)]
    return {
        "as_of": last_date,
        "cash_now": real["series"][-1]["cash"],
        "last_investing_date": next((day for day in reversed(investing_days) if day < last_date), None),
        "next_investing_date": next((day for day in investing_days if day >= last_date), None),
        "investments": [item for item in result["investments"] if item["date"] >= last_date],
    }
