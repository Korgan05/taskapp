from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Response, status

from app.models import DayDetailsResponse, DaySummary, Trip, TripCreate
from app.services import TripIdConflict, TripService
from app.storage import TripStorage

DateQuery = Query(..., alias="date", description="Дата в формате YYYY-MM-DD", examples=["2026-10-01"])


def get_routes(storage: TripStorage) -> APIRouter:
    r = APIRouter(prefix="/api", tags=["Trips & Shifts"])

    @r.get("/dates", response_model=List[str], summary="Даты, за которые есть поездки")
    def list_available_dates():
        return TripService.get_available_dates(storage.load_all())

    @r.get("/trips", response_model=List[Trip], summary="Список поездок за день")
    def get_trips(day: date = DateQuery):
        return TripService.filter_by_date(storage.load_all(), day)

    @r.get("/summary", response_model=DaySummary, summary="Сводка за день")
    def get_summary(day: date = DateQuery):
        return TripService.calculate_summary(storage.load_all(), day)

    @r.get("/day", response_model=DayDetailsResponse, summary="Сводка + поездки за день одним запросом")
    def get_day_details(day: date = DateQuery):
        trips = storage.load_all()
        return DayDetailsResponse(
            summary=TripService.calculate_summary(trips, day),
            trips=TripService.filter_by_date(trips, day),
        )

    @r.post(
        "/trips",
        response_model=Trip,
        status_code=status.HTTP_201_CREATED,
        summary="Добавить поездку (идемпотентно)",
        responses={
            200: {"description": "Такая поездка уже есть — дубль не создан, возвращена существующая"},
            201: {"description": "Поездка создана"},
            409: {"description": "Этот id уже занят поездкой с другими данными"},
            422: {"description": "Ошибка валидации (сумма ≤ 0, окончание не позже начала и т.д.)"},
        },
    )
    def add_trip(
        trip_data: TripCreate,
        response: Response,
        idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key", description="Ключ идемпотентности"),
    ):
        # Если передан стандартный HTTP-заголовок Idempotency-Key и id в теле не указан — связываем их
        if idempotency_key and not trip_data.id:
            trip_data.id = idempotency_key.strip()

        # Проверка и запись под одной блокировкой — иначе параллельные
        # повторы одного запроса могли бы оба пройти проверку.
        with storage.transaction() as tx:
            try:
                existing = TripService.find_existing(tx.trips, trip_data)
            except TripIdConflict as conflict:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": f"ID «{conflict.existing.id}» уже занят поездкой с другими данными",
                        "duplicate_id": conflict.existing.id,
                    },
                )

            if existing is not None:
                response.status_code = status.HTTP_200_OK
                response.headers["Idempotent-Replay"] = "true"
                if idempotency_key:
                    response.headers["Idempotency-Key"] = idempotency_key
                return existing

            new_trip = Trip.from_create(trip_data)
            tx.trips.append(new_trip)
            tx.dirty = True
            if idempotency_key:
                response.headers["Idempotency-Key"] = idempotency_key
            return new_trip

    return r
