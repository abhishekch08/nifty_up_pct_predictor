from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import OptionEOD, Prediction
from app.strategy import strategy_report


def test_strategy_report_ranks_only_capped_loss_structures(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'strategy.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        db.add(Prediction(
            date=date(2026, 7, 6), next_trading_day=date(2026, 7, 7), model_version="vtest",
            nifty_close=24400, india_vix=12, probability_up=0.62, probability_down=0.38,
            expected_return=0.002, expected_upper_range=24600, expected_lower_range=24200,
            signal="Strong Bullish", regime="Bullish Low Volatility", confidence="High",
            data_quality="Complete", completeness=0.95, bullish_factors=[], bearish_factors=[]))
        for strike in range(23800, 25001, 100):
            distance = abs(strike - 24400)
            time_value = max(8, 90 - distance * 0.12)
            db.add(OptionEOD(
                date=date(2026, 7, 6), expiry=date(2026, 7, 9), strike=strike, spot=24400,
                ce_oi=1000 + strike, ce_change_oi=0, ce_volume=100, ce_iv=None,
                ce_ltp=max(24400 - strike, 0) + time_value,
                pe_oi=1000 + (25000 - strike), pe_change_oi=0, pe_volume=100, pe_iv=None,
                pe_ltp=max(strike - 24400, 0) + time_value, source="test"))
        db.commit()

        report = strategy_report(db)

    assert report["status"] == "complete"
    assert report["selected"]["max_loss"] > 0
    assert all(candidate["unlimited_loss"] is False for candidate in report["candidates"])
    assert report["payoff_points"]
