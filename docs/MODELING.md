# Modeling

## Target and decision time

For feature date T, `target_next_day_up` equals one when Nifty close T+1 exceeds close T. `target_next_day_return` is `close(T+1) / close(T) - 1`. The prediction cutoff is after all admitted T EOD datasets and before the T+1 Indian open.

## Features

Version `v1` includes lagged returns, overnight gap, intraday return, high/low range, close location, moving-average distance/slope, RSI, ATR, realized volatility, rolling breakout distance, VIX returns/z-scores/percentiles/implied moves, FII/DII rolling flows and absorption, and weekday/expiry calendar context.

Missing datasets remain missing. Median imputation plus missingness indicators are fitted on each training fold, so absence can be modeled without pretending that a missing flow equals zero.

## Models

- Direction: L2 logistic regression with robust scaling, class balancing, and Platt-sigmoid calibration.
- Expected return: Ridge regression with robust scaling.
- Probability explanations: prediction change when one input is replaced by the training imputer's missing path.
- Regime: transparent trend/realized-volatility/expiry rule set.

The deliberately modest baseline is easier to audit and calibrate than a highly flexible learner on a small daily sample. Tree/boosting candidates can be added to the same registry only after time-series-safe tuning.

## Leakage controls

- The target is shifted backward exactly once and never included in feature columns.
- The last row has no target and is used only for live inference.
- Imputers, scalers, calibration and models are fitted inside each expanding training window.
- No random train/test split is used for primary reporting.
- Source observations carry `available_at` and can be rejected against a prediction cutoff.
- Rolling highs/lows are shifted before breakout flags, preventing the current bar from defining its own prior resistance.

## Promotion

A candidate is eligible when it beats the majority-class baseline, its Brier score is below 0.25, and it contains at least 252 out-of-sample predictions. Production teams should additionally require stability by year and regime, sufficient extreme-probability samples, net expected value after realistic costs, and a data-drift review.

Signal labels use the requested 40%, 47.5%, 52.5%, and 60% boundaries. A weak expected-return estimate around the cost threshold downgrades a middle-range signal to no edge.

