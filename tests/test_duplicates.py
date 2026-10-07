from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import Trip, TripCreate
from app.routes import get_routes
from app.services import TripService
from app.storage import StorageError, TripStorage

BASE_TRIP = {
    "start": "2026-10-05T11:00:00+05:00",
    "end": "2026-10-05T11:30:00+05:00",
    "amount": 1800,
    "payment": "cash",
    "commission": 270,
}


@pytest.fixture
def client_with_storage(tmp_path):
    storage = TripStorage(tmp_path / "trips_dup_test.json")
    app = FastAPI()
    app.include_router(get_routes(storage))
    return TestClient(app), storage


# ---------- добавление и защита от дублей ----------

def test_add_trip_success(client_with_storage):
    client, storage = client_with_storage
    res = client.post("/api/trips", json={**BASE_TRIP, "id": "new_1"})
    assert res.status_code == 201
    assert res.json()["id"] == "new_1"
    assert [t.id for t in storage.load_all()] == ["new_1"]


def test_resend_same_trip_does_not_create_duplicate(client_with_storage):
    """Повторная отправка той же поездки: 200 + та же запись, в хранилище по-прежнему одна."""
    client, storage = client_with_storage
    payload = {**BASE_TRIP, "id": "t100"}

    first = client.post("/api/trips", json=payload)
    second = client.post("/api/trips", json=payload)
    third = client.post("/api/trips", json=payload)

    assert first.status_code == 201
    assert second.status_code == 200
    assert third.status_code == 200
    assert second.headers.get("Idempotent-Replay") == "true"
    assert second.json() == first.json()
    assert len(storage.load_all()) == 1


def test_idempotency_key_header_support(client_with_storage):
    """Стандартный заголовок Idempotency-Key предотвращает дублирование при повторных сетевых запросах."""
    client, storage = client_with_storage
    key = "idem-key-abc-123"

    first = client.post("/api/trips", json=BASE_TRIP, headers={"Idempotency-Key": key})
    assert first.status_code == 201
    assert first.headers.get("Idempotency-Key") == key
    assert first.json()["id"] == key

    # Повторный запрос с тем же Idempotency-Key
    replay = client.post("/api/trips", json=BASE_TRIP, headers={"Idempotency-Key": key})
    assert replay.status_code == 200
    assert replay.headers.get("Idempotent-Replay") == "true"
    assert replay.headers.get("Idempotency-Key") == key
    assert replay.json()["id"] == first.json()["id"]
    assert len(storage.load_all()) == 1


def test_resend_without_id_does_not_create_duplicate(client_with_storage):
    """Клиент не передал id (или перегенерировал его) — дубль ловится по данным поездки."""
    client, storage = client_with_storage

    first = client.post("/api/trips", json=BASE_TRIP)
    second = client.post("/api/trips", json=BASE_TRIP)
    regenerated_id = client.post("/api/trips", json={**BASE_TRIP, "id": "another_id"})

    assert first.status_code == 201
    assert second.status_code == 200
    assert regenerated_id.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert len(storage.load_all()) == 1


def test_same_id_with_different_data_is_conflict(client_with_storage):
    """Тот же id, но другая сумма — это не повтор, а конфликт. Старая запись не перезаписывается."""
    client, storage = client_with_storage
    client.post("/api/trips", json={**BASE_TRIP, "id": "t200"})

    res = client.post("/api/trips", json={**BASE_TRIP, "id": "t200", "amount": 9999})

    assert res.status_code == 409
    assert res.json()["detail"]["duplicate_id"] == "t200"
    trips = storage.load_all()
    assert len(trips) == 1
    assert trips[0].amount == 1800


def test_same_moment_in_other_timezone_is_duplicate(client_with_storage):
    """11:00+05:00 и 06:00Z — один и тот же момент, значит та же поездка."""
    client, storage = client_with_storage
    client.post("/api/trips", json=BASE_TRIP)
    res = client.post(
        "/api/trips",
        json={**BASE_TRIP, "start": "2026-10-05T06:00:00Z", "end": "2026-10-05T06:30:00Z"},
    )
    assert res.status_code == 200
    assert len(storage.load_all()) == 1


def test_different_trips_are_both_saved(client_with_storage):
    client, storage = client_with_storage
    assert client.post("/api/trips", json=BASE_TRIP).status_code == 201
    other = {**BASE_TRIP, "start": "2026-10-05T12:00:00+05:00", "end": "2026-10-05T12:20:00+05:00"}
    assert client.post("/api/trips", json=other).status_code == 201
    assert len(storage.load_all()) == 2


def test_parallel_resends_create_single_trip(tmp_path):
    """
    10 одновременных повторов одной поездки (как при ретраях с плохой связью).
    Проверка и запись идут под одной блокировкой — сохраниться должна ровно одна.
    """
    storage = TripStorage(tmp_path / "parallel.json")
    payload = TripCreate(**{**BASE_TRIP, "id": "race_1"})

    def submit():
        with storage.transaction() as tx:
            if TripService.find_existing(tx.trips, payload) is None:
                tx.trips.append(Trip.from_create(payload))
                tx.dirty = True

    with ThreadPoolExecutor(max_workers=10) as pool:
        for f in [pool.submit(submit) for _ in range(10)]:
            f.result()

    assert len(storage.load_all()) == 1


# ---------- валидация ----------

@pytest.mark.parametrize("amount", [0, -100])
def test_amount_must_be_positive(client_with_storage, amount):
    client, storage = client_with_storage
    res = client.post("/api/trips", json={**BASE_TRIP, "amount": amount, "commission": 0})
    assert res.status_code == 422
    assert storage.load_all() == []


@pytest.mark.parametrize(
    "end",
    ["2026-10-05T10:50:00+05:00", "2026-10-05T11:00:00+05:00"],  # раньше начала / равно началу
    ids=["end_before_start", "end_equals_start"],
)
def test_end_must_be_after_start(client_with_storage, end):
    client, storage = client_with_storage
    res = client.post("/api/trips", json={**BASE_TRIP, "end": end})
    assert res.status_code == 422
    assert storage.load_all() == []


def test_commission_cannot_exceed_amount(client_with_storage):
    client, _ = client_with_storage
    res = client.post("/api/trips", json={**BASE_TRIP, "commission": 5000})
    assert res.status_code == 422


def test_time_without_timezone_rejected(client_with_storage):
    client, _ = client_with_storage
    res = client.post(
        "/api/trips",
        json={**BASE_TRIP, "start": "2026-10-05T11:00:00", "end": "2026-10-05T11:30:00"},
    )
    assert res.status_code == 422


def test_unknown_payment_rejected(client_with_storage):
    client, _ = client_with_storage
    assert client.post("/api/trips", json={**BASE_TRIP, "payment": "crypto"}).status_code == 422


# ---------- хранилище ----------

def test_corrupted_file_is_not_silently_overwritten(tmp_path):
    """Если JSON битый, нельзя считать его пустым и перезаписать — данные водителя пропадут."""
    path = tmp_path / "broken.json"
    path.write_text("[{ broken json", encoding="utf-8")
    storage = TripStorage(path)

    with pytest.raises(StorageError):
        with storage.transaction() as tx:
            tx.dirty = True

    assert path.read_text(encoding="utf-8") == "[{ broken json"
