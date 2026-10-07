import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"


class TripBase(BaseModel):
    start: datetime = Field(..., description="Время начала поездки (ISO 8601 с часовым поясом)")
    end: datetime = Field(..., description="Время окончания поездки (ISO 8601 с часовым поясом)")
    amount: float = Field(..., description="Сумма поездки в тенге (> 0)")
    payment: PaymentMethod = Field(..., description="Способ оплаты: cash или card")
    commission: float = Field(default=0.0, description="Комиссия сервиса в тенге (0 ≤ комиссия ≤ сумма)")

    @model_validator(mode="after")
    def validate_trip_data(self) -> "TripBase":
        # Без часового пояса нельзя однозначно определить день смены,
        # а сравнение naive/aware datetime падает с TypeError.
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise ValueError("Время должно содержать часовой пояс, например 2026-10-01T08:10:00+05:00")

        if self.amount <= 0:
            raise ValueError("Сумма поездки (amount) должна быть больше нуля")

        if self.commission < 0:
            raise ValueError("Комиссия (commission) не может быть отрицательной")

        if self.commission > self.amount:
            raise ValueError("Комиссия (commission) не может быть больше суммы поездки")

        if self.end <= self.start:
            raise ValueError("Время окончания (end) должно быть позже времени начала (start)")

        return self


class TripCreate(TripBase):
    id: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9_\-]+$",
        description="Идентификатор поездки (рекомендуется передавать — это ключ идемпотентности)",
    )


class Trip(TripBase):
    id: str = Field(..., description="Уникальный идентификатор поездки")

    @classmethod
    def from_create(cls, trip_create: TripCreate) -> "Trip":
        return cls(
            id=trip_create.id or f"t_{uuid.uuid4().hex[:8]}",
            start=trip_create.start,
            end=trip_create.end,
            amount=round(trip_create.amount, 2),
            payment=trip_create.payment,
            commission=round(trip_create.commission, 2),
        )


class PaymentBreakdown(BaseModel):
    cash: float = Field(default=0.0, description="Выручка наличными (₸)")
    card: float = Field(default=0.0, description="Выручка картой (₸)")


class DaySummary(BaseModel):
    date: str = Field(..., description="Дата смены в формате YYYY-MM-DD")
    trips_count: int = Field(..., description="Число поездок за день")
    total_revenue: float = Field(..., description="Выручка за день (₸)")
    total_commission: float = Field(..., description="Комиссия за день (₸)")
    net_payout: float = Field(..., description="«На руки»: выручка минус комиссия (₸)")
    breakdown: PaymentBreakdown = Field(..., description="Разбивка выручки наличные / карта")


class DayDetailsResponse(BaseModel):
    summary: DaySummary
    trips: list[Trip]
