from datetime import datetime
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.models import Trip, PaymentMethod
from app.storage import TripStorage
from app.routes import get_routes


@pytest.fixture
def client_with_storage(tmp_path):
    test_file = tmp_path / "trips_dup_test.json"
    storage = TripStorage(test_file)
    test_app = FastAPI()
    test_app.include_router(get_routes(storage))
    return TestClient(test_app), storage


def test_add_trip_success(client_with_storage):
    client, storage = client_with_storage
    trip_data = {
        "id": "new_1",
        "start": "2026-10-05T10:00:00+05:00",
        "end": "2026-10-05T10:25:00+05:00",
        "amount": 2500,
        "payment": "card",
        "commission": 375,
    }
    response = client.post("/api/trips", json=trip_data)
    assert response.status_code == 201
    created = response.json()
    assert created["id"] == "new_1"
    assert created["amount"] == 2500.0

    # Проверяем сохранение в хранилище
    all_trips = storage.load_all()
    assert len(all_trips) == 1
    assert all_trips[0].id == "new_1"


def test_duplicate_same_id_rejected(client_with_storage):
    """Повторная отправка поездки с тем же ID отклоняется со статусом 409."""
    client, storage = client_with_storage
    trip_data = {
        "id": "fixed_id_100",
        "start": "2026-10-05T11:00:00+05:00",
        "end": "2026-10-05T11:30:00+05:00",
        "amount": 1800,
        "payment": "cash",
        "commission": 270,
    }
    # 1. Первый запрос успешен
    res1 = client.post("/api/trips", json=trip_data)
    assert res1.status_code == 201

    # 2. Повторный запрос отклоняется
    res2 = client.post("/api/trips", json=trip_data)
    assert res2.status_code == 409
    assert "дубликат" in res2.json()["detail"]["message"].lower()

    # В хранилище должна остаться ровно 1 поездка
    assert len(storage.load_all()) == 1


def test_duplicate_same_payload_different_id_rejected(client_with_storage):
    """
    Повторная отправка тех же параметров (время, сумма, оплата, комиссия)
    даже без указания ID или с другим ID распознаётся как смысловой дубликат.
    """
    client, storage = client_with_storage
    trip1 = {
        "start": "2026-10-05T14:00:00+05:00",
        "end": "2026-10-05T14:40:00+05:00",
        "amount": 3400,
        "payment": "card",
        "commission": 510,
    }
    trip2 = {
        "id": "diff_id_but_same_trip",
        "start": "2026-10-05T14:00:00+05:00",
        "end": "2026-10-05T14:40:00+05:00",
        "amount": 3400,
        "payment": "card",
        "commission": 510,
    }

    res1 = client.post("/api/trips", json=trip1)
    assert res1.status_code == 201

    res2 = client.post("/api/trips", json=trip2)
    assert res2.status_code == 409
    assert len(storage.load_all()) == 1


def test_validation_amount_must_be_greater_than_zero(client_with_storage):
    """Сумма поездки (amount) должна быть > 0."""
    client, storage = client_with_storage
    invalid_trip = {
        "start": "2026-10-05T10:00:00+05:00",
        "end": "2026-10-05T10:20:00+05:00",
        "amount": 0,  # Ошибка: сумма 0
        "payment": "cash",
        "commission": 0,
    }
    res = client.post("/api/trips", json=invalid_trip)
    assert res.status_code == 422
    assert len(storage.load_all()) == 0


def test_validation_end_must_be_after_start(client_with_storage):
    """Окончание поездки (end) должно быть строго позже начала (start)."""
    client, storage = client_with_storage
    # 1. Окончание раньше начала
    invalid_trip_1 = {
        "start": "2026-10-05T12:00:00+05:00",
        "end": "2026-10-05T11:50:00+05:00",  # Раньше!
        "amount": 1000,
        "payment": "card",
        "commission": 150,
    }
    res1 = client.post("/api/trips", json=invalid_trip_1)
    assert res1.status_code == 422

    # 2. Окончание равно началу (длительность 0 сек)
    invalid_trip_2 = {
        "start": "2026-10-05T12:00:00+05:00",
        "end": "2026-10-05T12:00:00+05:00",  # Равно!
        "amount": 1000,
        "payment": "card",
        "commission": 150,
    }
    res2 = client.post("/api/trips", json=invalid_trip_2)
    assert res2.status_code == 422

    assert len(storage.load_all()) == 0
