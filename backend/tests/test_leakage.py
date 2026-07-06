from datetime import datetime, timezone
import pandas as pd
import pytest

from app.data_sources import assert_asof_availability


def test_rejects_unavailable_future_features():
    frame = pd.DataFrame({"date": ["2026-01-02"], "available_at": ["2026-01-03T10:00:00Z"]})
    with pytest.raises(ValueError, match="look-ahead"):
        assert_asof_availability(frame, pd.Series(["2026-01-03T09:00:00Z"]))


def test_accepts_data_known_at_cutoff():
    frame = pd.DataFrame({"date": ["2026-01-02"], "available_at": ["2026-01-02T12:00:00Z"]})
    assert_asof_availability(frame, pd.Series(["2026-01-03T09:00:00Z"]))

