/**
 * Дневник смен водителя — клиент.
 *
 * Даты дней везде хранятся строками "YYYY-MM-DD" и считаются по локальному
 * календарю, без toISOString() — иначе в UTC+5 полночь превращается
 * в 19:00 предыдущего дня и навигация «залипает».
 */

const TZ_OFFSET = "+05:00"; // часовой пояс водителя (Алматы) для новых поездок

const state = {
  currentDate: null,
  availableDates: [], // отсортированный список дат, где есть поездки
  isDesktopMode: false,
  loadSeq: 0,          // номер последнего запроса — ответы старых запросов игнорируем
  loadAbort: null,
  submitting: false,
};

const $ = (id) => document.getElementById(id);

const el = {
  appLayout: document.querySelector(".app-layout"),
  mainWrapper: $("main-wrapper"),
  phoneFrame: $("phone-frame"),
  viewModeToggle: $("view-mode-toggle"),
  statusClock: $("status-clock"),

  prevDayBtn: $("prev-day-btn"),
  nextDayBtn: $("next-day-btn"),
  dateDisplayBtn: $("date-display-btn"),
  datePickerInput: $("date-picker-input"),
  dateDisplayText: $("date-display-text"),
  dateRelativeTag: $("date-relative-tag"),
  weekStrip: $("week-strip"),
  prevShiftBtn: $("prev-shift-btn"),
  nextShiftBtn: $("next-shift-btn"),
  todayBtn: $("today-btn"),

  receipt: $("shift-receipt"),
  receiptDateLabel: $("receipt-date-label"),
  receiptMiniTrips: $("receipt-mini-trips"),
  receiptTripsCount: $("receipt-trips-count"),
  receiptTotalRevenue: $("receipt-total-revenue"),
  receiptTotalCommission: $("receipt-total-commission"),
  receiptPaymentSplit: $("receipt-payment-split"),
  receiptNetPayout: $("receipt-net-payout"),

  cardNet: $("card-net"),
  cardRevenue: $("card-revenue"),
  cardTripsCount: $("card-trips-count"),
  cardCommission: $("card-commission"),
  cardCommissionRate: $("card-commission-rate"),
  cardCash: $("card-cash"),
  cardCard: $("card-card"),
  splitProgressCash: $("split-progress-cash"),
  splitProgressCard: $("split-progress-card"),

  tripsCountBadge: $("trips-count-badge"),
  tripsList: $("trips-list-container"),

  openModalBtn: $("open-add-modal-btn"),
  modal: $("add-trip-modal"),
  modalCloseBtn: $("modal-close-btn"),
  form: $("add-trip-form"),
  tripStart: $("trip-start"),
  tripEnd: $("trip-end"),
  tripAmount: $("trip-amount"),
  tripCommission: $("trip-commission"),
  tripId: $("trip-id"),
  add15mBtn: $("add-15m-btn"),
  add30mBtn: $("add-30m-btn"),
  calcCommissionBtn: $("calc-15-commission-btn"),
  fillSampleBtn: $("fill-sample-btn"),
  submitBtn: $("submit-trip-btn"),

  toasts: $("toast-container"),
};

/* ---------------- утилиты дат ---------------- */

const pad = (n) => String(n).padStart(2, "0");

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Полдень выбранного дня — защищает от сдвигов на переходах часовых поясов. */
function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
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

function relativeLabel(dateStr) {
  const diff = diffDays(dateStr, todayStr());
  if (diff === 0) return "Сегодня";
  if (diff === -1) return "Вчера";
  if (diff === 1) return "Завтра";
  const wd = parseDateStr(dateStr).toLocaleDateString("ru-RU", { weekday: "long" });
  return wd.charAt(0).toUpperCase() + wd.slice(1);
}

/** Время берём прямо из строки ISO — это время водителя, а не браузера. */
const timeFromIso = (iso) => iso.slice(11, 16);

/* ---------------- утилиты форматирования ---------------- */

function formatTenge(amount) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount) + " ₸";
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><div>${escapeHtml(message)}</div>`;
  el.toasts.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity .3s, transform .3s";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ---------------- смены (даты с поездками) ---------------- */

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

/* ---------------- навигация ---------------- */

function switchDate(dateStr) {
  if (!isValidDateStr(dateStr)) return;
  state.currentDate = dateStr;

  // Сохраняем день в адресе: F5 и «Назад» не сбрасывают выбор
  if (location.hash !== `#${dateStr}`) history.replaceState(null, "", `#${dateStr}`);

  renderNavigator();
  loadDayData(dateStr);
}

function renderNavigator() {
  const d = state.currentDate;
  el.datePickerInput.value = d;
  el.dateDisplayText.textContent = parseDateStr(d).toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  }).replace(" г.", "");
  el.dateRelativeTag.textContent = relativeLabel(d);
  el.receiptDateLabel.textContent = d.split("-").reverse().join(".");

  const prev = prevShiftDate(d);
  const next = nextShiftDate(d);
  el.prevShiftBtn.disabled = !prev;
  el.nextShiftBtn.disabled = !next;
  el.prevShiftBtn.title = prev ? `Перейти к ${prev.split("-").reverse().join(".")}` : "Раньше смен нет";
  el.nextShiftBtn.title = next ? `Перейти к ${next.split("-").reverse().join(".")}` : "Позже смен нет";
  el.todayBtn.disabled = d === todayStr();

  renderWeekStrip();
}

function renderWeekStrip() {
  const current = parseDateStr(state.currentDate);
  const mondayOffset = (current.getDay() + 6) % 7; // 0 = понедельник
  const monday = addDays(state.currentDate, -mondayOffset);
  const today = todayStr();
  const names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  el.weekStrip.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const ds = addDays(monday, i);
    const date = parseDateStr(ds);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "week-day";
    if (ds === state.currentDate) btn.classList.add("is-active");
    if (ds === today) btn.classList.add("is-today");
    if (hasTrips(ds)) btn.classList.add("has-trips");
    if (date.getMonth() !== current.getMonth()) btn.classList.add("is-other-month");
    btn.setAttribute("aria-label", date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) + (hasTrips(ds) ? ", есть поездки" : ""));
    btn.innerHTML = `<span class="wd-name">${names[i]}</span><span class="wd-num">${date.getDate()}</span><span class="wd-dot"></span>`;
    btn.addEventListener("click", () => switchDate(ds));
    el.weekStrip.appendChild(btn);
  }
}

function openDatePicker() {
  const input = el.datePickerInput;
  if (typeof input.showPicker === "function") {
    try { input.showPicker(); return; } catch (_) { /* fallthrough */ }
  }
  input.focus();
  input.click();
}

/* ---------------- данные дня ---------------- */

async function loadDayData(dateStr) {
  const seq = ++state.loadSeq;
  if (state.loadAbort) state.loadAbort.abort();
  state.loadAbort = new AbortController();
  el.appLayout.classList.add("is-loading");

  try {
    const res = await fetch(`/api/day?date=${encodeURIComponent(dateStr)}`, { signal: state.loadAbort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (seq !== state.loadSeq) return; // пока ждали, пользователь уже переключил день
    renderSummary(data.summary);
    renderTrips(data.trips);
    reprintReceipt();
  } catch (err) {
    if (err.name === "AbortError") return;
    if (seq === state.loadSeq) showToast("Не удалось загрузить данные дня: " + err.message, "error");
  } finally {
    if (seq === state.loadSeq) el.appLayout.classList.remove("is-loading");
  }
}

function reprintReceipt() {
  el.receipt.style.animation = "none";
  void el.receipt.offsetHeight; // перезапуск CSS-анимации «печати» чека
  el.receipt.style.animation = "";
}

function renderSummary(s) {
  const { trips_count, total_revenue, total_commission, net_payout, breakdown } = s;

  el.receiptTripsCount.textContent = trips_count;
  el.receiptTotalRevenue.textContent = formatTenge(total_revenue);
  el.receiptTotalCommission.textContent = total_commission > 0 ? `−${formatTenge(total_commission)}` : "0 ₸";
  el.receiptPaymentSplit.textContent = `${formatTenge(breakdown.cash)} / ${formatTenge(breakdown.card)}`;
  el.receiptNetPayout.textContent = formatTenge(net_payout);

  el.cardNet.textContent = formatTenge(net_payout);
  el.cardRevenue.textContent = formatTenge(total_revenue);
  el.cardTripsCount.textContent = `${trips_count} ${plural(trips_count, "поездка", "поездки", "поездок")}`;
  el.cardCommission.textContent = formatTenge(total_commission);
  const rate = total_revenue > 0 ? Math.round((total_commission / total_revenue) * 100) : 0;
  el.cardCommissionRate.textContent = `${rate}% от выручки`;
  el.cardCash.textContent = formatTenge(breakdown.cash);
  el.cardCard.textContent = formatTenge(breakdown.card);

  const total = breakdown.cash + breakdown.card;
  el.splitProgressCash.style.width = total > 0 ? `${(breakdown.cash / total) * 100}%` : "50%";
  el.splitProgressCard.style.width = total > 0 ? `${(breakdown.card / total) * 100}%` : "50%";

  el.tripsCountBadge.textContent = trips_count;
}

function renderTrips(trips) {
  el.receiptMiniTrips.innerHTML = "";
  el.tripsList.innerHTML = "";

  if (!trips.length) {
    el.receiptMiniTrips.innerHTML = `<div class="receipt-row muted" style="justify-content:center;padding:6px 0;"><span>В этот день поездок нет</span></div>`;

    const nearest = nearestShiftDate(state.currentDate);
    const jump = nearest
      ? `<button type="button" class="btn-primary btn-sm empty-jump-btn" id="jump-nearest-btn">Ближайшая смена · ${nearest.split("-").reverse().slice(0, 2).join(".")}</button>`
      : "";
    el.tripsList.innerHTML = `
      <div class="trips-empty-state">
        <span class="icon">🛋️</span>
        <h4>В этот день поездок нет</h4>
        <p>Добавьте поездку кнопкой «+ Новая поездка»${nearest ? " или перейдите к ближайшей смене" : ""}</p>
        ${jump}
      </div>`;
    if (nearest) $("jump-nearest-btn").addEventListener("click", () => switchDate(nearest));
    return;
  }

  for (const trip of trips) {
    const payLabel = trip.payment === "card" ? "карта" : "нал.";
    const row = document.createElement("div");
    row.className = "receipt-row";
    row.innerHTML = `<span>${timeFromIso(trip.start)}–${timeFromIso(trip.end)} ${payLabel}</span><strong>${formatTenge(trip.amount)}</strong>`;
    el.receiptMiniTrips.appendChild(row);

    const minutes = Math.max(1, Math.round((new Date(trip.end) - new Date(trip.start)) / 60000));
    const card = document.createElement("div");
    card.className = "trip-card";
    card.innerHTML = `
      <div class="trip-time-info">
        <div class="trip-time-interval">${timeFromIso(trip.start)} → ${timeFromIso(trip.end)}</div>
        <div class="trip-duration-tag">⏱️ ${minutes} мин · ID: <code>${escapeHtml(trip.id)}</code></div>
      </div>
      <div class="trip-financial-info">
        <div class="trip-amount-val">${formatTenge(trip.amount)}</div>
        <div class="trip-badge-row">
          <span class="badge-payment ${trip.payment === "card" ? "card" : "cash"}">${trip.payment === "card" ? "💳 Карта" : "💵 Наличные"}</span>
          <span class="badge-comm">ком. −${formatTenge(trip.commission)}</span>
        </div>
      </div>`;
    el.tripsList.appendChild(card);
  }
}

/* ---------------- добавление поездки ---------------- */

const toInputValue = (d) => `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function openAddModal() {
  const now = new Date();
  const start = parseDateStr(state.currentDate);
  start.setHours(now.getHours(), now.getMinutes(), 0, 0);
  const end = new Date(start.getTime() + 25 * 60000);

  el.tripStart.value = toInputValue(start);
  el.tripEnd.value = toInputValue(end);
  el.tripAmount.value = "2500";
  el.tripCommission.value = "375";
  el.tripId.value = "";
  el.form.querySelector('input[name="payment"][value="card"]').checked = true;

  el.modal.classList.add("active");
  el.modal.setAttribute("aria-hidden", "false");
  setTimeout(() => el.tripAmount.focus(), 50);
}

function closeAddModal() {
  el.modal.classList.remove("active");
  el.modal.setAttribute("aria-hidden", "true");
}

const isModalOpen = () => el.modal.classList.contains("active");

function calcCommission() {
  const amount = parseFloat(el.tripAmount.value) || 0;
  if (amount > 0) el.tripCommission.value = Math.round(amount * 0.15);
}

function addDurationToEnd(minutes) {
  if (!el.tripStart.value) return;
  const start = new Date(el.tripStart.value);
  el.tripEnd.value = toInputValue(new Date(start.getTime() + minutes * 60000));
}

/** Поездка t1 из ТЗ — она уже есть в данных, поэтому отправка покажет защиту от дублей. */
function fillSampleData() {
  el.tripStart.value = "2026-10-01T08:10";
  el.tripEnd.value = "2026-10-01T08:32";
  el.tripAmount.value = "2400";
  el.tripCommission.value = "360";
  el.tripId.value = "t1";
  el.form.querySelector('input[name="payment"][value="card"]').checked = true;
  showToast("Заполнена поездка t1 из ТЗ — она уже есть, попробуйте отправить", "info");
}

function serverErrorText(body) {
  const detail = body && body.detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => String(e.msg || "").replace(/^Value error,\s*/, "")).join("; ");
  }
  if (detail && typeof detail === "object") return detail.message || JSON.stringify(detail);
  return detail || "Неизвестная ошибка";
}

async function handleTripSubmit(e) {
  e.preventDefault();
  if (state.submitting) return; // защита от двойного клика ещё до сервера

  const amount = parseFloat(el.tripAmount.value);
  const commission = parseFloat(el.tripCommission.value) || 0;
  const startVal = el.tripStart.value;
  const endVal = el.tripEnd.value;

  if (!(amount > 0)) return showToast("Сумма поездки должна быть больше нуля", "error");
  if (!startVal || !endVal || new Date(endVal) <= new Date(startVal)) {
    return showToast("Окончание поездки должно быть позже начала", "error");
  }
  if (commission > amount) return showToast("Комиссия не может быть больше суммы", "error");

  const payload = {
    start: `${startVal}:00${TZ_OFFSET}`,
    end: `${endVal}:00${TZ_OFFSET}`,
    amount,
    commission,
    payment: el.form.querySelector('input[name="payment"]:checked').value,
  };
  const id = el.tripId.value.trim();
  if (id) payload.id = id;

  state.submitting = true;
  el.submitBtn.disabled = true;
  try {
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);

    if (res.status === 201 || res.status === 200) {
      if (res.status === 201) {
        showToast(`Поездка добавлена: ${formatTenge(body.amount)}`, "success");
      } else {
        showToast(`Такая поездка уже есть (ID ${body.id}) — дубль не создан`, "info");
      }
      closeAddModal();
      await loadAvailableDates();
      switchDate(body.start.slice(0, 10));
    } else if (res.status === 409) {
      showToast(serverErrorText(body), "error");
    } else if (res.status === 422) {
      showToast("Проверьте данные: " + serverErrorText(body), "error");
    } else {
      showToast(`Не удалось сохранить поездку (HTTP ${res.status})`, "error");
    }
  } catch (err) {
    showToast("Нет связи с сервером: " + err.message, "error");
  } finally {
    state.submitting = false;
    el.submitBtn.disabled = false;
  }
}

/* ---------------- прочее ---------------- */

function toggleViewMode() {
  state.isDesktopMode = !state.isDesktopMode;
  el.mainWrapper.classList.toggle("desktop-mode", state.isDesktopMode);
  el.viewModeToggle.querySelector(".mode-text").textContent = state.isDesktopMode ? "Вид: Десктоп" : "Вид: Телефон";
}

function updateClock() {
  el.statusClock.textContent = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function setupSwipe() {
  // Свайп влево/вправо по экрану — следующий/предыдущий день (как в мобильном приложении)
  let x0 = null, y0 = null;
  el.phoneFrame.addEventListener("touchstart", (e) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  el.phoneFrame.addEventListener("touchend", (e) => {
    if (x0 === null || isModalOpen()) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) switchDate(addDays(state.currentDate, dx < 0 ? 1 : -1));
  });
}

function setupEventListeners() {
  el.prevDayBtn.addEventListener("click", () => switchDate(addDays(state.currentDate, -1)));
  el.nextDayBtn.addEventListener("click", () => switchDate(addDays(state.currentDate, 1)));
  el.prevShiftBtn.addEventListener("click", () => { const d = prevShiftDate(state.currentDate); if (d) switchDate(d); });
  el.nextShiftBtn.addEventListener("click", () => { const d = nextShiftDate(state.currentDate); if (d) switchDate(d); });
  el.todayBtn.addEventListener("click", () => switchDate(todayStr()));
  el.dateDisplayBtn.addEventListener("click", openDatePicker);
  el.datePickerInput.addEventListener("change", (e) => { if (e.target.value) switchDate(e.target.value); });

  // ← / → — день, Shift + ← / → — соседняя смена
  document.addEventListener("keydown", (e) => {
    if (isModalOpen()) {
      if (e.key === "Escape") closeAddModal();
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const forward = e.key === "ArrowRight";
    if (e.shiftKey) {
      const d = forward ? nextShiftDate(state.currentDate) : prevShiftDate(state.currentDate);
      if (d) switchDate(d);
    } else {
      switchDate(addDays(state.currentDate, forward ? 1 : -1));
    }
  });

  window.addEventListener("hashchange", () => {
    const d = location.hash.slice(1);
    if (isValidDateStr(d) && d !== state.currentDate) switchDate(d);
  });

  el.openModalBtn.addEventListener("click", openAddModal);
  el.modalCloseBtn.addEventListener("click", closeAddModal);
  el.modal.addEventListener("click", (e) => { if (e.target === el.modal) closeAddModal(); });
  el.tripAmount.addEventListener("input", calcCommission);
  el.calcCommissionBtn.addEventListener("click", calcCommission);
  el.add15mBtn.addEventListener("click", () => addDurationToEnd(15));
  el.add30mBtn.addEventListener("click", () => addDurationToEnd(30));
  el.fillSampleBtn.addEventListener("click", fillSampleData);
  el.form.addEventListener("submit", handleTripSubmit);
  el.viewModeToggle.addEventListener("click", toggleViewMode);

  setupSwipe();
  updateClock();
  setInterval(updateClock, 10000);
}

/** Стартовый день: из адреса (#YYYY-MM-DD) → дата из ТЗ (2026-10-01) → сегодня (если есть поездки) → первая доступная дата. */
function pickInitialDate() {
  const fromHash = location.hash.slice(1);
  if (isValidDateStr(fromHash)) return fromHash;
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
