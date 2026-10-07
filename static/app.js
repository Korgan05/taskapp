/**
 * Дневник смен водителя — фронтенд клиент
 * 
 * Логика работы:
 * - Все даты обрабатываются по локальному календарю (YYYY-MM-DD), исключая сдвиги UTC.
 * - При первой загрузке открывается дата из ТЗ (2026-10-01) или ближайшая рабочая смена.
 * - Полная поддержка клавиатуры (←/→ для дней, Shift+←/→ для смен, Esc для модалки).
 */

const TZ_OFFSET = "+05:00"; // Локальный часовой пояс водителя (Казахстан / Алматы)

const state = {
  currentDate: null,
  availableDates: [],
  loadSeq: 0,
  loadAbort: null,
  submitting: false,
};

const $ = (id) => document.getElementById(id);

const el = {
  prevDayBtn: $("prev-day-btn"),
  nextDayBtn: $("next-day-btn"),
  dateDisplayBtn: $("date-display-btn"),
  dateDisplayText: $("date-display-text"),
  dateRelativeTag: $("date-relative-tag"),
  datePickerInput: $("date-picker-input"),
  weekStrip: $("week-strip"),
  prevShiftBtn: $("prev-shift-btn"),
  todayBtn: $("today-btn"),
  nextShiftBtn: $("next-shift-btn"),

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

/* ---------------- Форматирование чисел и дат ---------------- */

const pad = (n) => String(n).padStart(2, "0");

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // Полдень исключает переход на летнее/зимнее время
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

function formatTenge(amount) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(amount) + " ₸";
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
  // Берём время строго из строки ISO (например: 2026-10-01T08:10:00+05:00 -> 08:10)
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

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><div>${escapeHtml(message)}</div>`;
  el.toasts.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.25s, transform 0.25s";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 250);
  }, 4000);
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
    console.error("Ошибка загрузки доступных дат:", err);
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
  el.datePickerInput.value = d;
  
  const dateObj = parseDateStr(d);
  const dateFormatted = dateObj.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).replace(" г.", "");

  el.dateDisplayText.textContent = dateFormatted;
  el.dateRelativeTag.textContent = formatRelativeLabel(d);

  const prev = prevShiftDate(d);
  const next = nextShiftDate(d);
  el.prevShiftBtn.disabled = !prev;
  el.nextShiftBtn.disabled = !next;
  el.todayBtn.disabled = d === todayStr();

  el.prevShiftBtn.title = prev ? `К смене ${prev.split("-").reverse().join(".")}` : "Раньше смен нет";
  el.nextShiftBtn.title = next ? `К смене ${next.split("-").reverse().join(".")}` : "Позже смен нет";
}

function renderWeekStrip() {
  const current = parseDateStr(state.currentDate);
  const mondayOffset = (current.getDay() + 6) % 7; // Понедельник = 0
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

function openCalendarPicker() {
  if (typeof el.datePickerInput.showPicker === "function") {
    try {
      el.datePickerInput.showPicker();
      return;
    } catch (_) {}
  }
  el.datePickerInput.click();
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

    renderSummary(data.summary);
    renderTrips(data.trips);
  } catch (err) {
    if (err.name === "AbortError") return;
    if (seq === state.loadSeq) {
      showToast("Ошибка загрузки данных за день: " + err.message, "error");
    }
  }
}

function renderSummary(summary) {
  const { trips_count, total_revenue, total_commission, net_payout, breakdown } = summary;

  el.summaryNet.textContent = formatTenge(net_payout);
  el.summaryRevenue.textContent = formatTenge(total_revenue);
  el.summaryTripsCount.textContent = `${trips_count} ${plural(trips_count, "поездка", "поездки", "поездок")}`;
  el.summaryCommission.textContent = total_commission > 0 ? `−${formatTenge(total_commission)}` : "0 ₸";

  const rate = total_revenue > 0 ? Math.round((total_commission / total_revenue) * 100) : 0;
  el.summaryCommissionRate.textContent = `${rate}% от выручки`;

  el.summaryPaymentsText.textContent = `${formatTenge(breakdown.card)} (карта) · ${formatTenge(breakdown.cash)} (нал)`;

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
  el.summaryStatusBadge.style.background = trips_count > 0 ? "var(--color-success-soft)" : "var(--bg-page)";
  el.summaryStatusBadge.style.color = trips_count > 0 ? "var(--color-success)" : "var(--text-muted)";
}

function renderTrips(trips) {
  el.tripsList.innerHTML = "";

  if (!trips || trips.length === 0) {
    const nearest = nearestShiftDate(state.currentDate);
    const jumpBtnHtml = nearest
      ? `<button type="button" class="btn btn-secondary btn-sm" id="jump-nearest-btn">Перейти к смене ${nearest.split("-").reverse().slice(0, 2).join(".")}</button>`
      : "";

    el.tripsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">☕</span>
        <h4 class="empty-title">В этот день поездок нет</h4>
        <p class="empty-desc">Водитель не выходил на линию или смена ещё не заполнена.</p>
        <div style="display:flex; justify-content:center; gap:8px;">
          ${jumpBtnHtml}
          <button type="button" class="btn btn-primary btn-sm" id="empty-add-btn">+ Добавить поездку</button>
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

    const card = document.createElement("div");
    card.className = "trip-card";
    card.innerHTML = `
      <div class="trip-left">
        <div class="trip-interval">${startTime} → ${endTime}</div>
        <div class="trip-meta">
          <span>⏱️ ${durationMin} мин</span>
          <span>·</span>
          <span>ID: <code>${escapeHtml(trip.id)}</code></span>
        </div>
      </div>
      <div class="trip-right">
        <div class="trip-amount">${formatTenge(trip.amount)}</div>
        <div class="trip-tags">
          <span class="tag-payment ${isCard ? "card" : "cash"}">
            ${isCard ? "💳 Карта" : "💵 Наличные"}
          </span>
          <span class="tag-commission">ком. −${formatTenge(trip.commission)}</span>
        </div>
      </div>
    `;
    el.tripsList.appendChild(card);
  });
}

/* ---------------- Модальное окно ---------------- */

const toInputDateTime = (d) => `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function openAddModal() {
  const now = new Date();
  const start = parseDateStr(state.currentDate);
  start.setHours(now.getHours(), now.getMinutes(), 0, 0);
  const end = new Date(start.getTime() + 25 * 60000); // +25 минут по умолчанию

  el.tripStart.value = toInputDateTime(start);
  el.tripEnd.value = toInputDateTime(end);
  el.tripAmount.value = "2500";
  el.tripCommission.value = "375";
  el.tripId.value = "";
  el.form.querySelector('input[name="payment"][value="card"]').checked = true;

  el.modalBackdrop.classList.add("is-open");
  el.modalBackdrop.setAttribute("aria-hidden", "false");
  setTimeout(() => el.tripAmount.focus(), 60);
}

function closeAddModal() {
  el.modalBackdrop.classList.remove("is-open");
  el.modalBackdrop.setAttribute("aria-hidden", "true");
}

const isModalOpen = () => el.modalBackdrop.classList.contains("is-open");

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
  showToast("Заполнена поездка t1 из ТЗ. При сохранении проверится защита от дублей!", "info");
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

  state.submitting = true;
  el.submitTripBtn.disabled = true;

  try {
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);

    if (res.status === 201) {
      showToast(`Поездка добавлена: ${formatTenge(body.amount)}`, "success");
      closeAddModal();
      await loadAvailableDates();
      switchDate(body.start.slice(0, 10));
    } else if (res.status === 200) {
      // Идемпотентность сработала!
      showToast(`Поездка уже была сохранена ранее (ID: ${body.id}) — дубль не создан`, "info");
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

/* ---------------- Слушатели событий ---------------- */

function setupEventListeners() {
  el.prevDayBtn.addEventListener("click", () => switchDate(addDays(state.currentDate, -1)));
  el.nextDayBtn.addEventListener("click", () => switchDate(addDays(state.currentDate, 1)));
  el.prevShiftBtn.addEventListener("click", () => {
    const d = prevShiftDate(state.currentDate);
    if (d) switchDate(d);
  });
  el.nextShiftBtn.addEventListener("click", () => {
    const d = nextShiftDate(state.currentDate);
    if (d) switchDate(d);
  });
  el.todayBtn.addEventListener("click", () => switchDate(todayStr()));

  el.dateDisplayBtn.addEventListener("click", openCalendarPicker);
  el.datePickerInput.addEventListener("change", (e) => {
    if (e.target.value) switchDate(e.target.value);
  });

  // Горячие клавиши
  document.addEventListener("keydown", (e) => {
    if (isModalOpen()) {
      if (e.key === "Escape") closeAddModal();
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (e.shiftKey) {
        const d = prevShiftDate(state.currentDate);
        if (d) switchDate(d);
      } else {
        switchDate(addDays(state.currentDate, -1));
      }
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (e.shiftKey) {
        const d = nextShiftDate(state.currentDate);
        if (d) switchDate(d);
      } else {
        switchDate(addDays(state.currentDate, 1));
      }
    }
  });

  // Хэш в адресной строке
  window.addEventListener("hashchange", () => {
    const d = location.hash.slice(1);
    if (isValidDateStr(d) && d !== state.currentDate) {
      switchDate(d);
    }
  });

  // Модалка
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
}

function pickInitialDate() {
  const fromHash = location.hash.slice(1);
  if (isValidDateStr(fromHash)) return fromHash;
  // Сначала проверяем дату примера из ТЗ
  if (hasTrips("2026-10-01")) return "2026-10-01";
  const today = todayStr();
  if (hasTrips(today)) return today;
  if (state.availableDates.length) return state.availableDates[0];
  return today;
}

async function init() {
  setupEventListeners();
  await loadAvailableDates();
  switchDate(pickInitialDate());
}

document.addEventListener("DOMContentLoaded", init);
