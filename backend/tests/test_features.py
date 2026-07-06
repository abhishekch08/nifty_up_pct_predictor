from datetime import date, timedelta
import numpy as np
import pandas as pd

from app.features import add_options_features, build_feature_frame, price_features


def sample_prices(n=260):
    rng = np.random.default_rng(12)
    close = 20000 * np.exp(np.cumsum(rng.normal(.0002, .008, n)))
    return pd.DataFrame({"date": [date(2024, 1, 1) + timedelta(days=i) for i in range(n)],
                         "open": close * .999, "high": close * 1.006, "low": close * .994,
                         "close": close, "volume": 1_000_000})


def test_features_only_target_future_row():
    result = price_features(sample_prices())
    assert result.target_next_day_return.iloc[:-1].notna().all()
    assert np.isnan(result.target_next_day_return.iloc[-1])
    assert result.close_location_value.between(0, 1).all()
    assert "distance_from_200dma" in result


def test_zero_range_has_neutral_clv():
    frame = sample_prices(5)
    frame["high"] = frame["low"] = frame["close"]
    assert (price_features(frame).close_location_value == .5).all()


def test_calendar_and_vix_features_merge_asof_by_date():
    prices = sample_prices()
    vix = prices[["date", "open", "high", "low"]].copy(); vix["close"] = 14.0
    result = build_feature_frame(prices, vix)
    assert len(result) == len(prices)
    assert result.vix_close.eq(14).all()
    assert set(result.weekly_expiry_flag.unique()) <= {0, 1}


def test_official_bhavcopy_options_work_without_implied_volatility():
    day = date(2026, 7, 6)
    features = pd.DataFrame({"date": [day]})
    options = pd.DataFrame([
        {"date": day, "expiry": date(2026, 7, 7), "strike": 24400, "spot": 24430.35,
         "ce_oi": 1000, "ce_iv": None, "ce_ltp": 120, "pe_oi": 1500, "pe_iv": None, "pe_ltp": 90},
    ])
    result = add_options_features(features, options)
    assert result.pcr_oi.iloc[0] == 1.5
    assert np.isnan(result.iv_skew.iloc[0])
    assert result.straddle_price_atm.iloc[0] == 210
