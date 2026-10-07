from datetime import date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import PaymentMethod, Trip
from app.routes import get_routes
from app.services import TripService
from app.storage import TripStorage


def make_trip(id, start, end, amount, payment, commission):
    return Trip(
        id=id,
        start=datetime.fromisoformat(start),
        end=datetime.fromisoformat(end),
        amount=amount,
        payment=PaymentMethod(payment),
        commission=commission,
    )


@pytest.fixture
def sample_trips():
    """Две поездки из примера в ТЗ + поездка в другой день."""
    return [
        make_trip("t1", "2026-10-01T08:10:00+05:00", "2026-10-01T08:32:00+05:00", 2400, "card", 360),
        make_trip("t2", "2026-10-01T09:05:00+05:00", "2026-10-01T09:20:00+05:00", 1500, "cash", 225),
        make_trip("t3", "2026-10-02T10:00:00+05:00", "2026-10-02T10:30:00+05:00", 3000, "card", 450),
    ]


def test_summary_matches_example_from_task(sample_trips):
    """Цифры совпадают с чеком на странице вакансии: 2 поездки, 3 900, −585, на руки 3 315, 1 500 / 2 400."""
    s = TripService.calculate_summary(sample_trips, date(2026, 10, 1))

    assert s.date == "2026-10-01"
    assert s.trips_count == 2
    assert s.total_revenue == 3900
    assert s.total_commission == 585
    assert s.net_payout == 3315
    assert s.breakdown.cash == 1500
    assert s.breakdown.card == 2400


def test_summary_only_counts_selected_day(sample_trips):
    s = TripService.calculate_summary(sample_trips, "2026-10-02")
    assert s.trips_count == 1
    assert s.total_revenue == 3000
    assert s.breakdown.cash == 0
    assert s.breakdown.card == 3000


def test_summary_empty_day_is_all_zeros(sample_trips):
    s = TripService.calculate_summary(sample_trips, date(2026, 10, 5))
    assert (s.trips_count, s.total_revenue, s.total_commission, s.net_payout) == (0, 0, 0, 0)
    assert (s.breakdown.cash, s.breakdown.card) == (0, 0)


def test_cash_plus_card_equals_revenue(sample_trips):
    s = TripService.calculate_summary(sample_trips, date(2026, 10, 1))
    assert s.breakdown.cash + s.breakdown.card == s.total_revenue


def test_day_boundary_uses_local_time_not_utc():
    """
    Поездка в 02:00 по Алматы (+05:00) — это 21:00 UTC предыдущего дня.
    Для водителя она относится к 01.10, а не к 30.09.
    Поездка через полночь относится к дню начала.
    """
    trips = [
        make_trip("night", "2026-10-01T02:00:00+05:00", "2026-10-01T02:20:00+05:00", 1000, "cash", 150),
        make_trip("midnight", "2026-10-01T23:50:00+05:00", "2026-10-02T00:20:00+05:00", 2000, "card", 300),
    ]
    assert TripService.calculate_summary(trips, "2026-09-30").trips_count == 0
    assert TripService.calculate_summary(trips, "2026-10-01").trips_count == 2
    assert TripService.calculate_summary(trips, "2026-10-02").trips_count == 0


def test_fractional_amounts_are_rounded():
    trips = [
        make_trip("a", "2026-10-01T08:00:00+05:00", "2026-10-01T08:10:00+05:00", 0.1, "cash", 0.0),
        make_trip("b", "2026-10-01T09:00:00+05:00", "2026-10-01T09:10:00+05:00", 0.2, "cash", 0.0),
    ]
    assert TripService.calculate_summary(trips, "2026-10-01").total_revenue == 0.3


# ---------- API ----------

@pytest.fixture
def client(tmp_path, sample_trips):
    storage = TripStorage(tmp_path / "trips_test.json")
    storage.save_all(sample_trips)
    app = FastAPI()
    app.include_router(get_routes(storage))
    return TestClient(app)


def test_api_summary(client):
    res = client.get("/api/summary", params={"date": "2026-10-01"})
    assert res.status_code == 200
    assert res.json() == {
        "date": "2026-10-01",
        "trips_count": 2,
        "total_revenue": 3900,
        "total_commission": 585,
        "net_payout": 3315,
        "breakdown": {"cash": 1500, "card": 2400},
    }


def test_api_trips_sorted_by_start(client):
    res = client.get("/api/trips", params={"date": "2026-10-01"})
    assert res.status_code == 200
    assert [t["id"] for t in res.json()] == ["t1", "t2"]


def test_api_day_combines_summary_and_trips(client):
    data = client.get("/api/day", params={"date": "2026-10-02"}).json()
    assert data["summary"]["trips_count"] == 1
    assert [t["id"] for t in data["trips"]] == ["t3"]


def test_api_dates(client):
    assert client.get("/api/dates").json() == ["2026-10-01", "2026-10-02"]


@pytest.mark.parametrize("bad", ["2026-13-01", "01.10.2026", "abc", ""])
def test_api_rejects_invalid_date(client, bad):
    assert client.get("/api/summary", params={"date": bad}).status_code == 422


def test_api_requires_date(client):
    assert client.get("/api/trips").status_code == 422
