import json
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, List

from app.models import Trip


class StorageError(RuntimeError):
    """Файл с поездками повреждён или не читается."""


class _Transaction:
    def __init__(self, trips: List[Trip]):
        self.trips = trips
        self.dirty = False


class TripStorage:
    """
    Хранилище поездок в JSON-файле.

    Все операции «прочитать → проверить → записать» выполняются под одной
    блокировкой (см. transaction), иначе два параллельных запроса могли бы
    оба пройти проверку на дубль и оба сохранить поездку.
    """

    def __init__(self, file_path: str | Path):
        self.file_path = Path(file_path)
        self._lock = threading.Lock()
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.file_path.exists():
            self._write([])

    # --- низкоуровневые операции (вызывать только под self._lock) ---

    def _read(self) -> List[Trip]:
        if not self.file_path.exists():
            return []
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            # Нельзя молча вернуть [] — следующая запись затёрла бы все данные.
            raise StorageError(f"Не удалось прочитать {self.file_path}: {exc}") from exc
        return [Trip(**item) for item in raw]

    def _write(self, trips: List[Trip]) -> None:
        data = [t.model_dump(mode="json") for t in trips]
        tmp = self.file_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.file_path)  # атомарная замена файла

    # --- публичный API ---

    def load_all(self) -> List[Trip]:
        with self._lock:
            return self._read()

    def save_all(self, trips: List[Trip]) -> None:
        with self._lock:
            self._write(sorted(trips, key=lambda t: t.start))

    @contextmanager
    def transaction(self) -> Iterator[_Transaction]:
        """
        Атомарная операция над списком поездок.
        Если внутри блока выставить tx.dirty = True, список будет сохранён.
        Если внутри блока возникло исключение — ничего не сохраняется.
        """
        with self._lock:
            tx = _Transaction(self._read())
            yield tx
            if tx.dirty:
                tx.trips.sort(key=lambda t: t.start)
                self._write(tx.trips)
