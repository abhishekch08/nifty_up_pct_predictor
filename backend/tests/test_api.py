from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


def test_health_and_admin_auth(tmp_path):
    engine=create_engine(f"sqlite:///{tmp_path/'api.db'}",connect_args={"check_same_thread":False})
    Base.metadata.create_all(engine); Local=sessionmaker(bind=engine)
    def override():
        with Local() as session: yield session
    app.dependency_overrides[get_db]=override
    with TestClient(app) as client:
        assert client.get('/api/health').status_code==200
        assert client.post('/api/admin/retrain-model').status_code==401
        assert client.get('/api/latest-prediction').status_code==404
    app.dependency_overrides.clear()

