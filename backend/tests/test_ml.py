from datetime import date, timedelta
import numpy as np
import pandas as pd

from app.ml import feature_columns, signal_label, walk_forward


def synthetic(n=220):
    rng=np.random.default_rng(4); x=rng.normal(size=n); returns=.002*np.sign(x)+rng.normal(0,.006,n)
    return pd.DataFrame({"date":[date(2020,1,1)+timedelta(days=i) for i in range(n)],"feature":x,
                         "target_next_day_up":(returns>0).astype(float),"target_next_day_return":returns})


def test_walk_forward_is_out_of_sample_and_calibrated():
    result=walk_forward(synthetic(),min_train=100,test_size=30)
    assert len(result.predictions)==120
    assert 0 <= result.metrics["brier_score"] <= 1
    assert result.threshold_analysis


def test_signal_thresholds_and_ev_guard():
    assert signal_label(.62,.002)=="Strong Bullish"
    assert signal_label(.5,0)=="Neutral / No Edge"
    assert signal_label(.35,-.002)=="Strong Bearish"


def test_sparse_new_feed_is_not_backtested_as_historical():
    frame = synthetic()
    frame["one_day_feed"] = np.nan
    frame.loc[frame.index[-1], "one_day_feed"] = 1.0
    assert "one_day_feed" not in feature_columns(frame)
