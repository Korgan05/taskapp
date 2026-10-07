from datetime import datetime
import pytest
from fastapi.testclient import TestClient

from app.models import Trip, PaymentMethod
from app.services import TripService
from app.storage import TripStorage
from app.routes import get_routes
from fastapi import FastAPI


@pytest.fixture
def sample_trips():
    """Тестовый набор поездок из официального примера ТЗ."""
    return [
        Trip(
            id="t1",
            start=datetime.fromisoformat("2026-10-01T08:10:00+05:00"),
            end=datetime.fromisoformat("2026-10-01T08:32:00+05:00"),
            amount=2400.0,
            payment=PaymentMethod.CARD,
            commission=360.0,
        ),
        Trip(
            id="t2",
            start=datetime.fromisoformat("2026-10-01T09:05:00+05:00"),
            end=datetime.fromisoformat("2026-10-01T09:20:00+05:00"),
            amount=1500.0,
            payment=PaymentMethod.CASH,
            commission=225.0,
        ),
        Trip(
            id="t3_other_day",
            start=datetime.fromisoformat("2026-10-02T10:00:00+05:00"),
            end=datetime.fromisoformat("2026-10-02T10:30:00+05:00"),
            amount=3000.0,
            payment=PaymentMethod.CARD,
            commission=450.0,
        ),
    ]


def test_calculate_summary_matching_sample(sample_trips):
    """
    Проверка расчёта сводки за день 2026-10-01:
    - 2 поездки (2400 карта, 1500 нал)
    - Выручка: 3 900
    - Комиссия: 585
    - На руки: 3 315
    - Наличные / карта: 1 500 / 2 400
    """
    summary = TripService.calculate_summary(sample_trips, "2026-10-01")

    assert summary.date == "2026-10-01"
    assert summary.trips_count == 2
    assert summary.total_revenue == 3900.0
    assert summary.total_commission == 585.0
    assert summary.net_payout == 3315.0
    assert summary.breakdown.cash == 1500.0
    assert summary.breakdown.card == 2400.0


def test_calculate_summary_empty_day(sample_trips):
    """Проверка сводки за день без поездок (должны быть нули)."""
    summary = TripService.calculate_summary(sample_trips, "2026-10-99")

    assert summary.date == "2026-10-99"
    assert summary.trips_count == 0
    assert summary.total_revenue == 0.0
    assert summary.total_commission == 0.0
    assert summary.net_payout == 0.0
    assert summary.breakdown.cash == 0.0
    assert summary.breakdown.card == 0.0


def test_api_summary_and_trips_endpoints(tmp_path, sample_trips):
    """Проверка работы REST API эндпоинтов /api/summary и /api/trips."""
    test_file = tmp_path / "trips_test.json"
    storage = TripStorage(test_file)
    storage.save_all(sample_trips)

    test_app = FastAPI()
    test_app.include_router(get_routes(storage))
    client = TestClient(test_app)

    # 1. Запрос сводки через API
    response = client.get("/api/summary?date=2026-10-01")
    assert response.status_code == 200
    data = response.json()
    assert data["trips_count"] == 2
    assert data["total_revenue"] == 3900.0
    assert data["total_commission"] == 585.0
    assert data["net_payout"] == 3315.0
    assert data["breakdown"]["cash"] == 1500.0
    assert data["breakdown"]["card"] == 2400.0

    # 2. Запрос списка поездок через API
    trips_resp = client.get("/api/trips?date=2026-10-01")
    assert trips_resp.status_code == 200
    trips_list = trips_resp.json()
    assert len(trips_list) == 2
    assert trips_list[0]["id"] == "t1"
    assert trips_list[1]["id"] == "t2"
