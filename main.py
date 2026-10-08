import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routes import get_routes
from app.storage import TripStorage

# Пути к файлам данных и статике
BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = Path(os.environ.get("TRIPS_FILE", BASE_DIR / "data" / "trips.json"))
STATIC_DIR = BASE_DIR / "static"

storage = TripStorage(DATA_PATH)

app = FastAPI(
    title="Дневник смен водителя API",
    description="API для учёта поездок водителя, расчёта суточных смен, комиссий и выплат 'на руки'.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Разрешаем CORS для любых локальных клиентов
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключаем API маршруты
api_router = get_routes(storage)
app.include_router(api_router)

# Статические файлы для веб-интерфейса
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    async def serve_index():
        return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    print("[SERVER] Started on http://127.0.0.1:8000")
    print("[DOCS] Swagger API: http://127.0.0.1:8000/docs")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
