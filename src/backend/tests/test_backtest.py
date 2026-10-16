import pandas as pd
import pytest

from racoon.backtest import backtest, cap_weights, target_weights


def prices(rows, tickers=("A", "B")):
    index = [row[0] for row in rows]
    return pd.DataFrame([row[1:] for row in rows], index=index, columns=list(tickers))


def no_dividends(closes):
    return closes * 0.0


def test_equal_and_manual_weights():
    holdings = [{"ticker": "A", "weight": 30}, {"ticker": "B", "weight": 10}]

    assert target_weights(holdings, "equal") == {"A": 0.5, "B": 0.5}
    assert target_weights(holdings, "manual") == {"A": 0.75, "B": 0.25}


def test_market_cap_weights_are_capped_like_the_smi():
    caps = {"A": 500, "B": 200, "C": 100, "D": 100, "E": 50, "F": 50}
    holdings = [{"ticker": ticker} for ticker in caps]

    weights = target_weights(holdings, "market_cap", caps)

    assert sum(weights.values()) == pytest.approx(1)
    assert max(weights.values()) == pytest.approx(0.20)
    # The excess is shared pro rata, so C and D stay equal and above E and F.
    assert weights["C"] == pytest.approx(weights["D"])
    assert weights["C"] > weights["E"]


def test_cap_is_skipped_when_it_cannot_be_met():
    assert cap_weights({"A": 0.7, "B": 0.3}) == {"A": 0.7, "B": 0.3}


def test_flat_prices_keep_the_money_you_put_in():
    closes = prices([("2025-01-02", 10, 20), ("2025-01-03", 10, 20)])

    result = backtest(closes, no_dividends(closes), {"A": 0.5, "B": 0.5}, initial=1000, monthly=0)

    assert result["summary"]["final_value"] == pytest.approx(1000)
    assert result["summary"]["gain"] == pytest.approx(0)
    assert result["holdings"][0]["shares"] == pytest.approx(50)


def test_growth_and_share_of_new_money():
    closes = prices([("2025-01-02", 10, 10), ("2025-01-03", 20, 20)])

    summary = backtest(closes, no_dividends(closes), {"A": 0.5, "B": 0.5}, initial=1000, monthly=0)["summary"]

    assert summary["final_value"] == pytest.approx(2000)
    assert summary["gain_pct"] == pytest.approx(1.0)
    assert summary["new_money_share"] == pytest.approx(0.5)
    assert summary["returned_share"] == pytest.approx(0.5)


def test_monthly_contribution_on_first_trading_day_of_each_month():
    closes = prices([("2025-01-30", 10, 10), ("2025-01-31", 10, 10), ("2025-02-03", 10, 10), ("2025-03-03", 10, 10)])

    result = backtest(closes, no_dividends(closes), {"A": 0.5, "B": 0.5}, initial=1000, monthly=100)

    assert [row["invested"] for row in result["series"]] == [1000, 1000, 1100, 1200]


def test_dividends_reinvested_or_kept_as_cash():
    closes = prices([("2025-01-02", 10), ("2025-01-03", 10)], tickers=("A",))
    dividends = prices([("2025-01-02", 0.0), ("2025-01-03", 1.0)], tickers=("A",))

    reinvested = backtest(closes, dividends, {"A": 1.0}, initial=1000, monthly=0, reinvest=True)
    paid_out = backtest(closes, dividends, {"A": 1.0}, initial=1000, monthly=0, reinvest=False)

    # 100 shares x 1 CHF dividend.
    assert reinvested["summary"]["dividends"] == pytest.approx(100)
    assert reinvested["holdings"][0]["shares"] == pytest.approx(110)
    assert paid_out["summary"]["cash"] == pytest.approx(100)
    assert paid_out["summary"]["final_value"] == pytest.approx(1100)


def test_max_drawdown():
    closes = prices([("2025-01-02", 10), ("2025-01-03", 5), ("2025-01-06", 15)], tickers=("A",))

    summary = backtest(closes, no_dividends(closes), {"A": 1.0}, initial=100, monthly=0)["summary"]

    assert summary["max_drawdown"] == pytest.approx(-0.5)
