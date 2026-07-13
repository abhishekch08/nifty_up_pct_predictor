from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from math import exp, isfinite, log1p, sqrt
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from .data_sources import SYMBOLS
from .models import MarketDaily, OptionEOD, Prediction
from .services import serialize_prediction

LOT_SIZE = 75


@dataclass(frozen=True)
class Leg:
    action: str
    option_type: str
    strike: float
    price: float


def strategy_report(db: Session, expiry: date | None = None) -> dict:
    prediction = db.scalar(select(Prediction).order_by(Prediction.created_at.desc()))
    if not prediction:
        return {"status": "unavailable", "warning": "No prediction available. Run the pipeline first."}
    latest_date = db.scalar(select(OptionEOD.date).order_by(OptionEOD.date.desc()))
    if not latest_date:
        return {"status": "unavailable", "warning": "No options EOD chain available. Fetch data or upload options CSV first."}
    rows = db.scalars(select(OptionEOD).where(OptionEOD.date == latest_date).order_by(OptionEOD.expiry, OptionEOD.strike)).all()
    expiry_options = _expiry_options(rows, prediction.date)
    chain = _nearest_expiry_chain(rows, prediction.date, expiry)
    if len(chain) < 4:
        return {"status": "unavailable", "warning": "Not enough option strikes to rank defined-risk strategies."}

    candidates = _rank_candidates(prediction, chain)
    selected = candidates[0] if candidates else None
    return {
        "status": "complete" if selected else "unavailable",
        "disclaimer": "Research output only. All listed option structures have capped maximum loss, but live execution, slippage, tax, brokerage and margin can differ.",
        "prediction": serialize_prediction(prediction),
        "spot": prediction.nifty_close,
        "date": prediction.date.isoformat(),
        "next_trading_day": prediction.next_trading_day.isoformat(),
        "expiry": chain[0]["expiry"].isoformat(),
        "expiries": expiry_options,
        "lot_size": LOT_SIZE,
        "selected": selected,
        "candidates": candidates[:8],
        "option_chain": _option_chain_payload(chain),
        "oi_bars": _oi_bars(chain),
        "payoff_points": _payoff_points(selected, prediction) if selected else [],
        "history": strategy_history(db, limit=14),
    }


def strategy_history(db: Session, limit: int = 14) -> list[dict]:
    rows = db.scalars(select(Prediction).order_by(Prediction.date.desc()).limit(limit * 3)).all()
    output = []
    for row in rows:
        next_close = db.scalar(select(MarketDaily.close).where(
            MarketDaily.symbol == SYMBOLS["NIFTY"], MarketDaily.date == row.next_trading_day))
        if next_close is None:
            continue
        output.append(_historical_proxy_result(row, float(next_close)))
        if len(output) >= limit:
            break
    return output


def _expiry_options(rows: list[OptionEOD], prediction_date) -> list[dict]:
    valid_expiries = sorted({row.expiry for row in rows if row.expiry >= prediction_date})
    if not valid_expiries:
        valid_expiries = sorted({row.expiry for row in rows})
    options = []
    for item in valid_expiries:
        days = max((item - prediction_date).days, 0)
        suffix = "Day" if days == 1 else "Days"
        options.append({"expiry": item.isoformat(), "label": f"{item:%d %b} ({days} {suffix})", "days": days})
    return options


def _nearest_expiry_chain(rows: list[OptionEOD], prediction_date, selected_expiry: date | None = None) -> list[dict]:
    valid_expiries = sorted({row.expiry for row in rows if row.expiry >= prediction_date})
    if not valid_expiries:
        valid_expiries = sorted({row.expiry for row in rows})
    expiry = selected_expiry if selected_expiry in valid_expiries else valid_expiries[0]
    chain = []
    for row in rows:
        if row.expiry != expiry:
            continue
        ce = float(row.ce_ltp or 0)
        pe = float(row.pe_ltp or 0)
        if ce <= 0 and pe <= 0:
            continue
        chain.append({
            "date": row.date,
            "expiry": row.expiry,
            "strike": float(row.strike),
            "spot": float(row.spot),
            "ce_ltp": ce,
            "pe_ltp": pe,
            "ce_oi": float(row.ce_oi or 0),
            "pe_oi": float(row.pe_oi or 0),
        })
    return sorted(chain, key=lambda item: item["strike"])


def _option_chain_payload(chain: list[dict]) -> list[dict]:
    return [{
        "expiry": item["expiry"].isoformat(),
        "strike": item["strike"],
        "ce_ltp": item["ce_ltp"],
        "pe_ltp": item["pe_ltp"],
        "ce_oi": item["ce_oi"],
        "pe_oi": item["pe_oi"],
        "spot": item["spot"],
    } for item in chain]


def _oi_bars(chain: list[dict]) -> list[dict]:
    return [{
        "strike": item["strike"],
        "call_oi": item["ce_oi"],
        "put_oi": item["pe_oi"],
        "call_oi_lakh": item["ce_oi"] / 100000,
        "put_oi_lakh": item["pe_oi"] / 100000,
    } for item in chain if item["ce_oi"] or item["pe_oi"]]


def _rank_candidates(prediction: Prediction, chain: list[dict]) -> list[dict]:
    strikes = [item["strike"] for item in chain]
    spot = float(prediction.nifty_close)
    atm = min(strikes, key=lambda strike: abs(strike - spot))
    step = _strike_step(strikes)
    upper = _nearest(strikes, max(prediction.expected_upper_range, atm + 2 * step))
    lower = _nearest(strikes, min(prediction.expected_lower_range, atm - 2 * step))
    wider_upper = _nearest(strikes, upper + 2 * step)
    wider_lower = _nearest(strikes, lower - 2 * step)
    one_up = _nearest(strikes, atm + 2 * step)
    one_down = _nearest(strikes, atm - 2 * step)

    def leg(action: str, option_type: str, strike: float) -> Leg:
        item = _row(chain, strike)
        return Leg(action, option_type, strike, item["ce_ltp"] if option_type == "CE" else item["pe_ltp"])

    raw = [
        ("Bull Call Spread", "Bullish", [leg("BUY", "CE", atm), leg("SELL", "CE", upper)],
         "Debit spread aligned with upside probability; max loss is the premium paid and max profit is capped at the upper strike."),
        ("Bull Put Spread", "Bullish", [leg("SELL", "PE", one_down), leg("BUY", "PE", wider_lower)],
         "Credit spread that benefits if Nifty holds above the short put; downside is capped by the bought lower put."),
        ("Bear Put Spread", "Bearish", [leg("BUY", "PE", atm), leg("SELL", "PE", lower)],
         "Debit spread aligned with downside probability; max loss is premium paid and max profit is capped at the lower strike."),
        ("Bear Call Spread", "Bearish", [leg("SELL", "CE", one_up), leg("BUY", "CE", wider_upper)],
         "Credit spread that benefits if Nifty remains below the short call; upside risk is capped by the bought higher call."),
        ("Iron Condor", "Neutral", [leg("BUY", "PE", wider_lower), leg("SELL", "PE", lower), leg("SELL", "CE", upper), leg("BUY", "CE", wider_upper)],
         "Defined-risk range strategy; profits if Nifty expires between the short put and short call."),
        ("Iron Butterfly", "Neutral", [leg("SELL", "PE", atm), leg("SELL", "CE", atm), leg("BUY", "PE", lower), leg("BUY", "CE", upper)],
         "Defined-risk short-volatility strategy centered at ATM; highest payoff if Nifty pins near the center strike."),
        ("Long Straddle", "Volatility", [leg("BUY", "CE", atm), leg("BUY", "PE", atm)],
         "Capped-loss long-volatility strategy; loses only the premium paid but needs a large move either way to profit."),
        ("Long Strangle", "Volatility", [leg("BUY", "PE", lower), leg("BUY", "CE", upper)],
         "Cheaper capped-loss long-volatility strategy than a straddle; needs a larger move beyond the wings to profit."),
    ]
    evaluated = [_evaluate(name, family, legs, prediction, chain, rationale) for name, family, legs, rationale in raw]
    evaluated = [item for item in evaluated if item["max_loss"] and item["max_loss"] > 0 and item["unlimited_loss"] is False]
    evaluated.sort(key=lambda item: item["score"], reverse=True)
    return evaluated


def _evaluate(name: str, family: str, legs: list[Leg], prediction: Prediction, chain: list[dict], rationale: str) -> dict:
    spot = float(prediction.nifty_close)
    sigma = _forecast_sigma(prediction)
    grid = np.linspace(max(1, spot * (1 - 4 * sigma)), spot * (1 + 4 * sigma), 241)
    weights = np.array([_normal_pdf(x, spot * (1 + prediction.expected_return), spot * sigma) for x in grid])
    weights = weights / weights.sum() if weights.sum() else np.ones_like(weights) / len(weights)
    payoffs = np.array([_strategy_payoff(legs, x) * LOT_SIZE for x in grid])
    max_loss = abs(float(min(payoffs)))
    max_profit = float(max(payoffs))
    expected_profit = float((payoffs * weights).sum())
    pop = float(weights[payoffs > 0].sum())
    breakevens = _breakevens(grid, payoffs)
    rr = max_profit / max_loss if max_loss > 0 and isfinite(max_profit) else None
    directional_alignment = _alignment_bonus(family, prediction)
    reward_quality = log1p(rr or 0)
    payoff_capacity = max_profit / (max_profit + max_loss) if max_profit > 0 and max_loss > 0 else 0
    score = (
        (expected_profit / max_loss if max_loss else -99)
        + 0.30 * pop
        + 0.18 * reward_quality
        + 0.08 * payoff_capacity
        + directional_alignment
    )
    credit = sum((leg.price if leg.action == "SELL" else -leg.price) for leg in legs) * LOT_SIZE
    return {
        "name": name,
        "family": family,
        "legs": [_leg_dict(leg, chain[0]["expiry"]) for leg in legs],
        "premium": credit,
        "premium_label": "Credit received" if credit > 0 else "Debit paid",
        "max_profit": max_profit,
        "max_loss": max_loss,
        "risk_reward": rr,
        "expected_profit": expected_profit,
        "probability_profit": pop,
        "breakevens": breakevens,
        "score": score,
        "unlimited_loss": False,
        "rationale": rationale,
        "interpretation": _interpretation(name, prediction, expected_profit, pop, rr),
    }


def _payoff_points(strategy: dict | None, prediction: Prediction) -> list[dict]:
    if not strategy:
        return []
    spot = float(prediction.nifty_close)
    sigma = _forecast_sigma(prediction)
    legs = [Leg(item["action"], item["type"], float(item["strike"]), float(item["price"])) for item in strategy["legs"]]
    xs = np.linspace(max(1, spot * (1 - 3 * sigma)), spot * (1 + 3 * sigma), 101)
    return [{
        "spot": float(x),
        "expiry_pl": float(_strategy_payoff(legs, x) * LOT_SIZE),
        "target_pl": float((_strategy_payoff(legs, x) * LOT_SIZE) * 0.65),
        "expected_lower": prediction.expected_lower_range,
        "expected_upper": prediction.expected_upper_range,
        "current_spot": spot,
    } for x in xs]


def _historical_proxy_result(row: Prediction, next_close: float) -> dict:
    close = float(row.nifty_close)
    width = max(100.0, round(close * 0.008 / 50) * 50)
    strategy = "Iron Condor"
    if row.probability_up >= 0.60:
        strategy = "Bull Call Spread"
    elif row.probability_up >= 0.525:
        strategy = "Bull Put Spread"
    elif row.probability_up <= 0.40:
        strategy = "Bear Put Spread"
    elif row.probability_up <= 0.475:
        strategy = "Bear Call Spread"
    result = _proxy_payoff(strategy, close, next_close, width) * LOT_SIZE
    return {
        "date": row.date.isoformat(),
        "next_trading_day": row.next_trading_day.isoformat(),
        "strategy": strategy,
        "probability_up": row.probability_up,
        "entry_close": close,
        "exit_close": next_close,
        "nifty_return": next_close / close - 1,
        "estimated_pl": result,
        "outcome": "Win" if result > 0 else "Loss" if result < 0 else "Flat",
        "method": "Replay proxy using realized next-day Nifty close; exact historical option premiums are used only when available in stored option-chain data.",
    }


def _proxy_payoff(strategy: str, entry: float, exit_: float, width: float) -> float:
    center = round(entry / 50) * 50
    debit = 0.38 * width
    credit = 0.28 * width
    if strategy == "Bull Call Spread":
        return min(max(exit_ - center, 0), width) - debit
    if strategy == "Bear Put Spread":
        return min(max(center - exit_, 0), width) - debit
    if strategy == "Bull Put Spread":
        short, long = center - width, center - 2 * width
        return credit - min(max(short - exit_, 0), short - long)
    if strategy == "Bear Call Spread":
        short, long = center + width, center + 2 * width
        return credit - min(max(exit_ - short, 0), long - short)
    lower, upper = center - width, center + width
    return 0.32 * width - max(max(lower - exit_, 0), max(exit_ - upper, 0))


def _strategy_payoff(legs: list[Leg], spot: float) -> float:
    total = 0.0
    for leg in legs:
        intrinsic = max(spot - leg.strike, 0) if leg.option_type == "CE" else max(leg.strike - spot, 0)
        total += (intrinsic - leg.price) if leg.action == "BUY" else (leg.price - intrinsic)
    return total


def _normal_pdf(x: float, mean: float, sd: float) -> float:
    sd = max(sd, 1e-6)
    return exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * sqrt(2 * np.pi))


def _forecast_sigma(prediction: Prediction) -> float:
    close = float(prediction.nifty_close)
    range_move = abs(prediction.expected_upper_range - prediction.expected_lower_range) / (2 * close) if close else 0.012
    vix_move = (prediction.india_vix or 14) / 100 / sqrt(365)
    return max(range_move, vix_move, 0.006)


def _breakevens(grid: np.ndarray, payoffs: np.ndarray) -> list[float]:
    levels = []
    for left_x, right_x, left_y, right_y in zip(grid[:-1], grid[1:], payoffs[:-1], payoffs[1:]):
        if left_y == 0:
            levels.append(float(left_x))
        elif left_y * right_y < 0:
            levels.append(float(left_x + (0 - left_y) * (right_x - left_x) / (right_y - left_y)))
    return [round(x, 2) for x in levels[:4]]


def _alignment_bonus(family: str, prediction: Prediction) -> float:
    probability_up = prediction.probability_up
    expected_return = prediction.expected_return
    abs_move = abs(expected_return)
    small_move = abs_move < 0.0025
    if family == "Bullish":
        return max(0, probability_up - 0.50) + (0.12 if expected_return > 0.0015 else -0.18 if expected_return < -0.0015 else 0)
    if family == "Bearish":
        return max(0, 0.50 - probability_up) + (0.12 if expected_return < -0.0015 else -0.18 if expected_return > 0.0015 else 0)
    if family == "Neutral":
        return max(0, 0.12 - abs(probability_up - 0.50)) + (0.10 if small_move else -0.05)
    return -0.15 if small_move else max(0, abs(probability_up - 0.50) - 0.08)


def _interpretation(name: str, prediction: Prediction, ev: float, pop: float, rr: float | None) -> str:
    direction = "bullish" if prediction.probability_up > 0.55 else "bearish" if prediction.probability_up < 0.45 else "range-bound"
    rr_text = f"{rr:.2f}x reward/risk" if rr else "open-ended reward on the displayed range"
    return f"Selected/ranked for a {direction} model backdrop, expected P/L of {ev:,.0f} per lot, {pop:.1%} probability of profit, and {rr_text} with capped loss."


def _leg_dict(leg: Leg, expiry) -> dict:
    return {"action": leg.action, "type": leg.option_type, "strike": leg.strike,
            "price": leg.price, "expiry": expiry.isoformat(), "lots": 1}


def _row(chain: list[dict], strike: float) -> dict:
    return min(chain, key=lambda item: abs(item["strike"] - strike))


def _nearest(strikes: list[float], value: float) -> float:
    return min(strikes, key=lambda strike: abs(strike - value))


def _strike_step(strikes: list[float]) -> float:
    diffs = [b - a for a, b in zip(strikes[:-1], strikes[1:]) if b > a]
    return float(min(diffs) if diffs else 50)
