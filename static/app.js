/**
 * arqa mobility · Дневник смен водителя
 * Клиентская логика: интерактивный календарь месяца, недельная лента, аналитика смены, API, темы, горячие клавиши.
 */

const TZ_OFFSET = "+05:00"; // Локальный часовой пояс водителя (Алматы, Казахстан)

const state = {
  currentDate: null,
  currentDayData: null,
  availableDates: [],
  loadSeq: 0,
  loadAbort: null,
  submitting: false,
  calYear: null,
  calMonth: null, // 0-11
};

const $ = (id) => document.getElementById(id);

const el = {
  themeToggleBtn: $("theme-toggle-btn"),
  prevDayBtn: $("prev-day-btn"),
  nextDayBtn: $("next-day-btn"),
  dateDisplayBtn: $("date-display-btn"),
  dateDisplayText: $("date-display-text"),
  dateRelativeTag: $("date-relative-tag"),
  weekStrip: $("week-strip"),
  openCalendarBtn: $("open-calendar-btn"),
  todayBtn: $("today-btn"),

  calendarModal: $("calendar-modal"),
  calendarCloseBtn: $("calendar-close-btn"),
  calPrevMonthBtn: $("cal-prev-month-btn"),
  calNextMonthBtn: $("cal-next-month-btn"),
  calendarMonthTitle: $("calendar-month-title"),
  calendarGrid: $("calendar-grid"),
  calTodayBtn: $("cal-today-btn"),

  openReceiptBtn: $("open-receipt-btn"),
  receiptModal: $("receipt-modal"),
  receiptCloseBtn: $("receipt-close-btn"),
  receiptPrintBtn: $("receipt-print-btn"),
  receiptDateText: $("receipt-date-text"),
  receiptTripsTable: $("receipt-trips-table"),
  receiptCount: $("receipt-count"),
  receiptRevenue: $("receipt-revenue"),
  receiptCommission: $("receipt-commission"),
  receiptNet: $("receipt-net"),
  receiptBreakdown: $("receipt-breakdown"),
  receiptBarcodeCode: $("receipt-barcode-code"),

  summaryNet: $("summary-net"),
  summaryStatusBadge: $("summary-status-badge"),
  summaryRevenue: $("summary-revenue"),
  summaryTripsCount: $("summary-trips-count"),
  summaryCommission: $("summary-commission"),
  summaryCommissionRate: $("summary-commission-rate"),
  summaryPaymentsText: $("summary-payments-text"),
  splitBarCard: $("split-bar-card"),
  splitBarCash: $("split-bar-cash"),

  tripsCountBadge: $("trips-count-badge"),
  tripsList: $("trips-list-container"),

  openModalBtn: $("open-add-modal-btn"),
  modalBackdrop: $("add-trip-modal"),
  modalCloseBtn: $("modal-close-btn"),
  form: $("add-trip-form"),
  tripStart: $("trip-start"),
  tripEnd: $("trip-end"),
  tripAmount: $("trip-amount"),
  tripCommission: $("trip-commission"),
  tripId: $("trip-id"),
  add15mBtn: $("add-15m-btn"),
  add30mBtn: $("add-30m-btn"),
  calc15CommissionBtn: $("calc-15-commission-btn"),
  fillSampleBtn: $("fill-sample-btn"),
  submitTripBtn: $("submit-trip-btn"),

  toasts: $("toast-container"),
};

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];

/* ---------------- Форматирование чисел и дат ---------------- */

const pad = (n) => String(n).padStart(2, "0");

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // Полдень исключает переход времени
}

function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

const todayStr = () => toDateStr(new Date());
const isValidDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDateStr(s).getTime());

function diffDays(a, b) {
  return Math.round((parseDateStr(a) - parseDateStr(b)) / 86400000);
}

function formatMoney(amount) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatRelativeLabel(dateStr) {
  const diff = diffDays(dateStr, todayStr());
  if (diff === 0) return "Сегодня";
  if (diff === -1) return "Вчера";
  if (diff === 1) return "Завтра";
  const wd = parseDateStr(dateStr).toLocaleDateString("ru-RU", { weekday: "long" });
  return wd.charAt(0).toUpperCase() + wd.slice(1);
}

function formatIsoTime(isoString) {
  return isoString.slice(11, 16);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function updateScrollLock() {
  const isAnyOpen = (el.modalBackdrop && el.modalBackdrop.classList.contains("is-open")) ||
                    (el.calendarModal && el.calendarModal.classList.contains("is-open")) ||
                    (el.receiptModal && el.receiptModal.classList.contains("is-open"));
  document.body.classList.toggle("modal-open", isAnyOpen);
}

function showToast(message, type = "info") {
  // Защита от спама: если такой тост уже отображается, не создаем дубликат
  const existing = Array.from(el.toasts.children).find(
    (t) => t.dataset.message === message
  );
  if (existing) {
    existing.classList.remove("toast-pulse");
    void existing.offsetWidth; // перезапуск анимации
    existing.classList.add("toast-pulse");
    return;
  }

  // Ограничиваем очередь тостов (максимум 2 одновременных)
  while (el.toasts.children.length >= 2) {
    el.toasts.removeChild(el.toasts.firstElementChild);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.dataset.message = message;
  const icon = type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><div>${escapeHtml(message)}</div>`;
  el.toasts.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.25s, transform 0.25s";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

/* ---------------- Смены и даты ---------------- */

const hasTrips = (dateStr) => state.availableDates.includes(dateStr);
const prevShiftDate = (from) => [...state.availableDates].reverse().find((d) => d < from) || null;
const nextShiftDate = (from) => state.availableDates.find((d) => d > from) || null;

function nearestShiftDate(from) {
  const prev = prevShiftDate(from);
  const next = nextShiftDate(from);
  if (!prev) return next;
  if (!next) return prev;
  return Math.abs(diffDays(prev, from)) <= Math.abs(diffDays(next, from)) ? prev : next;
}

async function loadAvailableDates() {
  try {
    const res = await fetch("/api/dates");
    if (res.ok) state.availableDates = await res.json();
  } catch (err) {
    console.error("Ошибка загрузки дат:", err);
  }
}

/* ---------------- Переключение дней ---------------- */

function switchDate(dateStr) {
  if (!isValidDateStr(dateStr)) return;
  state.currentDate = dateStr;

  if (location.hash !== `#${dateStr}`) {
    history.replaceState(null, "", `#${dateStr}`);
  }

  renderDateHeader();
  renderWeekStrip();
  loadDayData(dateStr);
}

function renderDateHeader() {
  const d = state.currentDate;
  const dateObj = parseDateStr(d);
  const dateFormatted = dateObj.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).replace(" г.", "");

  el.dateDisplayText.textContent = dateFormatted;
  el.dateRelativeTag.textContent = formatRelativeLabel(d);

  if (el.todayBtn) {
    el.todayBtn.disabled = d === todayStr();
  }
}

function renderWeekStrip() {
  const current = parseDateStr(state.currentDate);
  const mondayOffset = (current.getDay() + 6) % 7;
  const monday = addDays(state.currentDate, -mondayOffset);
  const today = todayStr();
  const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  el.weekStrip.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const dayStr = addDays(monday, i);
    const dayObj = parseDateStr(dayStr);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "week-day-btn";
    if (dayStr === state.currentDate) btn.classList.add("is-active");
    if (dayStr === today) btn.classList.add("is-today");
    if (hasTrips(dayStr)) btn.classList.add("has-trips");

    btn.setAttribute("aria-label", `${dayNames[i]}, ${dayObj.getDate()}`);
    btn.innerHTML = `
      <span class="wd-name">${dayNames[i]}</span>
      <span class="wd-num">${dayObj.getDate()}</span>
      <span class="wd-dot"></span>
    `;
    btn.addEventListener("click", () => switchDate(dayStr));
    el.weekStrip.appendChild(btn);
  }
}

/* ---------------- Интерактивный календарь на месяц ---------------- */

function openCalendarModal() {
  const d = parseDateStr(state.currentDate || todayStr());
  state.calYear = d.getFullYear();
  state.calMonth = d.getMonth();
  renderCalendarGrid();
  el.calendarModal.classList.add("is-open");
  el.calendarModal.setAttribute("aria-hidden", "false");
  updateScrollLock();
}

function closeCalendarModal() {
  el.calendarModal.classList.remove("is-open");
  el.calendarModal.setAttribute("aria-hidden", "true");
  updateScrollLock();
}

const isCalendarOpen = () => el.calendarModal && el.calendarModal.classList.contains("is-open");

/* ---------------- Фирменный термочек смены (arqa style) ---------------- */

const isReceiptModalOpen = () => el.receiptModal && el.receiptModal.classList.contains("is-open");

function openReceiptModal() {
  if (!state.currentDayData) return;
  const { summary, trips } = state.currentDayData;
  const dParts = state.currentDate.split("-");
  el.receiptDateText.textContent = `${dParts[2]}.${dParts[1]}.${dParts[0]}`;
  el.receiptCount.textContent = summary.trips_count;
  el.receiptRevenue.textContent = `${formatMoney(summary.total_revenue)} ₸`;
  el.receiptCommission.textContent = summary.total_commission > 0 ? `−${formatMoney(summary.total_commission)} ₸` : "0 ₸";
  el.receiptNet.textContent = `${formatMoney(summary.net_payout)} ₸`;
  el.receiptBreakdown.textContent = `Безналичные: ${formatMoney(summary.breakdown.card)} ₸ · Наличные: ${formatMoney(summary.breakdown.cash)} ₸`;
  el.receiptBarcodeCode.textContent = `ARQA-${dParts.join("")}-SHIFT`;

  el.receiptTripsTable.innerHTML = "";
  if (!trips || trips.length === 0) {
    el.receiptTripsTable.innerHTML = `<div style="text-align:center; color:#94A3B8; padding:8px 0; font-size:11px;">Поездок в смене нет</div>`;
  } else {
    trips.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "r-trip-item";
      const payName = t.payment === "card" ? "карта" : "нал";
      row.innerHTML = `
        <span class="r-trip-time">#${i + 1} ${formatIsoTime(t.start)} (${payName})</span>
        <span class="r-trip-sum">${formatMoney(t.amount)} ₸</span>
      `;
      el.receiptTripsTable.appendChild(row);
    });
  }

  el.receiptModal.classList.add("is-open");
  el.receiptModal.setAttribute("aria-hidden", "false");
  updateScrollLock();
}

function closeReceiptModal() {
  el.receiptModal.classList.remove("is-open");
  el.receiptModal.setAttribute("aria-hidden", "true");
  updateScrollLock();
}

function calPrevMonth() {
  if (state.calMonth === 0) {
    state.calMonth = 11;
    state.calYear -= 1;
  } else {
    state.calMonth -= 1;
  }
  renderCalendarGrid();
}

function calNextMonth() {
  if (state.calMonth === 11) {
    state.calMonth = 0;
    state.calYear += 1;
  } else {
    state.calMonth += 1;
  }
  renderCalendarGrid();
}

function renderCalendarGrid() {
  const y = state.calYear;
  const m = state.calMonth;
  el.calendarMonthTitle.textContent = `${monthNames[m]} ${y}`;
  el.calendarGrid.innerHTML = "";

  const firstDay = new Date(y, m, 1);
  let firstDayIndex = firstDay.getDay() - 1;
  if (firstDayIndex === -1) firstDayIndex = 6;

  const daysInCurrentMonth = new Date(y, m + 1, 0).getDate();
  const daysInPrevMonth = new Date(y, m, 0).getDate();

  const today = todayStr();
  const selected = state.currentDate;

  // Дни предыдущего месяца
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevDate = new Date(y, m - 1, dayNum);
    const dateStr = toDateStr(prevDate);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day-cell other-month";
    if (hasTrips(dateStr)) cell.classList.add("has-trips");
    cell.textContent = dayNum;
    cell.addEventListener("click", () => {
      switchDate(dateStr);
      closeCalendarModal();
    });
    el.calendarGrid.appendChild(cell);
  }

  // Дни текущего месяца
  for (let dayNum = 1; dayNum <= daysInCurrentMonth; dayNum++) {
    const dateStr = `${y}-${pad(m + 1)}-${pad(dayNum)}`;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day-cell";
    if (dateStr === selected) cell.classList.add("is-selected");
    if (dateStr === today) cell.classList.add("is-today");
    if (hasTrips(dateStr)) cell.classList.add("has-trips");
    cell.textContent = dayNum;
    cell.addEventListener("click", () => {
      switchDate(dateStr);
      closeCalendarModal();
    });
    el.calendarGrid.appendChild(cell);
  }

  // Завершение сетки днями следующего месяца
  const totalCells = el.calendarGrid.children.length;
  const targetCells = totalCells > 35 ? 42 : (totalCells <= 28 ? 28 : 35);
  const remaining = targetCells - totalCells;
  for (let dayNum = 1; dayNum <= remaining; dayNum++) {
    const nextDate = new Date(y, m + 1, dayNum);
    const dateStr = toDateStr(nextDate);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day-cell other-month";
    if (hasTrips(dateStr)) cell.classList.add("has-trips");
    cell.textContent = dayNum;
    cell.addEventListener("click", () => {
      switchDate(dateStr);
      closeCalendarModal();
    });
    el.calendarGrid.appendChild(cell);
  }
}

/* ---------------- Загрузка данных дня ---------------- */

async function loadDayData(dateStr) {
  const seq = ++state.loadSeq;
  if (state.loadAbort) state.loadAbort.abort();
  state.loadAbort = new AbortController();

  try {
    const res = await fetch(`/api/day?date=${encodeURIComponent(dateStr)}`, {
      signal: state.loadAbort.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (seq !== state.loadSeq) return;

    state.currentDayData = data;
    renderSummary(data.summary);
    renderTrips(data.trips);
  } catch (err) {
    if (err.name === "AbortError") return;
    if (seq === state.loadSeq) {
      showToast("Ошибка загрузки данных: " + err.message, "error");
    }
  }
}

function renderSummary(summary) {
  const { trips_count, total_revenue, total_commission, net_payout, breakdown } = summary;

  // Чистый доход водителю на руки
  el.summaryNet.textContent = formatMoney(net_payout);

  // Выручка
  el.summaryRevenue.textContent = `${formatMoney(total_revenue)} ₸`;
  el.summaryTripsCount.textContent = `${trips_count} ${plural(trips_count, "поездка", "поездки", "поездок")} за смену`;

  // Комиссия
  el.summaryCommission.textContent = total_commission > 0 ? `−${formatMoney(total_commission)} ₸` : "0 ₸";
  const rate = total_revenue > 0 ? Math.round((total_commission / total_revenue) * 100) : 0;
  el.summaryCommissionRate.textContent = `${rate}% от выручки`;

  // Оплата
  el.summaryPaymentsText.textContent = `карта ${formatMoney(breakdown.card)} ₸ · нал ${formatMoney(breakdown.cash)} ₸`;

  const total = breakdown.card + breakdown.cash;
  if (total > 0) {
    const cardPct = (breakdown.card / total) * 100;
    const cashPct = (breakdown.cash / total) * 100;
    el.splitBarCard.style.width = `${cardPct}%`;
    el.splitBarCash.style.width = `${cashPct}%`;
  } else {
    el.splitBarCard.style.width = "50%";
    el.splitBarCash.style.width = "50%";
  }

  el.tripsCountBadge.textContent = trips_count;
  el.summaryStatusBadge.textContent = trips_count > 0 ? `${trips_count} ${plural(trips_count, "поездка", "поездки", "поездок")}` : "Смена пустая";
}

function renderTrips(trips) {
  el.tripsList.innerHTML = "";

  if (!trips || trips.length === 0) {
    const nearest = nearestShiftDate(state.currentDate);
    const jumpBtnHtml = nearest
      ? `<button type="button" class="btn-secondary" id="jump-nearest-btn">Перейти к смене ${nearest.split("-").reverse().slice(0, 2).join(".")}</button>`
      : "";

    el.tripsList.innerHTML = `
      <div class="empty-shift-box">
        <span class="empty-shift-icon">🛋️</span>
        <h4 class="empty-shift-title">В этот день поездок нет</h4>
        <p class="empty-shift-desc">Водитель не выходил на смену или заказы ещё не внесены.</p>
        <div class="empty-shift-actions">
          ${jumpBtnHtml}
          <button type="button" class="btn-cta" id="empty-add-btn">+ Добавить поездку</button>
        </div>
      </div>
    `;

    if (nearest) {
      $("jump-nearest-btn")?.addEventListener("click", () => switchDate(nearest));
    }
    $("empty-add-btn")?.addEventListener("click", openAddModal);
    return;
  }

  trips.forEach((trip) => {
    const startTime = formatIsoTime(trip.start);
    const endTime = formatIsoTime(trip.end);
    const durationMin = Math.max(1, Math.round((new Date(trip.end) - new Date(trip.start)) / 60000));
    const isCard = trip.payment === "card";
    const netTrip = trip.amount - trip.commission;
    const commPct = trip.amount > 0 ? Math.round((trip.commission / trip.amount) * 100) : 0;

    const card = document.createElement("div");
    card.className = "trip-item-card";
    card.innerHTML = `
      <div class="trip-card-summary">
        <div class="trip-col-left">
          <div class="trip-taxi-badge">🚕</div>
          <div>
            <div class="trip-time-title">${startTime} → ${endTime}</div>
            <div class="trip-meta-tags">
              <span>⏱️ ${durationMin} мин</span>
              <span>·</span>
              <span>ID: <code>${escapeHtml(trip.id)}</code></span>
            </div>
          </div>
        </div>
        <div class="trip-col-right">
          <div class="trip-amount-text">${formatMoney(trip.amount)} ₸</div>
          <div class="trip-pill-group">
            <span class="badge-pay ${isCard ? "card" : "cash"}">
              ${isCard ? "💳 Карта" : "💵 Наличные"}
            </span>
            <span class="badge-fee">ком. −${formatMoney(trip.commission)} ₸</span>
            <span class="trip-expand-chevron">▾</span>
          </div>
        </div>
      </div>
      <div class="trip-card-details">
        <div class="trip-details-grid">
          <div class="detail-item">
            <span class="detail-label">На руки за заказ:</span>
            <span class="detail-value text-accent-emerald">${formatMoney(netTrip)} ₸</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Тариф заказа:</span>
            <span class="detail-value">${formatMoney(trip.amount)} ₸</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Комиссия сервиса:</span>
            <span class="detail-value text-accent-red">−${formatMoney(trip.commission)} ₸ (${commPct}%)</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Длительность:</span>
            <span class="detail-value font-mono">${startTime} – ${endTime} (${durationMin} мин)</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Способ расчета:</span>
            <span class="detail-value">${isCard ? "Безналичный (на карту)" : "Наличными водителю"}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">ID поездки:</span>
            <span class="detail-value font-mono">${escapeHtml(trip.id)}</span>
          </div>
        </div>
      </div>
    `;

    // Клик по карточке раскрывает подробности
    card.addEventListener("click", () => {
      card.classList.toggle("is-expanded");
    });

    el.tripsList.appendChild(card);
  });
}

/* ---------------- Модальное окно добавления поездки ---------------- */

const toInputDateTime = (d) => `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function openAddModal() {
  const now = new Date();
  const start = parseDateStr(state.currentDate || todayStr());
  start.setHours(now.getHours(), now.getMinutes(), 0, 0);
  const end = new Date(start.getTime() + 25 * 60000);

  el.tripStart.value = toInputDateTime(start);
  el.tripEnd.value = toInputDateTime(end);
  el.tripAmount.value = "2500";
  el.tripCommission.value = "375";
  el.tripId.value = "";
  el.form.querySelector('input[name="payment"][value="card"]').checked = true;

  el.modalBackdrop.classList.add("is-open");
  el.modalBackdrop.setAttribute("aria-hidden", "false");
  updateScrollLock();
  setTimeout(() => el.tripAmount.focus(), 60);
}

function closeAddModal() {
  el.modalBackdrop.classList.remove("is-open");
  el.modalBackdrop.setAttribute("aria-hidden", "true");
  updateScrollLock();
}

const isAddModalOpen = () => el.modalBackdrop && el.modalBackdrop.classList.contains("is-open");

function calcCommission() {
  const amount = parseFloat(el.tripAmount.value) || 0;
  if (amount > 0) {
    el.tripCommission.value = Math.round(amount * 0.15);
  }
}

function addDurationToEnd(minutes) {
  if (!el.tripStart.value) return;
  const start = new Date(el.tripStart.value);
  const newEnd = new Date(start.getTime() + minutes * 60000);
  el.tripEnd.value = toInputDateTime(newEnd);
}

function fillSampleData() {
  // Заполняем эталонную поездку t1 из ТЗ (2026-10-01)
  el.tripStart.value = "2026-10-01T08:10";
  el.tripEnd.value = "2026-10-01T08:32";
  el.tripAmount.value = "2400";
  el.tripCommission.value = "360";
  el.tripId.value = "t1";
  el.form.querySelector('input[name="payment"][value="card"]').checked = true;
  showToast("Заполнен пример t1 из ТЗ. Отправьте форму для проверки защиты от дублей!", "info");
}

function formatServerError(data) {
  if (!data) return "Неизвестная ошибка";
  const detail = data.detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => String(e.msg || "").replace(/^Value error,\s*/, "")).join("; ");
  }
  if (detail && typeof detail === "object") {
    return detail.message || JSON.stringify(detail);
  }
  return String(detail || data);
}

async function handleTripSubmit(e) {
  e.preventDefault();
  if (state.submitting) return;

  const startVal = el.tripStart.value;
  const endVal = el.tripEnd.value;
  const amountVal = parseFloat(el.tripAmount.value);
  const commissionVal = parseFloat(el.tripCommission.value) || 0;
  const paymentVal = el.form.querySelector('input[name="payment"]:checked').value;
  const idVal = el.tripId.value.trim();

  // Клиентская валидация
  if (!(amountVal > 0)) {
    showToast("Сумма поездки должна быть строго больше 0", "error");
    return;
  }
  if (!startVal || !endVal || new Date(endVal) <= new Date(startVal)) {
    showToast("Время окончания должно быть позже времени начала", "error");
    return;
  }
  if (commissionVal < 0 || commissionVal > amountVal) {
    showToast("Комиссия должна быть от 0 до суммы поездки", "error");
    return;
  }

  const payload = {
    start: `${startVal}:00${TZ_OFFSET}`,
    end: `${endVal}:00${TZ_OFFSET}`,
    amount: amountVal,
    commission: commissionVal,
    payment: paymentVal,
  };
  if (idVal) payload.id = idVal;

  const headers = { "Content-Type": "application/json" };
  const idemKey = idVal || `idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  headers["Idempotency-Key"] = idemKey;

  state.submitting = true;
  el.submitTripBtn.disabled = true;

  try {
    const res = await fetch("/api/trips", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);

    if (res.status === 201) {
      showToast(`Поездка добавлена: ${formatMoney(body.amount)} ₸`, "success");
      closeAddModal();
      await loadAvailableDates();
      switchDate(body.start.slice(0, 10));
    } else if (res.status === 200) {
      // Идемпотентность
      showToast(`Поездка уже сохранена ранее (ID: ${body.id}) — дубль не создан`, "info");
      closeAddModal();
      await loadAvailableDates();
      switchDate(body.start.slice(0, 10));
    } else if (res.status === 409) {
      showToast(formatServerError(body), "error");
    } else if (res.status === 422) {
      showToast("Ошибка данных: " + formatServerError(body), "error");
    } else {
      showToast(`Ошибка сохранения (HTTP ${res.status})`, "error");
    }
  } catch (err) {
    showToast("Ошибка сети при отправке: " + err.message, "error");
  } finally {
    state.submitting = false;
    el.submitTripBtn.disabled = false;
  }
}

/* ---------------- Переключение темы (Тёмная / Светлая) ---------------- */

function initTheme() {
  const saved = localStorage.getItem("arqa-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("arqa-theme", next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const icon = el.themeToggleBtn.querySelector(".theme-icon");
  if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";
}

/* ---------------- Слушатели событий ---------------- */

function setupEventListeners() {
  el.themeToggleBtn.addEventListener("click", toggleTheme);

  el.prevDayBtn.addEventListener("click", () => switchDate(addDays(state.currentDate, -1)));
  el.nextDayBtn.addEventListener("click", () => switchDate(addDays(state.currentDate, 1)));

  // Открытие календаря по клику на дату или на кнопку
  el.dateDisplayBtn.addEventListener("click", openCalendarModal);
  el.openCalendarBtn.addEventListener("click", openCalendarModal);
  el.todayBtn.addEventListener("click", () => switchDate(todayStr()));

  // Календарь модалка
  el.calendarCloseBtn.addEventListener("click", closeCalendarModal);
  el.calendarModal.addEventListener("click", (e) => {
    if (e.target === el.calendarModal) closeCalendarModal();
  });
  el.calPrevMonthBtn.addEventListener("click", calPrevMonth);
  el.calNextMonthBtn.addEventListener("click", calNextMonth);
  el.calTodayBtn.addEventListener("click", () => {
    switchDate(todayStr());
    closeCalendarModal();
  });

  // Модалка фирменного чека смены (arqa style)
  el.openReceiptBtn.addEventListener("click", openReceiptModal);
  el.receiptCloseBtn.addEventListener("click", closeReceiptModal);
  el.receiptModal.addEventListener("click", (e) => {
    if (e.target === el.receiptModal) closeReceiptModal();
  });
  el.receiptPrintBtn.addEventListener("click", () => {
    window.print();
  });

  // Модалка добавления поездки
  el.openModalBtn.addEventListener("click", openAddModal);
  el.modalCloseBtn.addEventListener("click", closeAddModal);
  el.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === el.modalBackdrop) closeAddModal();
  });

  el.tripAmount.addEventListener("input", calcCommission);
  el.calc15CommissionBtn.addEventListener("click", calcCommission);
  el.add15mBtn.addEventListener("click", () => addDurationToEnd(15));
  el.add30mBtn.addEventListener("click", () => addDurationToEnd(30));
  el.fillSampleBtn.addEventListener("click", fillSampleData);
  el.form.addEventListener("submit", handleTripSubmit);

  // Горячие клавиши
  document.addEventListener("keydown", (e) => {
    if (isAddModalOpen()) {
      if (e.key === "Escape") closeAddModal();
      return;
    }
    if (isCalendarOpen()) {
      if (e.key === "Escape") closeCalendarModal();
      return;
    }
    if (isReceiptModalOpen()) {
      if (e.key === "Escape") closeReceiptModal();
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      switchDate(addDays(state.currentDate, -1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      switchDate(addDays(state.currentDate, 1));
    }
  });

  // Хэш в адресной строке
  window.addEventListener("hashchange", () => {
    const d = location.hash.slice(1);
    if (isValidDateStr(d) && d !== state.currentDate) {
      switchDate(d);
    }
  });
}

function pickInitialDate() {
  const fromHash = location.hash.slice(1);
  if (isValidDateStr(fromHash)) return fromHash;
  // По умолчанию открываем дату примера из ТЗ если есть
  if (hasTrips("2026-10-01")) return "2026-10-01";
  const today = todayStr();
  if (hasTrips(today)) return today;
  if (state.availableDates.length) return state.availableDates[0];
  return today;
}

async function init() {
  initTheme();
  setupEventListeners();
  await loadAvailableDates();
  switchDate(pickInitialDate());
}

document.addEventListener("DOMContentLoaded", init);
