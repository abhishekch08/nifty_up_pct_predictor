from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from math import erf, sqrt
from pathlib import Path
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import make_column_selector
from sklearn.ensemble import HistGradientBoostingRegressor, VotingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, brier_score_loss,
                             f1_score, log_loss, mean_absolute_error, mean_squared_error,
                             precision_score, recall_score, roc_auc_score)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler

TARGETS = {"target_next_day_up", "target_next_day_return"}
NON_FEATURES = {"date", "symbol", "source", "available_at", "open", "high", "low", "close", "volume", "prev_close"}
MIN_TRADABLE_RETURN_EDGE = 0.0020
WEAK_TRADABLE_RETURN_EDGE = 0.0040
STRONG_TRADABLE_RETURN_EDGE = 0.0075
MIN_PROBABILITY_EDGE = 0.025


def feature_columns(frame: pd.DataFrame) -> list[str]:
    # A feature must have enough historical observations to be estimable. This
    # keeps a newly available one-day official feed visible in the dashboard
    # without pretending it had existed throughout the walk-forward backtest.
    minimum_history = max(20, int(len(frame) * 0.05))
    return [c for c in frame.columns if c not in TARGETS | NON_FEATURES
            and pd.api.types.is_numeric_dtype(frame[c]) and frame[c].notna().sum() >= minimum_history]


def classifier() -> Pipeline:
    base = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", RobustScaler()),
        ("model", LogisticRegression(C=0.25, class_weight="balanced", max_iter=2000, solver="liblinear")),
    ])
    return Pipeline([("calibrated", CalibratedClassifierCV(base, method="sigmoid", cv=3))])


def regressor() -> VotingRegressor:
    ridge = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", RobustScaler()),
        ("model", Ridge(alpha=5.0)),
    ])
    nonlinear = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", RobustScaler()),
        ("model", HistGradientBoostingRegressor(max_iter=180, learning_rate=0.04, max_leaf_nodes=15,
                                                l2_regularization=0.12, random_state=42)),
    ])
    return VotingRegressor([("ridge", ridge), ("nonlinear", nonlinear)], weights=[0.65, 0.35])


@dataclass
class WalkForwardResult:
    predictions: pd.DataFrame
    metrics: dict
    calibration: list[dict]
    threshold_analysis: list[dict]


def walk_forward(frame: pd.DataFrame, min_train: int = 756, test_size: int = 63, cost_bps: float = 3.0) -> WalkForwardResult:
    clean = frame.dropna(subset=["target_next_day_up", "target_next_day_return"]).reset_index(drop=True)
    cols = feature_columns(clean)
    if len(clean) < min_train + test_size:
        raise ValueError(f"Need at least {min_train + test_size} complete rows; received {len(clean)}")
    outputs: list[pd.DataFrame] = []
    for start in range(min_train, len(clean), test_size):
        train, test = clean.iloc[:start], clean.iloc[start:min(start + test_size, len(clean))]
        if len(test) == 0:
            break
        clf, reg = classifier(), regressor()
        clf.fit(train[cols], train.target_next_day_up.astype(int))
        reg.fit(train[cols], train.target_next_day_return)
        return_bias = _return_bias(reg, train, cols)
        fold = test[["date", "target_next_day_up", "target_next_day_return"]].copy()
        fold["probability_up"] = clf.predict_proba(test[cols])[:, 1]
        fold["expected_return"] = reg.predict(test[cols]) + return_bias
        outputs.append(fold)
    pred = pd.concat(outputs, ignore_index=True)
    y = pred.target_next_day_up.astype(int)
    label = (pred.probability_up >= 0.5).astype(int)
    metrics = {
        "accuracy": accuracy_score(y, label),
        "balanced_accuracy": balanced_accuracy_score(y, label),
        "precision": precision_score(y, label, zero_division=0),
        "recall": recall_score(y, label, zero_division=0),
        "f1": f1_score(y, label, zero_division=0),
        "roc_auc": roc_auc_score(y, pred.probability_up),
        "brier_score": brier_score_loss(y, pred.probability_up),
        "log_loss": log_loss(y, pred.probability_up),
        "mae_return": mean_absolute_error(pred.target_next_day_return, pred.expected_return),
        "rmse_return": mean_squared_error(pred.target_next_day_return, pred.expected_return) ** 0.5,
        "samples": len(pred),
    }
    for window in (20, 60, 126):
        tail = pred.tail(min(window, len(pred)))
        if len(tail):
            errors = tail.target_next_day_return - tail.expected_return
            signed = np.sign(tail.expected_return) == np.sign(tail.target_next_day_return)
            active = tail.expected_return.abs() >= MIN_TRADABLE_RETURN_EDGE
            metrics[f"recent_mae_return_{window}"] = float(np.abs(errors).mean())
            metrics[f"recent_rmse_return_{window}"] = float((errors.pow(2).mean()) ** 0.5)
            metrics[f"recent_direction_hit_{window}"] = float(signed.mean())
            metrics[f"recent_tradeable_direction_hit_{window}"] = float(signed[active].mean()) if bool(active.any()) else 0.0
            metrics[f"recent_no_edge_rate_{window}"] = float((tail.expected_return.abs() < MIN_TRADABLE_RETURN_EDGE).mean())
    bins = pd.cut(pred.probability_up, bins=np.linspace(0, 1, 11), include_lowest=True)
    calibration = []
    for bucket, group in pred.groupby(bins, observed=True):
        calibration.append({"bucket": str(bucket), "predicted": float(group.probability_up.mean()),
                            "actual": float(group.target_next_day_up.mean()), "count": int(len(group))})
    thresholds = []
    for threshold in (0.4, 0.45, 0.5, 0.55, 0.6):
        direction = np.where(pred.probability_up >= threshold, 1, np.where(pred.probability_up <= 1 - threshold, -1, 0))
        strategy = direction * pred.target_next_day_return - (direction != 0) * cost_bps / 10_000
        active = direction != 0
        thresholds.append({"threshold": threshold, "trades": int(active.sum()),
                           "hit_rate": float((np.sign(strategy[active]) > 0).mean()) if active.any() else 0,
                           "total_return": float((1 + strategy).prod() - 1)})
    return WalkForwardResult(pred, {k: float(v) if isinstance(v, (np.floating, float)) else v for k, v in metrics.items()}, calibration, thresholds)


def train_final(frame: pd.DataFrame, artifact_dir: str) -> tuple[str, dict, dict]:
    clean = frame.dropna(subset=["target_next_day_up", "target_next_day_return"]).copy()
    cols = feature_columns(clean)
    clf, reg = classifier(), regressor()
    clf.fit(clean[cols], clean.target_next_day_up.astype(int))
    reg.fit(clean[cols], clean.target_next_day_return)
    return_bias = _return_bias(reg, clean, cols)
    fitted = np.asarray(reg.predict(clean[cols]), dtype=float) + return_bias
    residual = np.asarray(clean.target_next_day_return, dtype=float) - fitted
    residual = residual[np.isfinite(residual)]
    residual_quantiles = {
        f"q{int(q * 100):02d}": float(np.quantile(residual, q)) if len(residual) else 0.0
        for q in (0.05, 0.25, 0.50, 0.75, 0.95)
    }
    version = "v" + datetime.now(timezone.utc).strftime("%Y.%m.%d.%H%M%S")
    artifact = {"classifier": clf, "regressor": reg, "features": cols, "trained_until": str(clean.date.iloc[-1]),
                "return_bias": return_bias, "residual_quantiles": residual_quantiles}
    path = Path(artifact_dir) / f"{version}.joblib"
    joblib.dump(artifact, path)
    meta = {"algorithm": "calibrated_logistic_plus_ridge_hgb_residual_bias_quantile_diagnostics",
            "feature_count": len(cols), "artifact_path": str(path), "return_bias": return_bias,
            "residual_quantiles": residual_quantiles}
    return version, artifact, meta


def predict_returns(artifact: dict, frame: pd.DataFrame) -> np.ndarray:
    return np.asarray(artifact["regressor"].predict(frame[artifact["features"]]), dtype=float) + float(artifact.get("return_bias", 0.0))


def _return_bias(reg, frame: pd.DataFrame, cols: list[str], window: int = 126) -> float:
    tail = frame.dropna(subset=["target_next_day_return"]).tail(window)
    if len(tail) < 20:
        return 0.0
    residual = np.asarray(tail.target_next_day_return, dtype=float) - np.asarray(reg.predict(tail[cols]), dtype=float)
    if not np.isfinite(residual).any():
        return 0.0
    return float(np.clip(np.nanmedian(residual), -0.004, 0.004))


def load_model(path: str) -> dict:
    from .config import get_settings

    normalized = Path(path.replace("\\", "/"))
    candidates = [Path(path), normalized]
    if not normalized.is_absolute():
        candidates.append(Path(get_settings().model_artifact_dir) / normalized.name)
    for candidate in candidates:
        if candidate.exists():
            return joblib.load(candidate)
    tried = ", ".join(str(candidate) for candidate in candidates)
    raise FileNotFoundError(f"Model artifact not found. Tried: {tried}")


def signal_label(probability: float, expected_return: float, cost_bps: float = 3.0) -> str:
    if abs(expected_return) < MIN_TRADABLE_RETURN_EDGE and 0.4 < probability < 0.6:
        return "Neutral / No Edge"
    if probability < 0.4:
        return "Strong Bearish"
    if probability < 0.475:
        return "Mild Bearish"
    if probability <= 0.525:
        return "Neutral / No Edge"
    if probability < 0.6:
        return "Mild Bullish"
    return "Strong Bullish"


def edge_diagnostics(probability: float, expected_return: float, metrics: dict | None = None,
                     completeness: float = 1.0, data_quality: str | None = None) -> dict:
    """Separate a forecast from a tradeable edge.

    The model can still publish a directional probability every day, but the
    trading layer only allows direction when the expected move survives recent
    error, probability and data-completeness gates.
    """
    metrics = metrics or {}
    recent_error = float(metrics.get("recent_mae_return_20") or metrics.get("recent_mae_return_60")
                         or metrics.get("mae_return") or 0.006)
    recent_error = max(recent_error, 0.0008)
    return_edge = abs(float(expected_return))
    probability_edge = abs(float(probability) - 0.5)
    signal_strength = return_edge / recent_error
    expected_sign = 1 if expected_return > MIN_TRADABLE_RETURN_EDGE else -1 if expected_return < -MIN_TRADABLE_RETURN_EDGE else 0
    probability_sign = 1 if probability > 0.5 + MIN_PROBABILITY_EDGE else -1 if probability < 0.5 - MIN_PROBABILITY_EDGE else 0
    disagreement = expected_sign != 0 and probability_sign != 0 and expected_sign != probability_sign
    reasons: list[str] = []
    if return_edge < MIN_TRADABLE_RETURN_EDGE:
        reasons.append("Expected return is below the minimum tradable edge.")
    if probability_edge < MIN_PROBABILITY_EDGE:
        reasons.append("Up/down probability is too close to 50/50.")
    if signal_strength < 0.35:
        reasons.append("Expected move is small versus recent model error.")
    if completeness < 0.75:
        reasons.append("Feature completeness is below the safe trading threshold.")
    if disagreement:
        reasons.append("Direction and magnitude models disagree.")

    if completeness < 0.55 or str(data_quality or "").lower() == "unsafe":
        edge_label, trade_action, position_size = "Unsafe / No Trade", "No Trade", 0.0
    elif disagreement:
        edge_label, trade_action, position_size = "Model Disagreement", "No Trade", 0.0
    elif return_edge < MIN_TRADABLE_RETURN_EDGE or probability_edge < MIN_PROBABILITY_EDGE or signal_strength < 0.35:
        edge_label, trade_action, position_size = "No Edge", "No Trade", 0.0
    elif return_edge < WEAK_TRADABLE_RETURN_EDGE or signal_strength < 0.75:
        edge_label, trade_action, position_size = "Weak Edge", "Neutral Only", 0.25
    elif return_edge < STRONG_TRADABLE_RETURN_EDGE or signal_strength < 1.25:
        edge_label, trade_action, position_size = "Tradable Edge", "Directional Allowed", 0.50
    else:
        edge_label, trade_action, position_size = "Strong Edge", "Directional Allowed", 1.00

    if trade_action == "Directional Allowed":
        bias = "Bullish" if expected_return > 0 and probability >= 0.5 else "Bearish" if expected_return < 0 and probability <= 0.5 else "Neutral"
    elif trade_action == "Neutral Only":
        bias = "Neutral"
    else:
        bias = "No Trade"
    if not reasons:
        reasons.append("Forecast edge survives minimum return, probability and recent-error gates.")
    edge_score = float(np.clip(0.45 * min(signal_strength, 2.0) / 2.0 + 0.35 * min(probability_edge / 0.15, 1.0)
                               + 0.20 * max(min((completeness - 0.55) / 0.45, 1.0), 0.0), 0.0, 1.0))
    return {
        "edge_label": edge_label,
        "trade_action": trade_action,
        "directional_bias": bias,
        "signal_strength": float(signal_strength),
        "recent_error": float(recent_error),
        "return_edge": float(return_edge),
        "probability_edge": float(probability_edge),
        "edge_score": edge_score,
        "position_size": position_size,
        "tradeable": trade_action == "Directional Allowed",
        "neutral_only": trade_action == "Neutral Only",
        "no_trade": trade_action == "No Trade",
        "reasons": reasons,
    }


def forecast_distribution(expected_return: float, sigma: float, metrics: dict | None = None,
                          residual_quantiles: dict | None = None) -> dict:
    metrics = metrics or {}
    residual_quantiles = residual_quantiles or {}
    empirical_error = float(metrics.get("recent_mae_return_20") or metrics.get("mae_return") or 0.006)
    scale = max(float(sigma) * 0.65, empirical_error, 0.0015)
    z_scores = {"q05": -1.64485, "q25": -0.67449, "q50": 0.0, "q75": 0.67449, "q95": 1.64485}
    quantiles = {}
    for key, score in z_scores.items():
        quantiles[key] = float(expected_return + residual_quantiles.get(key, score * scale))
    p_up = 1 - _normal_cdf((0 - expected_return) / scale)
    return {
        "median": float(quantiles["q50"]),
        "q05": quantiles["q05"],
        "q25": quantiles["q25"],
        "q50": quantiles["q50"],
        "q75": quantiles["q75"],
        "q95": quantiles["q95"],
        "p_up": float(p_up),
        "p_large_up_50bps": float(1 - _normal_cdf((0.005 - expected_return) / scale)),
        "p_large_down_50bps": float(_normal_cdf((-0.005 - expected_return) / scale)),
        "p_tail_1pct": float(_normal_cdf((-0.01 - expected_return) / scale) + 1 - _normal_cdf((0.01 - expected_return) / scale)),
        "scale": float(scale),
        "note": "Empirical residual/volatility distribution for decision gating, not a guaranteed tight price band.",
    }


def _normal_cdf(value: float) -> float:
    return 0.5 * (1 + erf(value / sqrt(2)))


def explain_linear(artifact: dict, row: pd.DataFrame, top_n: int = 4) -> tuple[list[dict], list[dict]]:
    """Stable directional explanations using standardized one-feature perturbations."""
    cols = artifact["features"]
    base = float(artifact["classifier"].predict_proba(row[cols])[:, 1][0])
    effects = []
    for col in cols:
        changed = row[cols].copy()
        changed[col] = np.nan
        perturbed = float(artifact["classifier"].predict_proba(changed)[:, 1][0])
        effects.append({"feature": col, "value": _json_number(row[col].iloc[0]), "impact": base - perturbed,
                        "interpretation": col.replace("_", " ").capitalize()})
    effects.sort(key=lambda item: item["impact"])
    return list(reversed(effects[-top_n:])), effects[:top_n]


def _json_number(value):
    return None if pd.isna(value) else float(value)
