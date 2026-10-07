# CLAUDE.md · arqa mobility — Driver Shift Logbook

Guidelines and architecture invariants for AI agents (Claude Code / Codex) and engineers working on this repository.

---

## 🛠️ Commands & Workflows

### Run Server Locally
```bash
# Direct entrypoint (FastAPI + uvicorn)
python main.py

# Or via uvicorn directly
uvicorn main:app --reload --port 8000
```
- App UI: `http://127.0.0.1:8000`
- OpenAPI Swagger Docs: `http://127.0.0.1:8000/docs`

### Run Tests & Verification
```bash
# Run entire test suite (32 tests)
pytest -v

# Run specific test file
pytest tests/test_summary.py -v
pytest tests/test_duplicates.py -v

# Run linting
ruff check .
```

### Docker
```bash
docker build -t arqa-taskapp .
docker run -p 8000:8000 arqa-taskapp
```

---

## 🏛️ Architecture & Invariants

### 1. Timezone Shift (`UTC+05:00`, Almaty / Kazakhstan)
- The driver's shift boundary is strictly based on the **local start time** in Almaty (`DRIVER_TZ = timezone(timedelta(hours=5))`).
- **Never** determine the shift date via naive `trip.start.date()` or UTC date.
- Any incoming aware timestamp (whether in UTC `Z`, `+00:00`, or other offset) must be converted via `trip.start.astimezone(DRIVER_TZ).date()`.
- Overnight trips (e.g. `23:50 → 00:20`) belong to the calendar day where the trip started.

### 2. Idempotency & Deduplication
- Mobile networks are unstable; drivers or clients frequently retry requests.
- **Idempotency-Key Header**: Supported in `POST /api/trips` (`Idempotency-Key: <key>`). Replaying returns `200 OK` with `Idempotent-Replay: true`.
- **Semantic Deduplication**: If a trip has no ID or client regenerated the ID on retry, matching all key fields (`start`, `end`, `amount`, `commission`, `payment`) returns the existing record (`200 OK`) instead of duplicating.
- **Conflict Handling**: Reusing an existing ID with conflicting data raises `409 Conflict`.
- **Thread Safety**: All reads, validations, and writes in `TripStorage` are protected by `threading.Lock` (`storage.transaction()`).

### 3. Financial Calculations & Precision
- Avoid IEEE 754 float rounding errors (`3314.9999999999995`).
- All monetary amounts (revenue, commission, net payout, card/cash breakdown) must be rounded via `round(val, 2)` in models and services.
- On the frontend, `formatMoney` must support up to 2 decimal places (`maximumFractionDigits: 2`) while displaying clean integers for round sums (`2 400 ₸`).

### 4. Input Validations
- `amount > 0`: Trip amount must be strictly positive.
- `end > start`: Trip finish time must be strictly after trip start time.
- `0 <= commission <= amount`: Commission cannot be negative and cannot exceed total trip amount.
- Timestamps must include an explicit timezone offset (e.g. `+05:00` or `Z`).

### 5. Frontend Philosophy (Vanilla & Mobile-First)
- **Zero build tools**: Plain HTML5, Modern CSS3 with semantic tokens, Vanilla ES6 JavaScript.
- **Design Tokens**: 8px grid (`8px, 16px, 24px`), dark-mode palette (`#080C14`, `#0F172A`), fonts: `Unbounded` for display titles, `Inter` for body, `JetBrains Mono` for monetary figures.
- **UX Guardrails**:
  - Modal scroll lock: Lock `body.modal-open` (`overflow: hidden`) whenever any dialog or calendar is open.
  - Toast anti-spam: Deduplicate notifications so repeated actions never spam duplicate toasts.
  - Progressive disclosure: Clean overview by default, click-to-expand details for individual trips.
