from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Union

from app.models import DaySummary, PaymentBreakdown, PaymentMethod, Trip, TripCreate

DayLike = Union[date, str]

# Локальный часовой пояс водителя (Алматы, Казахстан, UTC+05:00)
DRIVER_TZ = timezone(timedelta(hours=5))


class TripIdConflict(Exception):
    """ID уже занят поездкой с другими данными."""

    def __init__(self, existing: Trip):
        super().__init__(existing.id)
        self.existing = existing


def _as_date(day: DayLike) -> date:
    return day if isinstance(day, date) else date.fromisoformat(day)


class TripService:
    @staticmethod
    def trip_day(trip: Trip, tz: timezone = DRIVER_TZ) -> date:
        """
        День смены = календарная дата начала поездки в локальном часовом поясе водителя (+05:00).
        Корректно приводит aware datetime из любого ISO-офсета (включая UTC/Z) к часовому поясу смены.
        Поездка 01.10 23:50 → 02.10 00:20 относится к 01.10.
        """
        start = trip.start
        if start.tzinfo is not None:
            start = start.astimezone(tz)
        return start.date()

    @classmethod
    def filter_by_date(cls, trips: List[Trip], day: DayLike, tz: timezone = DRIVER_TZ) -> List[Trip]:
        d = _as_date(day)
        return sorted((t for t in trips if cls.trip_day(t, tz) == d), key=lambda t: t.start)

    @classmethod
    def calculate_summary(cls, trips: List[Trip], day: DayLike, tz: timezone = DRIVER_TZ) -> DaySummary:
        d = _as_date(day)
        day_trips = cls.filter_by_date(trips, d, tz)

        revenue = round(sum(t.amount for t in day_trips), 2)
        commission = round(sum(t.commission for t in day_trips), 2)
        cash = round(sum(t.amount for t in day_trips if t.payment == PaymentMethod.CASH), 2)
        card = round(sum(t.amount for t in day_trips if t.payment == PaymentMethod.CARD), 2)

        return DaySummary(
            date=d.isoformat(),
            trips_count=len(day_trips),
            total_revenue=revenue,
            total_commission=commission,
            net_payout=round(revenue - commission, 2),
            breakdown=PaymentBreakdown(cash=cash, card=card),
        )

    @staticmethod
    def same_trip_data(trip: Trip, candidate: TripCreate) -> bool:
        return (
            trip.start == candidate.start  # aware datetime сравниваются как моменты времени
            and trip.end == candidate.end
            and abs(trip.amount - candidate.amount) < 0.005
            and trip.payment == candidate.payment
            and abs(trip.commission - candidate.commission) < 0.005
        )

    @classmethod
    def find_existing(cls, trips: List[Trip], candidate: TripCreate) -> Optional[Trip]:
        """
        Ищет уже сохранённую «ту же самую» поездку.

        - Есть такой id и данные совпадают → повторная отправка, возвращаем существующую.
        - Есть такой id, но данные другие   → TripIdConflict (409).
        - id нет / новый, но все поля совпадают с существующей поездкой
          (клиент перегенерировал id при ретрае) → тоже повтор.
        - Иначе → None, поездку можно создавать.
        """
        if candidate.id:
            for t in trips:
                if t.id == candidate.id:
                    if cls.same_trip_data(t, candidate):
                        return t
                    raise TripIdConflict(t)

        for t in trips:
            if cls.same_trip_data(t, candidate):
                return t
        return None

    @classmethod
    def get_available_dates(cls, trips: List[Trip], tz: timezone = DRIVER_TZ) -> List[str]:
        return sorted({cls.trip_day(t, tz).isoformat() for t in trips})
