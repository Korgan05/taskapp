import json
import os
import threading
from pathlib import Path
from typing import List, Optional
from datetime import datetime

from app.models import Trip


class TripStorage:
    def __init__(self, file_path: str | Path):
        self.file_path = Path(file_path)
        self.lock = threading.Lock()
        self._ensure_storage_exists()

    def _ensure_storage_exists(self) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.file_path.exists():
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)

    def load_all(self) -> List[Trip]:
        with self.lock:
            if not self.file_path.exists():
                return []
            try:
                with open(self.file_path, "r", encoding="utf-8") as f:
                    raw_data = json.load(f)
                return [Trip(**item) for item in raw_data]
            except (json.JSONDecodeError, OSError):
                return []

    def save_all(self, trips: List[Trip]) -> None:
        with self.lock:
            temp_path = self.file_path.with_suffix(".tmp")
            data = []
            for t in trips:
                item = t.model_dump()
                item["start"] = t.start.isoformat()
                item["end"] = t.end.isoformat()
                item["payment"] = t.payment.value
                data.append(item)
            
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            temp_path.replace(self.file_path)

    def add_trip(self, trip: Trip) -> Trip:
        with self.lock:
            trips = []
            if self.file_path.exists():
                try:
                    with open(self.file_path, "r", encoding="utf-8") as f:
                        raw_data = json.load(f)
                    trips = [Trip(**item) for item in raw_data]
                except Exception:
                    trips = []

            trips.append(trip)
            # Сортируем поездки по времени начала
            trips.sort(key=lambda x: x.start)

            temp_path = self.file_path.with_suffix(".tmp")
            data = []
            for t in trips:
                item = t.model_dump()
                item["start"] = t.start.isoformat()
                item["end"] = t.end.isoformat()
                item["payment"] = t.payment.value
                data.append(item)

            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            temp_path.replace(self.file_path)
            return trip
