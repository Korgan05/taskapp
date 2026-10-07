from datetime import datetime
from typing import List, Optional, Tuple

from app.models import (
    Trip,
    TripCreate,
    DaySummary,
    PaymentBreakdown,
    PaymentMethod,
)


class TripService:
    @staticmethod
    def trip_matches_date(trip: Trip, target_date_str: str) -> bool:
        """
        Проверяет, относится ли поездка к запрашиваемому календарному дню (YYYY-MM-DD).
        Используется дата старта поездки в её локальном часовом поясе.
        """
        trip_date = trip.start.strftime("%Y-%m-%d")
        return trip_date == target_date_str

    @classmethod
    def filter_by_date(cls, trips: List[Trip], target_date_str: str) -> List[Trip]:
        """Возвращает список поездок за указанную дату, отсортированных по времени начала."""
        day_trips = [t for t in trips if cls.trip_matches_date(t, target_date_str)]
        day_trips.sort(key=lambda x: x.start)
        return day_trips

    @classmethod
    def calculate_summary(cls, trips: List[Trip], target_date_str: str) -> DaySummary:
        """
        Рассчитывает суточную сводку:
        - Число поездок
        - Общая выручка
        - Общая комиссия
        - «На руки» (выручка - комиссия)
        - Разбивка наличные / карта
        """
        day_trips = cls.filter_by_date(trips, target_date_str)

        trips_count = len(day_trips)
        total_revenue = round(sum(t.amount for t in day_trips), 2)
        total_commission = round(sum(t.commission for t in day_trips), 2)
        net_payout = round(total_revenue - total_commission, 2)

        cash_amount = round(
            sum(t.amount for t in day_trips if t.payment == PaymentMethod.CASH), 2
        )
        card_amount = round(
            sum(t.amount for t in day_trips if t.payment == PaymentMethod.CARD), 2
        )

        return DaySummary(
            date=target_date_str,
            trips_count=trips_count,
            total_revenue=total_revenue,
            total_commission=total_commission,
            net_payout=net_payout,
            breakdown=PaymentBreakdown(
                cash=cash_amount,
                card=card_amount,
            ),
        )

    @classmethod
    def find_duplicate(
        cls, existing_trips: List[Trip], candidate: TripCreate
    ) -> Optional[Trip]:
        """
        Проверяет, существует ли уже такая поездка.
        Дубликатом считается:
        1. Поездка с совпадающим ID (если ID явно передан клиентом).
        2. Либо поездка с идентичными параметрами (start, end, amount, payment, commission).
        """
        for trip in existing_trips:
            # 1. Проверка по ID
            if candidate.id and trip.id == candidate.id.strip():
                return trip

            # 2. Проверка по смысловому дубликату (бизнес-параметры)
            is_same_start = trip.start == candidate.start
            is_same_end = trip.end == candidate.end
            is_same_amount = abs(trip.amount - candidate.amount) < 0.001
            is_same_payment = trip.payment == candidate.payment
            is_same_commission = abs(trip.commission - candidate.commission) < 0.001

            if (
                is_same_start
                and is_same_end
                and is_same_amount
                and is_same_payment
                and is_same_commission
            ):
                return trip

        return None

    @classmethod
    def get_available_dates(cls, trips: List[Trip]) -> List[str]:
        """Возвращает отсортированный список уникальных дат (YYYY-MM-DD), за которые есть поездки."""
        dates = set(t.start.strftime("%Y-%m-%d") for t in trips)
        return sorted(list(dates))
