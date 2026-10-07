from typing import List, Optional
from datetime import date
from fastapi import APIRouter, HTTPException, Query, status

from app.models import Trip, TripCreate, DaySummary, DayDetailsResponse
from app.services import TripService
from app.storage import TripStorage

router = APIRouter(prefix="/api", tags=["Trips & Shifts"])


def get_routes(storage: TripStorage) -> APIRouter:
    r = APIRouter(prefix="/api", tags=["Trips & Shifts"])

    @r.get(
        "/dates",
        response_model=List[str],
        summary="Получить список дат, за которые есть поездки",
    )
    def list_available_dates():
        all_trips = storage.load_all()
        return TripService.get_available_dates(all_trips)

    @r.get(
        "/trips",
        response_model=List[Trip],
        summary="Список поездок за выбранный день",
    )
    def get_trips(
        date_str: str = Query(
            ...,
            alias="date",
            description="Дата в формате YYYY-MM-DD",
            examples=["2026-10-01"],
        )
    ):
        all_trips = storage.load_all()
        return TripService.filter_by_date(all_trips, date_str)

    @r.get(
        "/summary",
        response_model=DaySummary,
        summary="Сводка смены за выбранный день",
    )
    def get_summary(
        date_str: str = Query(
            ...,
            alias="date",
            description="Дата в формате YYYY-MM-DD",
            examples=["2026-10-01"],
        )
    ):
        all_trips = storage.load_all()
        return TripService.calculate_summary(all_trips, date_str)

    @r.get(
        "/day",
        response_model=DayDetailsResponse,
        summary="Полная информация за день (сводка + список поездок)",
    )
    def get_day_details(
        date_str: str = Query(
            ...,
            alias="date",
            description="Дата в формате YYYY-MM-DD",
            examples=["2026-10-01"],
        )
    ):
        all_trips = storage.load_all()
        summary = TripService.calculate_summary(all_trips, date_str)
        trips = TripService.filter_by_date(all_trips, date_str)
        return DayDetailsResponse(summary=summary, trips=trips)

    @r.post(
        "/trips",
        response_model=Trip,
        status_code=status.HTTP_201_CREATED,
        summary="Добавить новую поездку с валидацией и защитой от дублей",
    )
    def add_trip(trip_data: TripCreate):
        all_trips = storage.load_all()

        # Защита от дублей
        duplicate = TripService.find_duplicate(all_trips, trip_data)
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Поездка уже зарегистрирована (дубликат отклонён)",
                    "duplicate_id": duplicate.id,
                },
            )

        new_trip = Trip.from_create(trip_data)
        saved = storage.add_trip(new_trip)
        return saved

    return r
