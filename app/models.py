from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, model_validator
import uuid


class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"


class TripBase(BaseModel):
    start: datetime = Field(..., description="Время начала поездки (ISO 8601)")
    end: datetime = Field(..., description="Время окончания поездки (ISO 8601)")
    amount: float = Field(..., description="Сумма поездки в тенге (> 0)")
    payment: PaymentMethod = Field(..., description="Способ оплаты: cash или card")
    commission: float = Field(default=0.0, description="Комиссия сервиса в тенге (>= 0)")

    @model_validator(mode="after")
    def validate_trip_data(self) -> "TripBase":
        # Проверка 1: Сумма строго больше 0
        if self.amount <= 0:
            raise ValueError("Сумма поездки (amount) должна быть строго больше нуля")
        
        # Проверка 2: Комиссия не может быть отрицательной
        if self.commission < 0:
            raise ValueError("Комиссия (commission) не может быть отрицательной")

        # Проверка 3: Окончание поездки позже начала
        if self.end <= self.start:
            raise ValueError("Время окончания поездки (end) должно быть строго позже времени начала (start)")

        return self


class TripCreate(TripBase):
    id: Optional[str] = Field(default=None, description="Опциональный уникальный идентификатор поездки")


class Trip(TripBase):
    id: str = Field(..., description="Уникальный идентификатор поездки")

    @classmethod
    def from_create(cls, trip_create: TripCreate) -> "Trip":
        trip_id = trip_create.id.strip() if trip_create.id and trip_create.id.strip() else f"t_{uuid.uuid4().hex[:8]}"
        return cls(
            id=trip_id,
            start=trip_create.start,
            end=trip_create.end,
            amount=round(trip_create.amount, 2),
            payment=trip_create.payment,
            commission=round(trip_create.commission, 2),
        )


class PaymentBreakdown(BaseModel):
    cash: float = Field(default=0.0, description="Выручка наличными (₸)")
    card: float = Field(default=0.0, description="Выручка по безналичной оплате/карте (₸)")


class DaySummary(BaseModel):
    date: str = Field(..., description="Дата смены в формате YYYY-MM-DD")
    trips_count: int = Field(..., description="Общее число поездок за день")
    total_revenue: float = Field(..., description="Общая выручка за день (₸)")
    total_commission: float = Field(..., description="Общая комиссия за день (₸)")
    net_payout: float = Field(..., description="Чистый доход водителя 'на руки' (выручка - комиссия) (₸)")
    breakdown: PaymentBreakdown = Field(..., description="Разбивка выручки по способам оплаты")


class DayDetailsResponse(BaseModel):
    summary: DaySummary
    trips: list[Trip]
