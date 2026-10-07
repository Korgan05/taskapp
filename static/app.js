/**
 * Дневник смен водителя — Frontend клиент
 */

// Состояние приложения
const state = {
  currentDate: "2026-10-01",
  availableDates: [],
  isDesktopMode: false,
};

// DOM Элементы
const elements = {
  mainWrapper: document.getElementById("main-wrapper"),
  viewModeToggle: document.getElementById("view-mode-toggle"),
  prevDayBtn: document.getElementById("prev-day-btn"),
  nextDayBtn: document.getElementById("next-day-btn"),
  datePickerInput: document.getElementById("date-picker-input"),
  dateDisplayText: document.getElementById("date-display-text"),
  dateRelativeTag: document.getElementById("date-relative-tag"),
  dateChipsContainer: document.getElementById("date-chips-container"),
  statusClock: document.getElementById("status-clock"),

  // Чек смены
  receiptDateLabel: document.getElementById("receipt-date-label"),
  receiptMiniTrips: document.getElementById("receipt-mini-trips"),
  receiptTripsCount: document.getElementById("receipt-trips-count"),
  receiptTotalRevenue: document.getElementById("receipt-total-revenue"),
  receiptTotalCommission: document.getElementById("receipt-total-commission"),
  receiptPaymentSplit: document.getElementById("receipt-payment-split"),
  receiptNetPayout: document.getElementById("receipt-net-payout"),

  // Карточки статистики
  cardNet: document.getElementById("card-net"),
  cardRevenue: document.getElementById("card-revenue"),
  cardTripsCount: document.getElementById("card-trips-count"),
  cardCommission: document.getElementById("card-commission"),
  cardCommissionRate: document.getElementById("card-commission-rate"),
  cardCash: document.getElementById("card-cash"),
  cardCard: document.getElementById("card-card"),
  splitProgressCash: document.getElementById("split-progress-cash"),
  splitProgressCard: document.getElementById("split-progress-card"),

  // Список поездок
  tripsCountBadge: document.getElementById("trips-count-badge"),
  tripsListContainer: document.getElementById("trips-list-container"),

  // Модалка добавления
  openModalBtn: document.getElementById("open-add-modal-btn"),
  modalOverlay: document.getElementById("add-trip-modal"),
  modalCloseBtn: document.getElementById("modal-close-btn"),
  tripForm: document.getElementById("add-trip-form"),
  tripStartInput: document.getElementById("trip-start"),
  tripEndInput: document.getElementById("trip-end"),
  tripAmountInput: document.getElementById("trip-amount"),
  tripCommissionInput: document.getElementById("trip-commission"),
  tripIdInput: document.getElementById("trip-id"),
  add15mBtn: document.getElementById("add-15m-btn"),
  add30mBtn: document.getElementById("add-30m-btn"),
  calc15CommissionBtn: document.getElementById("calc-15-commission-btn"),
  fillSampleBtn: document.getElementById("fill-sample-btn"),

  // Тосты
  toastContainer: document.getElementById("toast-container"),
};

// Форматирование чисел в тенге
function formatTenge(amount) {
  return new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 0 }).format(amount) + " ₸";
}

// Форматирование даты
function formatDateDisplay(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const options = { day: "numeric", month: "long", year: "numeric" };
  return d.toLocaleDateString("ru-RU", options);
}

function getDayOfWeek(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("ru-RU", { weekday: "long" });
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// Всплывающие уведомления (Toast)
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><div>${message}</div>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Загрузка доступных дат
async function loadAvailableDates() {
  try {
    const res = await fetch("/api/dates");
    if (res.ok) {
      state.availableDates = await res.json();
      renderDateChips();
    }
  } catch (err) {
    console.error("Ошибка загрузки дат:", err);
  }
}

// Отрисовка чипсов дат
function renderDateChips() {
  elements.dateChipsContainer.innerHTML = "";
  if (state.availableDates.length === 0) return;

  state.availableDates.forEach((dateStr) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `date-chip ${dateStr === state.currentDate ? "active" : ""}`;
    const [y, m, d] = dateStr.split("-");
    chip.textContent = `${d}.${m}`;
    chip.addEventListener("click", () => switchDate(dateStr));
    elements.dateChipsContainer.appendChild(chip);
  });
}

// Переключение даты
function switchDate(newDateStr) {
  state.currentDate = newDateStr;
  elements.datePickerInput.value = newDateStr;
  elements.dateDisplayText.textContent = formatDateDisplay(newDateStr);
  const weekday = getDayOfWeek(newDateStr);
  elements.dateRelativeTag.textContent = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  elements.receiptDateLabel.textContent = newDateStr.split("-").reverse().join(".");

  renderDateChips();
  loadDayData(newDateStr);
}

// Загрузка данных за день (сводка + поездки)
async function loadDayData(dateStr) {
  try {
    const res = await fetch(`/api/day?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) throw new Error("Ошибка получения данных");

    const data = await res.json();
    renderSummary(data.summary);
    renderTrips(data.trips);
  } catch (err) {
    showToast("Не удалось загрузить данные смены: " + err.message, "error");
  }
}

// Отрисовка сводки
function renderSummary(summary) {
  const { trips_count, total_revenue, total_commission, net_payout, breakdown } = summary;

  // Чек
  elements.receiptTripsCount.textContent = trips_count;
  elements.receiptTotalRevenue.textContent = formatTenge(total_revenue);
  elements.receiptTotalCommission.textContent = total_commission > 0 ? `−${formatTenge(total_commission)}` : "0 ₸";
  elements.receiptPaymentSplit.textContent = `${formatTenge(breakdown.cash)} / ${formatTenge(breakdown.card)}`;
  elements.receiptNetPayout.textContent = formatTenge(net_payout);

  // Карточки
  elements.cardNet.textContent = formatTenge(net_payout);
  elements.cardRevenue.textContent = formatTenge(total_revenue);
  elements.cardTripsCount.textContent = `${trips_count} поездок`;
  elements.cardCommission.textContent = formatTenge(total_commission);
  const commPercent = total_revenue > 0 ? Math.round((total_commission / total_revenue) * 100) : 0;
  elements.cardCommissionRate.textContent = `${commPercent}% от выручки`;

  elements.cardCash.textContent = formatTenge(breakdown.cash);
  elements.cardCard.textContent = formatTenge(breakdown.card);

  // Прогресс-бар разбивки
  const totalPay = breakdown.cash + breakdown.card;
  if (totalPay > 0) {
    const cashPct = (breakdown.cash / totalPay) * 100;
    const cardPct = (breakdown.card / totalPay) * 100;
    elements.splitProgressCash.style.width = `${cashPct}%`;
    elements.splitProgressCard.style.width = `${cardPct}%`;
  } else {
    elements.splitProgressCash.style.width = "50%";
    elements.splitProgressCard.style.width = "50%";
  }

  elements.tripsCountBadge.textContent = trips_count;
}

// Отрисовка списка поездок
function renderTrips(trips) {
  elements.receiptMiniTrips.innerHTML = "";
  elements.tripsListContainer.innerHTML = "";

  if (!trips || trips.length === 0) {
    elements.receiptMiniTrips.innerHTML = `
      <div class="receipt-row muted" style="justify-content: center; padding: 6px 0;">
        <span>В этот день поездок нет</span>
      </div>`;

    elements.tripsListContainer.innerHTML = `
      <div class="trips-empty-state">
        <span class="icon">🛋️</span>
        <h4>Смена ещё не началась</h4>
        <p>Нажмите «+ Новая поездка», чтобы добавить первый заказ</p>
      </div>`;
    return;
  }

  // Заполнение чека
  trips.forEach((trip) => {
    const startTime = formatTime(trip.start);
    const endTime = formatTime(trip.end);
    const payLabel = trip.payment === "card" ? "карта" : "нал.";
    const row = document.createElement("div");
    row.className = "receipt-row";
    row.innerHTML = `
      <span>${startTime}–${endTime} ${payLabel}</span>
      <strong>${formatTenge(trip.amount)}</strong>
    `;
    elements.receiptMiniTrips.appendChild(row);
  });

  // Заполнение детальных карточек
  trips.forEach((trip) => {
    const startD = new Date(trip.start);
    const endD = new Date(trip.end);
    const durationMin = Math.max(1, Math.round((endD - startD) / 60000));

    const card = document.createElement("div");
    card.className = "trip-card";
    card.innerHTML = `
      <div class="trip-time-info">
        <div class="trip-time-interval">${formatTime(trip.start)} → ${formatTime(trip.end)}</div>
        <div class="trip-duration-tag">⏱️ ${durationMin} мин · ID: <code>${trip.id}</code></div>
      </div>
      <div class="trip-financial-info">
        <div class="trip-amount-val">${formatTenge(trip.amount)}</div>
        <div class="trip-badge-row">
          <span class="badge-payment ${trip.payment}">
            ${trip.payment === "card" ? "💳 Карта" : "💵 Наличные"}
          </span>
          <span class="badge-comm">ком. −${formatTenge(trip.commission)}</span>
        </div>
      </div>
    `;
    elements.tripsListContainer.appendChild(card);
  });
}

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Переключение предыдущий / следующий день
function shiftDay(daysOffset) {
  const [y, m, d] = state.currentDate.split("-").map(Number);
  // Задаем полдень (12:00), чтобы исключить любые смещения часовых поясов
  const date = new Date(y, m - 1, d, 12, 0, 0);
  date.setDate(date.getDate() + daysOffset);
  const newDateStr = formatLocalDate(date);
  switchDate(newDateStr);
}

// Модальное окно
function openAddModal() {
  // Устанавливаем время по умолчанию в выбранную дату
  const [y, m, d] = state.currentDate.split("-");
  const now = new Date();
  const startD = new Date(Number(y), Number(m) - 1, Number(d), now.getHours(), now.getMinutes());
  const endD = new Date(startD.getTime() + 25 * 60000); // +25 минут

  const formatForInput = (dt) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };

  elements.tripStartInput.value = formatForInput(startD);
  elements.tripEndInput.value = formatForInput(endD);
  elements.tripAmountInput.value = "2500";
  elements.tripCommissionInput.value = "375";
  elements.tripIdInput.value = "";

  elements.modalOverlay.classList.add("active");
  elements.modalOverlay.setAttribute("aria-hidden", "false");
}

function closeAddModal() {
  elements.modalOverlay.classList.remove("active");
  elements.modalOverlay.setAttribute("aria-hidden", "true");
}

// Быстрый расчет комиссии 15%
function calcCommission() {
  const amount = parseFloat(elements.tripAmountInput.value) || 0;
  if (amount > 0) {
    elements.tripCommissionInput.value = Math.round(amount * 0.15);
  }
}

// Добавление времени к окончанию поездки
function addDurationToEnd(minutes) {
  if (!elements.tripStartInput.value) return;
  const start = new Date(elements.tripStartInput.value);
  const newEnd = new Date(start.getTime() + minutes * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  elements.tripEndInput.value = `${newEnd.getFullYear()}-${pad(newEnd.getMonth() + 1)}-${pad(newEnd.getDate())}T${pad(newEnd.getHours())}:${pad(newEnd.getMinutes())}`;
}

// Пример данных из ТЗ
function fillSampleData() {
  elements.tripStartInput.value = "2026-10-01T17:00";
  elements.tripEndInput.value = "2026-10-01T17:28";
  elements.tripAmountInput.value = "2900";
  elements.tripCommissionInput.value = "435";
  elements.tripIdInput.value = "t_sample_" + Math.floor(Math.random() * 1000);
}

// Отправка формы поездки
async function handleTripSubmit(e) {
  e.preventDefault();

  const startVal = elements.tripStartInput.value;
  const endVal = elements.tripEndInput.value;
  const amountVal = parseFloat(elements.tripAmountInput.value);
  const commissionVal = parseFloat(elements.tripCommissionInput.value) || 0;
  const paymentVal = elements.tripForm.querySelector('input[name="payment"]:checked').value;
  const idVal = elements.tripIdInput.value.trim();

  // Клиентская валидация
  if (amountVal <= 0) {
    showToast("Сумма поездки должна быть больше нуля", "error");
    return;
  }
  const startDate = new Date(startVal);
  const endDate = new Date(endVal);
  if (endDate <= startDate) {
    showToast("Время окончания поездки должно быть позже времени начала", "error");
    return;
  }

  // Добавляем локальное смещение часового пояса (+05:00)
  const formatIsoWithTz = (dt) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00+05:00`;
  };

  const payload = {
    start: formatIsoWithTz(startDate),
    end: formatIsoWithTz(endDate),
    amount: amountVal,
    commission: commissionVal,
    payment: paymentVal,
  };
  if (idVal) payload.id = idVal;

  try {
    const response = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.status === 201) {
      const createdTrip = await response.json();
      showToast(`Поездка успешно добавлена (${createdTrip.amount} ₸)!`, "success");
      closeAddModal();

      // Переключаемся на дату добавленной поездки
      const tripDate = createdTrip.start.split("T")[0];
      await loadAvailableDates();
      switchDate(tripDate);
    } else if (response.status === 409) {
      // Защита от дублей сработала!
      const errorData = await response.json();
      const msg = errorData.detail?.message || "Обнаружен дубликат поездки! Повторное сохранение отклонено.";
      showToast(`🛡️ ${msg}`, "error");
    } else if (response.status === 422) {
      showToast("Ошибка валидации данных (проверьте сумму и даты)", "error");
    } else {
      showToast("Не удалось сохранить поездку", "error");
    }
  } catch (err) {
    showToast("Ошибка сети при отправке поездки: " + err.message, "error");
  }
}

// Переключение режима десктоп / телефон
function toggleViewMode() {
  state.isDesktopMode = !state.isDesktopMode;
  elements.mainWrapper.classList.toggle("desktop-mode", state.isDesktopMode);
  const modeText = elements.viewModeToggle.querySelector(".mode-text");
  if (state.isDesktopMode) {
    modeText.textContent = "Вид: Десктоп";
  } else {
    modeText.textContent = "Вид: Телефон";
  }
}

// Часы в шапке телефона
function updateClock() {
  const now = new Date();
  elements.statusClock.textContent = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// Привязка обработчиков событий
function setupEventListeners() {
  elements.prevDayBtn.addEventListener("click", () => shiftDay(-1));
  elements.nextDayBtn.addEventListener("click", () => shiftDay(1));
  elements.datePickerInput.addEventListener("change", (e) => switchDate(e.target.value));

  elements.openModalBtn.addEventListener("click", openAddModal);
  elements.modalCloseBtn.addEventListener("click", closeAddModal);
  elements.modalOverlay.addEventListener("click", (e) => {
    if (e.target === elements.modalOverlay) closeAddModal();
  });

  elements.tripAmountInput.addEventListener("input", calcCommission);
  elements.calc15CommissionBtn.addEventListener("click", calcCommission);
  elements.add15mBtn.addEventListener("click", () => addDurationToEnd(15));
  elements.add30mBtn.addEventListener("click", () => addDurationToEnd(30));
  elements.fillSampleBtn.addEventListener("click", fillSampleData);
  elements.tripForm.addEventListener("submit", handleTripSubmit);

  elements.viewModeToggle.addEventListener("click", toggleViewMode);

  setInterval(updateClock, 1000);
  updateClock();
}

// Инициализация
async function init() {
  setupEventListeners();
  await loadAvailableDates();
  // Если в списке есть 2026-10-01 (дата из ТЗ), начинаем с неё, иначе с первой доступной даты
  if (state.availableDates.includes("2026-10-01")) {
    switchDate("2026-10-01");
  } else if (state.availableDates.length > 0) {
    switchDate(state.availableDates[0]);
  } else {
    switchDate(formatLocalDate(new Date()));
  }
}

document.addEventListener("DOMContentLoaded", init);
