# Backtesting

The primary evaluator uses an expanding training window and fixed out-of-sample blocks. The default starts with roughly three trading years (756 rows) and advances in 63-session blocks. Every fold trains fresh classifier, calibrator, imputer, scaler, and return regressor.

Reported classification metrics include accuracy, balanced accuracy, precision, recall, F1, ROC-AUC, Brier score and log loss. Regression metrics include MAE and RMSE. Calibration output reports mean prediction, actual frequency, and sample count per decile.

Threshold analysis evaluates symmetric abstention policies around probabilities 40%, 45%, 50%, 55%, and 60%. The displayed signal equity curve takes long above 55%, short below 45%, and no position otherwise, deducting 3 basis points per active day.

The backtest is a research diagnostic, not a brokerage simulation. Before capital use, add instrument-specific spreads, slippage, futures rollover, tax, margin, holiday, opening-gap execution, and limit/auction rules. Compare performance by calendar year, volatility regime, and probability bucket; do not promote a result concentrated in one regime.

