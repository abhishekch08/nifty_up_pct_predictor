from __future__ import annotations

import numpy as np
import pandas as pd


def safe_divide(a: pd.Series, b: pd.Series) -> pd.Series:
    return a.div(b.replace(0, np.nan)).replace([np.inf, -np.inf], np.nan)


def zscore(series: pd.Series, window: int) -> pd.Series:
    mean = series.rolling(window).mean()
    return safe_divide(series - mean, series.rolling(window).std())


def rsi(close: pd.Series, window: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / window, adjust=False).mean()
    loss = -delta.clip(upper=0).ewm(alpha=1 / window, adjust=False).mean()
    rs = safe_divide(gain, loss)
    return 100 - 100 / (1 + rs)


def price_features(ohlc: pd.DataFrame) -> pd.DataFrame:
    df = ohlc.sort_values("date").copy()
    c, h, l, o = (pd.to_numeric(df[x], errors="coerce") for x in ("close", "high", "low", "open"))
    previous = c.shift(1)
    for days in (1, 2, 3, 5, 10, 20):
        df[f"nifty_return_{days}d"] = c.pct_change(days, fill_method=None)
    df["gap_pct"] = safe_divide(o, previous) - 1
    df["intraday_return"] = safe_divide(c, o) - 1
    df["high_low_range_pct"] = safe_divide(h - l, c)
    df["close_location_value"] = safe_divide(c - l, h - l).fillna(0.5)
    for days in (5, 10, 20, 50, 100, 200):
        ma = c.rolling(days).mean()
        df[f"distance_from_{days}dma"] = safe_divide(c, ma) - 1
        if days <= 50:
            df[f"slope_{days}dma"] = ma.pct_change(5, fill_method=None)
        if days in (20, 50, 200):
            df[f"above_{days}dma"] = (c > ma).astype(float)
    df["rsi_14"] = rsi(c, 14)
    df["rsi_5"] = rsi(c, 5)
    true_range = pd.concat([(h - l), (h - previous).abs(), (l - previous).abs()], axis=1).max(axis=1)
    df["atr_14"] = true_range.rolling(14).mean()
    df["atr_pct"] = safe_divide(df["atr_14"], c)
    for days in (5, 10, 20, 60):
        df[f"realized_vol_{days}d"] = c.pct_change(fill_method=None).rolling(days).std() * np.sqrt(252)
    rolling_high = h.shift(1).rolling(20).max()
    rolling_low = l.shift(1).rolling(20).min()
    df["rolling_high_20d_distance"] = safe_divide(c, rolling_high) - 1
    df["rolling_low_20d_distance"] = safe_divide(c, rolling_low) - 1
    df["breakout_20d"] = (c > rolling_high).astype(float)
    df["breakdown_20d"] = (c < rolling_low).astype(float)
    df["target_next_day_return"] = c.shift(-1) / c - 1
    df["target_next_day_up"] = (df["target_next_day_return"] > 0).astype(float)
    df.loc[df["target_next_day_return"].isna(), "target_next_day_up"] = np.nan
    return df


def add_vix_features(features: pd.DataFrame, vix: pd.DataFrame | None) -> pd.DataFrame:
    if vix is None or vix.empty:
        return features
    vf = vix[["date", "close"]].copy().sort_values("date").rename(columns={"close": "vix_close"})
    vf["vix_return_1d"] = vf.vix_close.pct_change()
    vf["vix_return_3d"] = vf.vix_close.pct_change(3)
    vf["vix_return_5d"] = vf.vix_close.pct_change(5)
    vf["vix_zscore_20d"] = zscore(vf.vix_close, 20)
    vf["vix_zscore_60d"] = zscore(vf.vix_close, 60)
    vf["vix_percentile_252d"] = vf.vix_close.rolling(252).rank(pct=True)
    vf["vix_above_20dma"] = (vf.vix_close > vf.vix_close.rolling(20).mean()).astype(float)
    vf["vix_spike_flag"] = (vf.vix_return_1d > 0.15).astype(float)
    vf["vix_crush_flag"] = (vf.vix_return_1d < -0.12).astype(float)
    vf["expected_daily_move_365"] = vf.vix_close / 100 / np.sqrt(365)
    vf["expected_daily_move_252"] = vf.vix_close / 100 / np.sqrt(252)
    return features.merge(vf, on="date", how="left")


def add_flow_features(features: pd.DataFrame, flows: pd.DataFrame | None) -> pd.DataFrame:
    if flows is None or flows.empty:
        return features
    ff = flows.copy().sort_values("date")
    ff["fii_dii_spread"] = ff.fii_net - ff.dii_net
    ff["total_institution_net"] = ff.fii_net + ff.dii_net
    ff["fii_buy_sell_ratio"] = safe_divide(ff.fii_buy, ff.fii_sell)
    ff["dii_buy_sell_ratio"] = safe_divide(ff.dii_buy, ff.dii_sell)
    for days in (3, 5, 10):
        ff[f"fii_net_{days}d_sum"] = ff.fii_net.rolling(days).sum()
        ff[f"dii_net_{days}d_sum"] = ff.dii_net.rolling(days).sum()
    ff["fii_net_zscore_20d"] = zscore(ff.fii_net, 20)
    ff["dii_net_zscore_20d"] = zscore(ff.dii_net, 20)
    ff["institutional_absorption"] = ff.dii_net - ff.fii_net.clip(upper=0).abs()
    ff["fii_selling_absorbed_by_dii"] = ((ff.fii_net < 0) & (ff.dii_net > ff.fii_net.abs())).astype(float)
    keep = [c for c in ff.columns if c not in {"source", "available_at"}]
    return features.merge(ff[keep], on="date", how="left")


def add_calendar_features(features: pd.DataFrame) -> pd.DataFrame:
    df = features.copy()
    dates = pd.to_datetime(df.date)
    dow = dates.dt.dayofweek
    for day in range(5):
        df[f"dow_{day}"] = (dow == day).astype(float)
    df["monday_flag"] = (dow == 0).astype(float)
    df["friday_flag"] = (dow == 4).astype(float)
    # Nifty weekly expiry is Thursday, shifted by exchange holidays at runtime.
    df["weekly_expiry_flag"] = (dow == 3).astype(float)
    next_thursday = (3 - dow) % 7
    df["days_to_expiry"] = next_thursday.astype(float)
    df["day_before_expiry_flag"] = (dow == 2).astype(float)
    df["day_after_expiry_flag"] = (dow == 4).astype(float)
    df["monthly_expiry_flag"] = ((dow == 3) & (dates.dt.month != (dates + pd.Timedelta(days=7)).dt.month)).astype(float)
    return df


def add_external_features(features: pd.DataFrame, markets: dict[str, pd.DataFrame] | None) -> pd.DataFrame:
    df = features
    if not markets:
        return df
    for label, market in markets.items():
        if market.empty:
            continue
        prefix = label.lower()
        ext = market[["date", "close"]].sort_values("date").copy()
        close = pd.to_numeric(ext.pop("close"), errors="coerce")
        ext[f"{prefix}_return_1d"] = close.pct_change(fill_method=None)
        ext[f"{prefix}_return_3d"] = close.pct_change(3, fill_method=None)
        ext[f"{prefix}_return_5d"] = close.pct_change(5, fill_method=None)
        ext[f"{prefix}_volatility_10d"] = close.pct_change(fill_method=None).rolling(10).std() * np.sqrt(252)
        ext[f"{prefix}_zscore_60d"] = zscore(close, 60)
        df = df.merge(ext, on="date", how="left")
    us = [c for c in ("sp500_return_1d", "nasdaq100_return_1d", "dow_return_1d") if c in df]
    asia = [c for c in ("nikkei_return_1d", "hangseng_return_1d") if c in df]
    if us:
        df["us_market_composite_return"] = df[us].mean(axis=1)
    if asia:
        df["asia_market_composite_return"] = df[asia].mean(axis=1)
    composites = us + asia
    if composites:
        df["global_risk_on_score"] = (df[composites] > 0).mean(axis=1)
        df["global_risk_off_score"] = (df[composites] < 0).mean(axis=1)
    macro = [c for c in ("usdinr_return_1d", "dxy_return_1d", "brent_return_1d", "us10y_return_1d") if c in df]
    if macro:
        df["macro_pressure_score"] = df[macro].mean(axis=1)
    return df


def add_participant_features(features: pd.DataFrame, positioning: pd.DataFrame | None) -> pd.DataFrame:
    if positioning is None or positioning.empty:
        return features
    df = features
    for participant, rows in positioning.sort_values("date").groupby("participant"):
        prefix = str(participant).strip().lower().replace(" ", "_")
        p = rows.copy()
        p[f"{prefix}_index_fut_net"] = p.index_futures_long - p.index_futures_short
        p[f"{prefix}_index_fut_ls_ratio"] = safe_divide(p.index_futures_long, p.index_futures_short)
        p[f"{prefix}_call_net"] = p.index_call_long - p.index_call_short
        p[f"{prefix}_put_net"] = p.index_put_long - p.index_put_short
        p[f"{prefix}_put_call_position_ratio"] = safe_divide(p.index_put_long, p.index_call_long)
        p[f"{prefix}_index_fut_net_change"] = p[f"{prefix}_index_fut_net"].diff()
        keep = ["date"] + [c for c in p if c.startswith(prefix + "_")]
        df = df.merge(p[keep], on="date", how="left")
    return df


def add_options_features(features: pd.DataFrame, options: pd.DataFrame | None) -> pd.DataFrame:
    if options is None or options.empty:
        return features
    rows = []
    for day, all_expiries in options.groupby("date"):
        valid_expiries = [expiry for expiry in all_expiries.expiry if expiry >= day]
        if not valid_expiries:
            continue
        nearest_expiry = min(valid_expiries)
        chain = all_expiries[all_expiries.expiry == nearest_expiry].copy()
        calls, puts = chain.ce_oi.fillna(0).sum(), chain.pe_oi.fillna(0).sum()
        spot = float(chain.spot.iloc[0])
        atm = chain.iloc[(chain.strike - spot).abs().argsort()[:1]]
        call_wall = float(chain.loc[chain.ce_oi.fillna(0).idxmax(), "strike"])
        put_wall = float(chain.loc[chain.pe_oi.fillna(0).idxmax(), "strike"])
        rows.append({"date": day, "nearest_expiry_days": (nearest_expiry - day).days,
                     "atm_strike": float(atm.strike.iloc[0]), "atm_avg_iv": float(atm[["ce_iv", "pe_iv"]].mean(axis=1).iloc[0]),
                     "total_call_oi": float(calls), "total_put_oi": float(puts), "pcr_oi": float(puts / calls) if calls else np.nan,
                     "call_wall_strike": call_wall, "put_wall_strike": put_wall,
                     "distance_to_call_wall_pct": call_wall / spot - 1, "distance_to_put_wall_pct": put_wall / spot - 1,
                     "straddle_price_atm": float(atm[["ce_ltp", "pe_ltp"]].sum(axis=1).iloc[0]),
                     "iv_skew": float(atm.pe_iv.iloc[0] - atm.ce_iv.iloc[0])})
    return features.merge(pd.DataFrame(rows), on="date", how="left")


def add_breadth_features(features: pd.DataFrame, breadth: pd.DataFrame | None) -> pd.DataFrame:
    if breadth is None or breadth.empty:
        return features
    bf = breadth.copy().sort_values("date")
    bf["advance_decline_ratio"] = safe_divide(bf.advances, bf.declines)
    bf["breadth_zscore_20d"] = zscore(bf["advance_decline_ratio"], 20)
    bf["breadth_thrust_flag"] = (bf.advance_decline_ratio > 2).astype(float)
    bf["breadth_weakness_flag"] = (bf.advance_decline_ratio < .5).astype(float)
    return features.merge(bf.drop(columns=[c for c in ("source", "available_at") if c in bf]), on="date", how="left")


def build_feature_frame(ohlc: pd.DataFrame, vix: pd.DataFrame | None = None, flows: pd.DataFrame | None = None,
                        markets: dict[str, pd.DataFrame] | None = None, positioning: pd.DataFrame | None = None,
                        options: pd.DataFrame | None = None, breadth: pd.DataFrame | None = None) -> pd.DataFrame:
    core = add_calendar_features(add_flow_features(add_vix_features(price_features(ohlc), vix), flows))
    core = add_external_features(core, markets)
    core = add_participant_features(core, positioning)
    core = add_options_features(core, options)
    return add_breadth_features(core, breadth)


def classify_regime(row: pd.Series) -> str:
    trend = row.get("distance_from_50dma", 0) or 0
    vol = row.get("realized_vol_20d", 0.15) or 0.15
    if row.get("weekly_expiry_flag", 0) and row.get("days_to_expiry", 1) == 0:
        return "Expiry-Dominated"
    if trend > 0.02:
        return "Bullish High Volatility" if vol > 0.18 else "Bullish Low Volatility"
    if trend < -0.02:
        return "Bearish High Volatility" if vol > 0.18 else "Bearish Low Volatility"
    return "Sideways High Volatility" if vol > 0.18 else "Sideways Low Volatility"
