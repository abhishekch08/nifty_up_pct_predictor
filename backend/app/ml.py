from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import make_column_selector
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, brier_score_loss,
                             f1_score, log_loss, mean_absolute_error, mean_squared_error,
                             precision_score, recall_score, roc_auc_score)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler

TARGETS = {"target_next_day_up", "target_next_day_return"}
NON_FEATURES = {"date", "symbol", "source", "available_at", "open", "high", "low", "close", "volume", "prev_close"}


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


def regressor() -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", RobustScaler()),
        ("model", Ridge(alpha=8.0)),
    ])


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
        fold = test[["date", "target_next_day_up", "target_next_day_return"]].copy()
        fold["probability_up"] = clf.predict_proba(test[cols])[:, 1]
        fold["expected_return"] = reg.predict(test[cols])
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
    version = "v" + datetime.now(timezone.utc).strftime("%Y.%m.%d.%H%M%S")
    artifact = {"classifier": clf, "regressor": reg, "features": cols, "trained_until": str(clean.date.iloc[-1])}
    path = Path(artifact_dir) / f"{version}.joblib"
    joblib.dump(artifact, path)
    meta = {"algorithm": "calibrated_logistic_plus_ridge", "feature_count": len(cols), "artifact_path": str(path)}
    return version, artifact, meta


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
    if expected_return <= cost_bps / 10_000 and 0.4 < probability < 0.6:
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
