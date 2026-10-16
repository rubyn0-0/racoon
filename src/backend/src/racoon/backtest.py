"""Portfolio weights and backtest simulation. Pure functions: no database, no HTTP."""

WEIGHTINGS = ("manual", "equal", "market_cap")
SMI_CAP = 0.20  # the SMI caps every company at 20% of the index


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
    """Weights summing to 1 for holdings [{ticker, weight}] under the given weighting."""
    if weighting == "equal":
        raw = {holding["ticker"]: 1.0 for holding in holdings}
    elif weighting == "manual":
        raw = {holding["ticker"]: float(holding["weight"]) for holding in holdings}
    elif weighting == "market_cap":
        raw = {holding["ticker"]: float(market_caps[holding["ticker"]]) for holding in holdings}
    else:
        raise ValueError(f"unknown weighting {weighting!r}")

    total = sum(raw.values())
    weights = {ticker: value / total for ticker, value in raw.items()}
    return cap_weights(weights) if weighting == "market_cap" else weights


def backtest(closes, dividends, weights, initial, monthly, reinvest=True):
    """Simulate buy-and-hold with optional monthly contributions.

    closes / dividends: DataFrames indexed by "YYYY-MM-DD", one column per ticker, no gaps.
    Day one buys `initial` split by `weights`; the first trading day of each later month adds
    `monthly` the same way. Dividends (cash per share on the ex-date) are reinvested in the
    same stock, or kept as cash when `reinvest` is False.
    """
    tickers = list(weights)
    shares = dict.fromkeys(tickers, 0.0)
    cash = invested = dividends_paid = 0.0
    peak = max_drawdown = 0.0
    month = None
    series = []

    for date, prices in closes.iterrows():
        # Dividends go to shares held before today's purchase.
        for ticker in tickers:
            per_share = dividends.at[date, ticker]
            if per_share:
                payout = shares[ticker] * per_share
                dividends_paid += payout
                if reinvest:
                    shares[ticker] += payout / prices[ticker]
                else:
                    cash += payout

        if month is None:
            contribution = initial
        elif date[:7] != month:
            contribution = monthly
        else:
            contribution = 0.0
        month = date[:7]

        if contribution:
            invested += contribution
            for ticker in tickers:
                shares[ticker] += contribution * weights[ticker] / prices[ticker]

        value = float(sum(shares[ticker] * prices[ticker] for ticker in tickers) + cash)
        peak = max(peak, value)
        if peak:
            max_drawdown = min(max_drawdown, value / peak - 1)
        series.append({"date": date, "value": value, "invested": invested})

    last_prices = closes.iloc[-1]
    final_value = series[-1]["value"]
    gain = final_value - invested
    holdings_value = {ticker: float(shares[ticker] * last_prices[ticker]) for ticker in tickers}

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
    }
    holdings = [
        {
            "ticker": ticker,
            "target_weight": weights[ticker],
            "shares": float(shares[ticker]),
            "value": holdings_value[ticker],
            "weight": holdings_value[ticker] / final_value if final_value else None,
        }
        for ticker in tickers
    ]
    return {"summary": summary, "holdings": holdings, "series": series}
