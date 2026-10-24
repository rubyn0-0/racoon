import pandas as pd
import pytest

from racoon.backtest import (
    EQUAL,
    IMMEDIATE,
    MANUAL,
    MARKET_CAP,
    MONTHLY,
    NEVER,
    OWNERSHIP,
    QUARTERLY,
    allocate,
    backtest,
    cap_weights,
    common_window,
    fixed_rule,
    is_period_end,
    market_cap_rule,
    ownership_rule,
    plan,
    size_on,
    target_weights,
)


def prices(rows, tickers=("A", "B")):
    index = [row[0] for row in rows]
    return pd.DataFrame([row[1:] for row in rows], index=index, columns=list(tickers))


def no_dividends(closes):
    return closes * 0.0


def half_half():
    return fixed_rule({"A": 0.5, "B": 0.5})


def test_equal_and_manual_weights():
    holdings = [{"ticker": "A", "weight": 30}, {"ticker": "B", "weight": 10}]

    assert target_weights(holdings, EQUAL) == {"A": 0.5, "B": 0.5}
    assert target_weights(holdings, MANUAL) == {"A": 0.75, "B": 0.25}


def test_market_cap_weights_are_capped_like_the_smi():
    caps = {"A": 500, "B": 200, "C": 100, "D": 100, "E": 50, "F": 50}
    holdings = [{"ticker": ticker} for ticker in caps]

    weights = target_weights(holdings, MARKET_CAP, caps)

    assert sum(weights.values()) == pytest.approx(1)
    assert max(weights.values()) == pytest.approx(0.20)
    # The excess is shared pro rata, so C and D stay equal and above E and F.
    assert weights["C"] == pytest.approx(weights["D"])
    assert weights["C"] > weights["E"]


def test_cap_is_skipped_when_it_cannot_be_met():
    assert cap_weights({"A": 0.7, "B": 0.3}) == {"A": 0.7, "B": 0.3}


def test_ownership_weights_follow_company_value_without_a_cap():
    holdings = [{"ticker": "A"}, {"ticker": "B"}]
    rule = ownership_rule(holdings, {"A": [("2000-01-01", 100)], "B": [("2000-01-01", 300)]})

    assert rule({"A": 10, "B": 10}, "2025-01-02") == pytest.approx({"A": 0.25, "B": 0.75})
    # When A's price doubles, A is worth more, so the target moves with it.
    assert rule({"A": 30, "B": 10}, "2025-01-02") == pytest.approx({"A": 0.5, "B": 0.5})


def test_period_ends():
    dates = ["2025-01-30", "2025-01-31", "2025-02-03", "2025-02-28", "2025-03-31", "2025-04-01"]

    assert [is_period_end(dates, i, MONTHLY) for i in range(6)] == [False, True, False, True, True, False]
    assert [is_period_end(dates, i, QUARTERLY) for i in range(6)] == [False, False, False, False, True, False]


def test_allocate_buys_whole_shares_nearest_the_targets():
    shares, cash, bought = allocate(100, pd.Series({"A": 30, "B": 30}), {"A": 0, "B": 0}, {"A": 0.5, "B": 0.5})

    assert bought == {"A": 2, "B": 1}
    assert shares == {"A": 2, "B": 1}
    assert cash == pytest.approx(10)


def test_allocate_never_sells_and_tops_up_the_lagging_stock():
    held = {"A": 10, "B": 0}  # A is already over its target
    shares, cash, bought = allocate(100, pd.Series({"A": 10, "B": 10}), held, {"A": 0.5, "B": 0.5})

    assert bought == {"A": 0, "B": 10}
    assert cash == pytest.approx(0)


def test_flat_prices_keep_the_money_you_put_in():
    closes = prices([("2025-01-02", 10, 20), ("2025-01-03", 10, 20)])

    result = backtest(closes, no_dividends(closes), half_half(), initial=1000)

    assert result["summary"]["final_value"] == pytest.approx(1000)
    assert result["summary"]["gain"] == pytest.approx(0)
    assert result["holdings"][0]["shares"] == 50
    assert result["holdings"][1]["shares"] == 25


def test_growth_and_share_of_new_money():
    closes = prices([("2025-01-02", 10, 10), ("2025-01-03", 20, 20)])

    summary = backtest(closes, no_dividends(closes), half_half(), initial=1000)["summary"]

    assert summary["final_value"] == pytest.approx(2000)
    assert summary["gain_pct"] == pytest.approx(1.0)
    assert summary["new_money_share"] == pytest.approx(0.5)
    assert summary["returned_share"] == pytest.approx(0.5)


def test_inflow_arrives_on_the_last_trading_day_of_each_period():
    closes = prices([("2025-01-30", 10, 10), ("2025-01-31", 10, 10), ("2025-02-03", 10, 10), ("2025-03-03", 10, 10)])

    result = backtest(closes, no_dividends(closes), half_half(), initial=1000, inflow=100)

    assert [row["invested"] for row in result["series"]] == [1000, 1100, 1200, 1200]
    assert result["summary"]["initial_invested"] == pytest.approx(1000)
    assert result["summary"]["periodic_invested"] == pytest.approx(200)


def test_dividend_cash_waits_for_the_investing_day():
    closes = prices(
        [("2025-01-02", 10), ("2025-01-03", 10), ("2025-01-31", 10), ("2025-02-03", 10)], tickers=("A",)
    )
    dividends = prices(
        [("2025-01-02", 0.0), ("2025-01-03", 1.0), ("2025-01-31", 0.0), ("2025-02-03", 0.0)], tickers=("A",)
    )

    result = backtest(closes, dividends, fixed_rule({"A": 1.0}), initial=1000, invest_frequency=MONTHLY)

    # 100 shares x 1 CHF, held as cash until the month ends, then 10 more whole shares.
    assert [row["cash"] for row in result["series"]] == [0, 100, 0, 0]
    assert [row["dividends"] for row in result["series"]] == [0, 100, 100, 100]
    assert [row["latest_dividend_date"] for row in result["series"]] == [None, "2025-01-03", "2025-01-03", "2025-01-03"]
    assert result["series"][1]["latest_dividend_payout"] == pytest.approx(100)
    assert result["series"][1]["dividend_year"] == "2025"
    assert result["series"][1]["annual_dividends"] == pytest.approx(100)
    assert result["series"][1]["annual_dividend_return"] == pytest.approx(100 / 1100)
    assert result["series"][1]["dividend_year_closing_value"] == pytest.approx(1100)
    assert result["summary"]["dividends"] == pytest.approx(100)
    assert result["holdings"][0]["shares"] == 110


def test_immediate_reinvests_the_same_day_and_never_keeps_cash():
    closes = prices([("2025-01-02", 10), ("2025-01-03", 10)], tickers=("A",))
    dividends = prices([("2025-01-02", 0.0), ("2025-01-03", 1.0)], tickers=("A",))
    rule = fixed_rule({"A": 1.0})

    immediate = backtest(closes, dividends, rule, initial=1000, invest_frequency=IMMEDIATE)
    kept = backtest(closes, dividends, rule, initial=1000, invest_frequency=NEVER)

    assert immediate["holdings"][0]["shares"] == 110
    assert kept["summary"]["cash"] == pytest.approx(100)
    assert kept["summary"]["final_value"] == pytest.approx(1100)


def test_dividend_return_uses_each_calendar_years_closing_value():
    closes = prices(
        [("2024-01-02", 10), ("2024-06-03", 10), ("2025-01-02", 10)],
        tickers=("A",),
    )
    dividends = prices(
        [("2024-01-02", 0.0), ("2024-06-03", 1.0), ("2025-01-02", 2.0)],
        tickers=("A",),
    )

    series = backtest(
        closes,
        dividends,
        fixed_rule({"A": 1.0}),
        initial=1000,
        invest_frequency=NEVER,
    )["series"]

    assert series[0]["annual_dividends"] == pytest.approx(100)
    assert series[0]["annual_dividend_return"] == pytest.approx(100 / 1100)
    assert series[2]["annual_dividends"] == pytest.approx(200)
    assert series[2]["annual_dividend_return"] == pytest.approx(200 / 1300)


def test_inflow_waits_for_the_quarter_when_investing_quarterly():
    closes = prices(
        [("2025-01-30", 10), ("2025-01-31", 10), ("2025-02-28", 10), ("2025-03-31", 10), ("2025-04-01", 10)],
        tickers=("A",),
    )

    result = backtest(
        closes, no_dividends(closes), fixed_rule({"A": 1.0}), initial=0, inflow=100, invest_frequency=QUARTERLY
    )

    assert [row["cash"] for row in result["series"]] == [0, 100, 200, 0, 0]
    assert [item["date"] for item in result["investments"]] == ["2025-03-31"]
    assert result["investments"][0]["buys"][0]["shares"] == 30


def test_owned_shares_count_towards_the_first_purchase():
    closes = prices([("2025-01-02", 10, 20), ("2025-01-03", 10, 20)])

    result = backtest(closes, no_dividends(closes), half_half(), initial=50, start_shares={"A": 10, "B": 5})

    # 10 x 10 + 5 x 20 owned, plus 50 of starting capital: 250 to spread 50/50.
    assert result["series"][0]["invested"] == pytest.approx(250)
    assert [holding["shares"] for holding in result["holdings"]] == [13, 6]
    assert result["summary"]["cash"] == pytest.approx(0)
    assert result["summary"]["final_value"] == pytest.approx(250)


def test_owned_shares_alone_are_simply_held():
    closes = prices([("2025-01-02", 10, 20), ("2025-01-03", 10, 20)])

    result = backtest(closes, no_dividends(closes), half_half(), initial=0, start_shares={"A": 10, "B": 5})

    assert result["investments"] == []
    assert result["series"][0]["value"] == pytest.approx(200)


def test_ownership_backtest_buys_in_proportion_to_company_value():
    closes = prices([("2025-01-02", 10, 10), ("2025-01-03", 10, 10)])
    rule = ownership_rule([{"ticker": "A"}, {"ticker": "B"}], {"A": [("2000-01-01", 100)], "B": [("2000-01-01", 300)]})

    result = backtest(closes, no_dividends(closes), rule, initial=400)

    assert [holding["shares"] for holding in result["holdings"]] == [10, 30]


def test_max_drawdown():
    closes = prices([("2025-01-02", 10), ("2025-01-03", 5), ("2025-01-06", 15)], tickers=("A",))

    summary = backtest(closes, no_dividends(closes), fixed_rule({"A": 1.0}), initial=100)["summary"]

    assert summary["max_drawdown"] == pytest.approx(-0.5)
    assert summary["max_drawdown_start"] == "2025-01-02"
    assert summary["max_drawdown_end"] == "2025-01-03"
    assert summary["max_absolute_drawdown"] == pytest.approx(50)
    assert summary["max_absolute_drawdown_start"] == "2025-01-02"
    assert summary["max_absolute_drawdown_end"] == "2025-01-03"


def test_largest_relative_and_absolute_drawdowns_can_be_different():
    closes = prices(
        [("2025-01-02", 10), ("2025-01-03", 5), ("2025-01-06", 50), ("2025-01-07", 40)],
        tickers=("A",),
    )

    summary = backtest(closes, no_dividends(closes), fixed_rule({"A": 1.0}), initial=100)["summary"]

    assert summary["max_drawdown"] == pytest.approx(-0.5)
    assert summary["max_drawdown_start"] == "2025-01-02"
    assert summary["max_drawdown_end"] == "2025-01-03"
    assert summary["max_absolute_drawdown"] == pytest.approx(100)
    assert summary["max_absolute_drawdown_start"] == "2025-01-06"
    assert summary["max_absolute_drawdown_end"] == "2025-01-07"


def test_plan_lists_the_next_investments_at_flat_prices():
    closes = prices([("2025-01-30", 10), ("2025-01-31", 10)], tickers=("A",))

    result = plan(
        closes, no_dividends(closes), fixed_rule({"A": 1.0}), "2025-03-31", initial=1000, inflow=100
    )

    assert result["as_of"] == "2025-01-31"
    assert result["cash_now"] == pytest.approx(0)
    assert result["next_investing_date"] == "2025-01-31"
    assert [item["date"] for item in result["investments"]] == ["2025-01-31", "2025-02-28"]
    assert result["investments"][0]["buys"] == [{"ticker": "A", "shares": 10, "price": 10.0}]


def test_common_window_is_the_overlap_of_all_price_tables():
    early = prices([("2025-01-02", 1), ("2025-01-10", 1)], tickers=("A",))
    late = prices([("2025-01-06", 1), ("2025-01-15", 1)], tickers=("A",))

    assert common_window([early, late]) == ("2025-01-06", "2025-01-10")


def test_portfolios_with_different_weights_share_the_money_paid_in():
    closes = prices([("2025-01-30", 10, 10), ("2025-01-31", 10, 20), ("2025-02-03", 10, 20)])
    all_a = backtest(closes, no_dividends(closes), fixed_rule({"A": 1.0, "B": 0.0}), initial=1000, inflow=100)
    all_b = backtest(closes, no_dividends(closes), fixed_rule({"A": 0.0, "B": 1.0}), initial=1000, inflow=100)

    assert [row["invested"] for row in all_a["series"]] == [row["invested"] for row in all_b["series"]]
    assert all_a["series"][-1]["value"] != all_b["series"][-1]["value"]


def test_size_on_uses_the_newest_entry_dated_on_or_before_the_day():
    history = [("2025-01-01", 100), ("2025-03-01", 300), ("2025-06-01", 500)]

    assert size_on(history, "2025-03-01") == 300  # an entry is valid from its own date
    assert size_on(history, "2025-05-31") == 300
    assert size_on(history, "2030-01-01") == 500
    assert size_on(history, "2024-06-01") == 100  # before the first entry: the earliest one
    assert size_on([("2025-01-01", 7)], "2020-01-01") == 7


def synthetic_year():
    days = pd.bdate_range("2024-01-01", "2024-12-31").strftime("%Y-%m-%d")
    rows = [(day, 10 + index % 7, 20 + (index * 3) % 11, 5 + index % 5) for index, day in enumerate(days)]
    return prices(rows, tickers=("A", "B", "C"))


def test_size_rules_with_one_size_row_give_exactly_the_results_of_the_single_size_weights():
    closes = synthetic_year()
    holdings = [{"ticker": ticker} for ticker in closes.columns]
    caps = {"A": 5e9, "B": 2e9, "C": 1e9}
    shares = {"A": 3e6, "B": 8e6, "C": 1e6}
    rules = dict(initial=5000, inflow=300, invest_frequency=MONTHLY)

    old_market_cap = fixed_rule(target_weights(holdings, MARKET_CAP, caps))
    new_market_cap = market_cap_rule(holdings, {ticker: [("2026-03-04", cap)] for ticker, cap in caps.items()})
    assert backtest(closes, no_dividends(closes), new_market_cap, **rules) == backtest(
        closes, no_dividends(closes), old_market_cap, **rules
    )

    def old_ownership(prices, day):
        return target_weights(holdings, OWNERSHIP, {ticker: shares[ticker] * prices[ticker] for ticker in shares})

    new_ownership = ownership_rule(holdings, {ticker: [("2026-03-04", count)] for ticker, count in shares.items()})
    assert backtest(closes, no_dividends(closes), new_ownership, **rules) == backtest(
        closes, no_dividends(closes), old_ownership, **rules
    )


def test_size_rules_use_the_size_that_was_valid_on_each_day():
    holdings = [{"ticker": "A"}, {"ticker": "B"}]
    cap_history = {"A": [("2025-01-01", 100), ("2025-02-01", 300)], "B": [("2025-01-01", 100), ("2025-02-01", 100)]}
    prices_that_day = {"A": 10, "B": 10}

    by_cap = market_cap_rule(holdings, cap_history)
    assert by_cap(prices_that_day, "2025-01-15") == pytest.approx({"A": 0.5, "B": 0.5})
    assert by_cap(prices_that_day, "2025-02-10") == pytest.approx({"A": 0.75, "B": 0.25})
    assert by_cap(prices_that_day, "2024-12-01") == pytest.approx({"A": 0.5, "B": 0.5})  # before the first row

    by_ownership = ownership_rule(holdings, cap_history)  # here the history holds share counts
    assert by_ownership(prices_that_day, "2025-01-15") == pytest.approx({"A": 0.5, "B": 0.5})
    assert by_ownership(prices_that_day, "2025-02-10") == pytest.approx({"A": 0.75, "B": 0.25})
