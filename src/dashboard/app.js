import {
  addQuickNote,
  buildDashboardSummary,
  createDefaultState,
  deleteStock,
  migrateState,
  normalizeStockSymbol,
  selectStock,
  todayKey,
  toggleHabitForDate,
  toggleTask,
  upsertStock,
  upsertTask
} from "./dashboard-data.js";
import {
  buildCalendarMonth,
  deleteEvent,
  listEventsForDate,
  setCalendarMonth,
  setSelectedEventDate,
  upsertEvent
} from "./calendar.js";
import { loadStateFromDb, saveStateToDb } from "./local-db.js";
import {
  hideWidget,
  moveWidgetToIndex,
  normalizeDashboardLayout,
  resetDashboardLayout,
  resizeWidget,
  setWidgetSpan,
  showWidget
} from "./dashboard-layout.js";
import {
  buildIssueLinks,
  defaultIndices,
  marketTypeLabel,
  quoteSymbolsForState,
  shouldAutoRefreshQuotes
} from "./market-data.js";
import { buildSparkline, fetchQuotesForState } from "./stocks-api.js";

const currentDate = todayKey(new Date());
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percent = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "full" });

let state = createDefaultState(currentDate);
let activeView = "dashboard";
let searchTerm = "";
let marketFilter = "ALL";
let layoutLocked = false;
let widgetInteraction = null;

const $ = (selector) => document.querySelector(selector);
const selectors = {
  summaryCards: $("#summaryCards"),
  taskList: $("#taskList"),
  taskCounter: $("#taskCounter"),
  habitViewList: $("#habitViewList"),
  noteList: $("#noteList"),
  quoteHero: $("#quoteHero"),
  quoteStatus: $("#quoteStatus"),
  selectedStockTitle: $("#selectedStockTitle"),
  stockChart: $("#stockChart"),
  stockTable: $("#stockTable"),
  stockDetail: $("#stockDetail"),
  stockDetailTitle: $("#stockDetailTitle"),
  mainIndexGrid: $("#mainIndexGrid"),
  todayView: $("#todayView"),
  viewTitle: $("#viewTitle"),
  dateLabel: $("#dateLabel"),
  calendarLabel: $("#calendarLabel"),
  calendarGrid: $("#calendarGrid"),
  homeCalendarLabel: $("#homeCalendarLabel"),
  homeCalendarGrid: $("#homeCalendarGrid"),
  hiddenWidgets: $("#hiddenWidgets"),
  selectedDateTitle: $("#selectedDateTitle"),
  selectedEventList: $("#selectedEventList"),
  todayEvents: $("#todayEvents")
};

const priorityLabels = { high: "높음", medium: "보통", low: "낮음" };
const titleMap = {
  dashboard: "대시보드",
  calendar: "달력",
  today: "오늘",
  stocks: "시장",
  habits: "습관",
  settings: "설정"
};

function html(strings, ...values) {
  return strings.reduce((output, string, index) => output + string + (values[index] ?? ""), "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function matchesSearch(...values) {
  if (!searchTerm) return true;
  return values.join(" ").toLowerCase().includes(searchTerm);
}

async function persist(nextState = state) {
  state = nextState;
  await saveStateToDb(state);
  render();
}

function getQuote(symbol) {
  return state.quoteCache?.[symbol] || null;
}

function allMarketItems() {
  const stockSymbols = new Set((state.stocks || []).map((stock) => stock.symbol));
  return [
    ...(state.stocks || []),
    ...defaultIndices.filter((index) => !stockSymbols.has(index.symbol))
  ];
}

function getSelectedMarketItem() {
  return allMarketItems().find((item) => item.symbol === state.selectedSymbol) || allMarketItems()[0];
}

function renderSummary() {
  const summary = buildDashboardSummary(state, currentDate);
  const cards = [
    ["열린 할 일", summary.openTasksToday, "오늘 처리"],
    ["오늘 일정", summary.eventsToday, "달력"],
    ["습관", `${summary.completedHabitsToday}/${summary.totalHabits}`, "체크 완료"],
    ["관심 종목", quoteSymbolsForState(state).length, "지수 포함"]
  ];

  selectors.summaryCards.innerHTML = cards
    .map(([label, value, helper]) => html`
      <article class="summary-card">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${helper}</small>
      </article>
    `)
    .join("");
}

function renderTasks() {
  const tasks = state.tasks
    .filter((task) => task.date === currentDate)
    .filter((task) => matchesSearch(task.title, task.priority));
  const openTasks = state.tasks.filter((task) => task.date === currentDate && task.status !== "done").length;
  selectors.taskCounter.textContent = `${openTasks}개 진행 중`;
  selectors.taskList.innerHTML = tasks.length
    ? tasks.map((task) => html`
        <button class="task-row ${task.status === "done" ? "is-done" : ""}" data-task-id="${task.id}">
          <span class="checkmark">${task.status === "done" ? "완료" : ""}</span>
          <span>
            <strong>${escapeHtml(task.title)}</strong>
            <small>우선순위 ${priorityLabels[task.priority] || task.priority}</small>
          </span>
        </button>
      `).join("")
    : `<p class="empty-state">표시할 할 일이 없습니다.</p>`;
}

function renderHabits() {
  const habits = state.habits.filter((habit) => matchesSearch(habit.name));
  selectors.habitViewList.innerHTML = habits.length
    ? habits.map((habit) => {
        const checked = habit.checkedDates.includes(currentDate);
        return html`
          <button class="habit-card ${checked ? "is-checked" : ""}" data-habit-id="${habit.id}">
            <span class="habit-check">${checked ? "완료" : ""}</span>
            <strong>${escapeHtml(habit.name)}</strong>
            <small>${habit.streak}일 연속</small>
          </button>
        `;
      }).join("")
    : `<p class="empty-state">표시할 습관이 없습니다.</p>`;
}

function renderNotes() {
  const notes = state.notes.filter((note) => matchesSearch(note.title, note.body, note.tags.join(" "))).slice(0, 4);
  selectors.noteList.innerHTML = notes.length
    ? notes.map((note) => html`
        <article class="note-card">
          <strong>${escapeHtml(note.title)}</strong>
          <p>${escapeHtml(note.body)}</p>
          <small>${note.tags.map(escapeHtml).join(", ")}</small>
        </article>
      `).join("")
    : `<p class="empty-state">표시할 메모가 없습니다.</p>`;
}

function renderCalendar() {
  const [year, month] = state.calendarMonth.split("-").map(Number);
  const calendar = buildCalendarMonth(year, month - 1, state.events || []);
  selectors.calendarLabel.textContent = calendar.label;
  selectors.selectedDateTitle.textContent = dateFormatter.format(new Date(`${state.selectedEventDate}T00:00:00`));
  $("#eventDate").value = state.selectedEventDate;
  selectors.calendarGrid.innerHTML = calendar.days.map((day) => html`
    <button class="calendar-day ${day.isCurrentMonth ? "" : "is-muted"} ${day.isRedDay ? "is-red-day" : ""} ${day.isToday ? "is-today" : ""} ${day.date === state.selectedEventDate ? "is-selected" : ""}" data-calendar-date="${day.date}" type="button">
      <span class="day-number">${day.day}</span>
      ${day.holidayName ? `<small class="holiday-name">${escapeHtml(day.holidayName)}</small>` : ""}
      ${day.events.slice(0, 2).map((event) => `<small class="event-dot ${event.color || "blue"}">${escapeHtml(event.title)}</small>`).join("")}
    </button>
  `).join("");
  renderSelectedEvents();
  renderTodayEvents();
  renderHomeCalendar();
}

function renderHomeCalendar() {
  const [year, month] = state.calendarMonth.split("-").map(Number);
  const calendar = buildCalendarMonth(year, month - 1, state.events || []);
  selectors.homeCalendarLabel.textContent = calendar.label;
  const homeEventTitle = $("#homeEventTitle");
  if (homeEventTitle && document.activeElement !== homeEventTitle) {
    homeEventTitle.placeholder = `${state.selectedEventDate.slice(5).replace("-", "/")} 일정 추가`;
  }
  selectors.homeCalendarGrid.innerHTML = calendar.days
    .filter((day) => day.isCurrentMonth)
    .map((day) => html`
      <button class="mini-calendar-day ${day.isRedDay ? "is-red-day" : ""} ${day.isToday ? "is-today" : ""} ${day.date === state.selectedEventDate ? "is-selected" : ""}" type="button" data-calendar-date="${day.date}">
        <span>${day.day}</span>
        ${day.events.length ? `<small>${day.events.length}</small>` : ""}
      </button>
    `)
    .join("");
}

function renderSelectedEvents() {
  const events = listEventsForDate(state, state.selectedEventDate);
  selectors.selectedEventList.innerHTML = events.length
    ? events.map((event) => html`
        <article class="event-card ${event.color || "blue"}">
          <div>
            <strong>${escapeHtml(event.title)}</strong>
            <small>${event.time || "종일"} ${event.memo ? `· ${escapeHtml(event.memo)}` : ""}</small>
          </div>
          <div class="row-actions">
            <button type="button" data-edit-event="${event.id}">수정</button>
            <button type="button" data-delete-event="${event.id}">삭제</button>
          </div>
        </article>
      `).join("")
    : `<p class="empty-state">선택한 날짜의 일정이 없습니다.</p>`;
}

function renderTodayEvents() {
  const events = listEventsForDate(state, currentDate);
  selectors.todayEvents.innerHTML = events.length
    ? events.map((event) => html`
        <article class="event-card ${event.color || "blue"}">
          <strong>${escapeHtml(event.title)}</strong>
          <small>${event.time || "종일"} ${event.memo ? `· ${escapeHtml(event.memo)}` : ""}</small>
        </article>
      `).join("")
    : `<p class="empty-state">오늘 등록된 일정이 없습니다.</p>`;
}

function buildChart(values) {
  const width = 640;
  const height = 220;
  const padding = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (width - padding * 2) / (values.length - 1);
  const points = values.map((value, index) => {
    const x = padding + index * step;
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  return html`
    <path d="M ${padding},${height - padding} L ${points} L ${width - padding},${height - padding} Z" fill="rgba(22,137,248,.12)" />
    <polyline points="${points}" fill="none" stroke="#1689f8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    <g class="chart-grid">
      <line x1="22" x2="618" y1="54" y2="54" />
      <line x1="22" x2="618" y1="110" y2="110" />
      <line x1="22" x2="618" y1="166" y2="166" />
    </g>
  `;
}

function quoteChartValues(quote, seed) {
  if (quote?.chartPoints?.length >= 3) return quote.chartPoints;
  return buildSparkline(seed);
}

function renderMainIndexGrid() {
  const indexSymbols = ["^KS11", "^KQ11", "^GSPC", "^IXIC"];
  selectors.mainIndexGrid.innerHTML = defaultIndices
    .filter((item) => indexSymbols.includes(item.symbol))
    .map((item) => {
      const quote = getQuote(item.symbol);
      const isUp = !quote || quote.changePercent >= 0;
      return html`
        <button class="index-card" type="button" data-stock-symbol="${item.symbol}">
          <span>${escapeHtml(item.name)}</span>
          <strong>${quote?.price ? currency.format(quote.price) : "--"}</strong>
          <small class="${isUp ? "is-positive" : "is-negative"}">${quote ? `${isUp ? "+" : ""}${percent.format(quote.changePercent)}%` : "시세 대기"}</small>
          <svg viewBox="0 0 180 52" aria-label="${escapeHtml(item.name)} 미니 차트">${miniChart(quoteChartValues(quote, item.symbol.charCodeAt(1) || 1))}</svg>
        </button>
      `;
    })
    .join("");
}

function miniChart(values) {
  const width = 180;
  const height = 52;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * (height - 8) - 4;
    return `${x},${y}`;
  }).join(" ");
  return `<polyline points="${points}" fill="none" stroke="#1689f8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderSelectedStock() {
  const selected = getSelectedMarketItem();
  if (!selected) return;
  const quote = getQuote(selected.symbol);
  const isUp = !quote || quote.changePercent >= 0;

  selectors.selectedStockTitle.textContent = `${selected.name} (${selected.symbol})`;
  selectors.stockDetailTitle.textContent = `${selected.name} 상세`;
  selectors.quoteStatus.textContent = quote?.isFallback ? "데이터 갱신 실패" : quote ? "업데이트됨" : "새로고침 필요";
  selectors.quoteStatus.classList.toggle("is-danger", Boolean(quote?.isFallback));
  selectors.quoteHero.innerHTML = html`
    <div>
      <span class="ticker-pill">${marketTypeLabel(selected.marketType)} · ${selected.market}</span>
      <strong>${quote?.price ? currency.format(quote.price) : "시세 대기 중"}</strong>
      <small class="${isUp ? "is-positive" : "is-negative"}">${quote ? `${isUp ? "+" : ""}${percent.format(quote.changePercent)}%` : "R 버튼으로 시세 불러오기"}</small>
    </div>
    <div class="quote-meta">
      <span>갱신 ${quote?.updatedAt ? new Date(quote.updatedAt).toLocaleString("ko-KR") : "--"}</span>
      <span>시가 ${quote?.open ? currency.format(quote.open) : "--"}</span>
      <span>고가 ${quote?.high ? currency.format(quote.high) : "--"}</span>
      <span>저가 ${quote?.low ? currency.format(quote.low) : "--"}</span>
    </div>
  `;
  selectors.stockChart.innerHTML = buildChart(quoteChartValues(quote, selected.symbol.charCodeAt(0)));
  selectors.stockDetail.innerHTML = html`
    <div class="detail-stack">
      <article class="stock-metrics">
        <div>
          <span class="eyebrow">전일 종가</span>
          <strong>${quote?.previousClose ? currency.format(quote.previousClose) : "--"}</strong>
        </div>
        <div>
          <span class="eyebrow">거래량</span>
          <strong>${quote?.volume ? Number(quote.volume).toLocaleString("ko-KR") : "--"}</strong>
        </div>
        <div>
          <span class="eyebrow">거래소</span>
          <strong>${escapeHtml(quote?.exchangeName || selected.market)}</strong>
        </div>
      </article>
      <article>
        <span class="eyebrow">뉴스/이슈</span>
        <div class="link-grid">
          ${buildIssueLinks(selected).map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("")}
        </div>
      </article>
      <article>
        <span class="eyebrow">확인 포인트</span>
        <ul>
          <li>가격, 등락률, 거래량을 먼저 확인하세요.</li>
          <li>뉴스 링크에서 최근 이슈와 공시 흐름을 확인하세요.</li>
          <li>차트는 새로고침 시점의 장중 close 데이터가 있으면 실제 데이터로 표시됩니다.</li>
        </ul>
      </article>
    </div>
  `;
}

function renderStockTable() {
  const items = allMarketItems()
    .filter((item) => marketFilter === "ALL" || item.marketType === marketFilter)
    .filter((item) => matchesSearch(item.symbol, item.name, item.market, item.marketType));

  selectors.stockTable.innerHTML = html`
    <div class="table-row table-head">
      <span>종목/지수</span>
      <span>구분</span>
      <span>가격</span>
      <span>변동률</span>
      <span>추세</span>
      <span>관리</span>
    </div>
    ${items.length ? items.map((item) => {
      const quote = getQuote(item.symbol);
      const isUp = !quote || quote.changePercent >= 0;
      const isDefaultIndex = defaultIndices.some((index) => index.symbol === item.symbol);
      return html`
        <article class="table-row ${item.symbol === state.selectedSymbol ? "is-selected" : ""}">
          <span><strong>${escapeHtml(item.name)}</strong><small>${item.symbol}</small></span>
          <span>${marketTypeLabel(item.marketType)}</span>
          <span>${quote?.price ? currency.format(quote.price) : "--"}</span>
          <span class="${isUp ? "is-positive" : "is-negative"}">${quote ? `${isUp ? "+" : ""}${percent.format(quote.changePercent)}%` : "--"}</span>
          <span class="mini-bars">${Array.from({ length: 18 }, (_, index) => `<i style="height:${18 + ((index * item.symbol.length) % 28)}px"></i>`).join("")}</span>
          <span class="table-actions">
            <button type="button" data-stock-symbol="${item.symbol}">보기</button>
            ${isDefaultIndex ? "" : `<button type="button" data-delete-stock="${item.symbol}">삭제</button>`}
          </span>
        </article>
      `;
    }).join("") : `<p class="empty-state">표시할 항목이 없습니다.</p>`}
  `;
}

function renderTodayView() {
  selectors.todayView.innerHTML = html`
    <section class="panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">오늘</p>
          <h2>하루 운영 보드</h2>
        </div>
      </div>
      <div class="split-list">
        <div>${selectors.taskList.innerHTML}</div>
        <div>${selectors.todayEvents.innerHTML}</div>
      </div>
    </section>
  `;
}

function renderView() {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-visible", view.id === `view-${activeView}`);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.view === activeView);
  });
  document.querySelectorAll("[data-market-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.marketFilter === marketFilter);
  });
  selectors.viewTitle.textContent = titleMap[activeView];
}

function renderDashboardLayout() {
  const layout = normalizeDashboardLayout(state.dashboardLayout || resetDashboardLayout());
  $("#toggleLayoutLock").textContent = layoutLocked ? "배치 잠금 해제" : "배치 잠금";
  $("#toggleLayoutLock").classList.toggle("is-locked", layoutLocked);
  $("#dashboardBoard").classList.toggle("is-layout-locked", layoutLocked);
  const hiddenWidgets = layout.filter((widget) => widget.hidden);
  const existingWidgetIds = new Set(layout.map((widget) => widget.id));
  document.querySelectorAll("[data-dashboard-widget]").forEach((element) => {
    if (!existingWidgetIds.has(element.dataset.dashboardWidget)) element.hidden = true;
    element.style.transform = "";
    element.style.removeProperty("--preview-col");
    element.style.removeProperty("--preview-row");
  });

  selectors.hiddenWidgets.innerHTML = !layoutLocked && hiddenWidgets.length
    ? html`
        <span>숨긴 위젯</span>
        ${hiddenWidgets.map((widget) => `<button type="button" data-widget-show="${widget.id}">${widgetLabel(widget.id)} 복구</button>`).join("")}
      `
    : "";
  selectors.hiddenWidgets.classList.toggle("is-visible", !layoutLocked && hiddenWidgets.length > 0);

  layout.forEach((widget, index) => {
    const element = document.querySelector(`[data-dashboard-widget="${widget.id}"]`);
    const controls = document.querySelector(`[data-widget-controls="${widget.id}"]`);
    if (!element) return;
    element.style.order = index;
    element.style.setProperty("--widget-col", widget.colSpan);
    element.style.setProperty("--widget-row", widget.rowSpan);
    element.dataset.widgetSize = widget.presetSize;
    element.dataset.widgetCol = widget.colSpan;
    element.dataset.widgetRow = widget.rowSpan;
    element.hidden = widget.hidden;
    element.classList.toggle("is-editing", !layoutLocked);
    element.classList.toggle("is-compact", widget.colSpan === 1 || widget.rowSpan === 1);
    element.classList.toggle("is-expanded", widget.colSpan >= 3 && widget.rowSpan >= 3);
    element.classList.toggle("is-wide", widget.colSpan >= 3);
    element.classList.toggle("is-tall", widget.rowSpan >= 3);
    element.style.setProperty("--widget-type-scale", widgetTypeScale(widget));
    if (controls) {
      controls.innerHTML = !layoutLocked
        ? html`
            <button type="button" data-widget-size="${widget.id}" data-size="small">작게</button>
            <button type="button" data-widget-size="${widget.id}" data-size="medium">보통</button>
            <button type="button" data-widget-size="${widget.id}" data-size="large">크게</button>
            <button type="button" data-widget-size="${widget.id}" data-size="full">전체</button>
            <button type="button" data-widget-hide="${widget.id}">숨김</button>
          `
        : "";
    }
    if (!element.querySelector(".widget-resize-grip")) {
      element.insertAdjacentHTML("beforeend", `<button class="widget-resize-grip" type="button" aria-label="${widgetLabel(widget.id)} 크기 조절" data-widget-grip="${widget.id}"></button>`);
    }
    const heading = element.querySelector(".panel-heading");
    if (heading) {
      heading.dataset.widgetDragHandle = widget.id;
      heading.title = layoutLocked ? "배치 잠금 상태입니다" : "드래그해서 위치를 바꿀 수 있습니다";
    }
  });
}

function widgetTypeScale(widget) {
  const area = widget.colSpan * widget.rowSpan;
  if (area <= 1) return 0.86;
  if (area <= 3) return 0.94;
  if (area >= 9) return 1.16;
  if (widget.colSpan >= 4 || widget.rowSpan >= 3) return 1.08;
  return 1;
}

function widgetLabel(id) {
  return {
    indices: "주요 지수",
    calendar: "달력",
    tasks: "할 일",
    stock: "선택 종목",
    events: "오늘 일정",
    notes: "빠른 메모"
  }[id] || id;
}

function widgetIndexFromPointer(clientX, clientY, draggedId) {
  const widgets = Array.from(document.querySelectorAll("[data-dashboard-widget]:not([hidden])"))
    .filter((element) => element.dataset.dashboardWidget !== draggedId);
  if (!widgets.length) return 0;
  let best = { index: widgets.length, distance: Number.POSITIVE_INFINITY };
  widgets.forEach((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    const index = Number(element.style.order || 0);
    if (distance < best.distance) best = { index, distance };
  });
  return best.index;
}

function spanFromResizeDrag(interaction, clientX, clientY) {
  const columnWidth = interaction.boardWidth / 4;
  const rowHeight = 136;
  return {
    colSpan: Math.round(interaction.startColSpan + (clientX - interaction.startX) / columnWidth),
    rowSpan: Math.round(interaction.startRowSpan + (clientY - interaction.startY) / rowHeight)
  };
}

function startWidgetMove(event, widgetId) {
  if (layoutLocked || event.target.closest("button, input, textarea, select, a, [data-widget-controls]")) return;
  const element = event.target.closest("[data-dashboard-widget]");
  if (!element) return;
  element.setPointerCapture?.(event.pointerId);
  widgetInteraction = {
    type: "move",
    widgetId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    targetIndex: Number(element.style.order || 0)
  };
  element.classList.add("is-dragging");
}

function startWidgetResize(event, widgetId) {
  if (layoutLocked) return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.target.closest("[data-dashboard-widget]");
  const board = $("#dashboardBoard");
  if (!element || !board) return;
  event.target.setPointerCapture?.(event.pointerId);
  widgetInteraction = {
    type: "resize",
    widgetId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startColSpan: Number(element.dataset.widgetCol || 2),
    startRowSpan: Number(element.dataset.widgetRow || 2),
    boardWidth: board.getBoundingClientRect().width
  };
  element.classList.add("is-resizing");
}

async function finishWidgetInteraction(event) {
  if (!widgetInteraction || event.pointerId !== widgetInteraction.pointerId) return;
  const interaction = widgetInteraction;
  widgetInteraction = null;
  document.querySelectorAll(".is-dragging, .is-resizing").forEach((element) => {
    element.classList.remove("is-dragging", "is-resizing");
  });
  if (interaction.type === "move") {
    await persist({
      ...state,
      dashboardLayout: moveWidgetToIndex(state.dashboardLayout, interaction.widgetId, interaction.targetIndex)
    });
  }
  if (interaction.type === "resize") {
    const nextSpan = spanFromResizeDrag(interaction, event.clientX, event.clientY);
    await persist({
      ...state,
      dashboardLayout: setWidgetSpan(state.dashboardLayout, interaction.widgetId, nextSpan.colSpan, nextSpan.rowSpan)
    });
  }
}

function updateWidgetInteraction(event) {
  if (!widgetInteraction || event.pointerId !== widgetInteraction.pointerId) return;
  const element = document.querySelector(`[data-dashboard-widget="${widgetInteraction.widgetId}"]`);
  if (!element) return;
  if (widgetInteraction.type === "move") {
    const deltaX = event.clientX - widgetInteraction.startX;
    const deltaY = event.clientY - widgetInteraction.startY;
    element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    widgetInteraction.targetIndex = widgetIndexFromPointer(event.clientX, event.clientY, widgetInteraction.widgetId);
  }
  if (widgetInteraction.type === "resize") {
    const nextSpan = spanFromResizeDrag(widgetInteraction, event.clientX, event.clientY);
    element.style.setProperty("--preview-col", nextSpan.colSpan);
    element.style.setProperty("--preview-row", nextSpan.rowSpan);
  }
}

function render() {
  selectors.dateLabel.textContent = dateFormatter.format(new Date(`${currentDate}T00:00:00`));
  renderSummary();
  renderTasks();
  renderHabits();
  renderNotes();
  renderCalendar();
  renderMainIndexGrid();
  renderSelectedStock();
  renderStockTable();
  renderTodayView();
  renderDashboardLayout();
  renderView();
}

async function refreshQuotes() {
  selectors.quoteStatus.textContent = "업데이트 중";
  try {
    const quotes = await fetchQuotesForState(state);
    await persist({ ...state, quoteCache: { ...state.quoteCache, ...quotes } });
  } catch (error) {
    const failed = Object.fromEntries(
      quoteSymbolsForState(state).map((symbol) => [
        symbol,
        {
          ...(state.quoteCache?.[symbol] || { symbol, price: 0, changePercent: 0 }),
          isFallback: true,
          message: `데이터 갱신 실패: ${error.message}`,
          updatedAt: new Date().toISOString()
        }
      ])
    );
    await persist({ ...state, quoteCache: { ...state.quoteCache, ...failed } });
  }
}

function resetEventForm() {
  $("#eventId").value = "";
  $("#eventDate").value = state.selectedEventDate;
  $("#eventTime").value = "";
  $("#eventTitle").value = "";
  $("#eventMemo").value = "";
  $("#eventColor").value = "blue";
}

function exportDashboardData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `personal-dashboard-backup-${currentDate}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importDashboardData(file) {
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);
  await persist(migrateState(parsed, currentDate));
}

function bindEvents() {
  document.body.addEventListener("pointerdown", (event) => {
    const grip = event.target.closest("[data-widget-grip]");
    const dragHandle = event.target.closest("[data-widget-drag-handle]");
    if (grip) startWidgetResize(event, grip.dataset.widgetGrip);
    if (dragHandle) startWidgetMove(event, dragHandle.dataset.widgetDragHandle);
  });

  document.body.addEventListener("pointermove", updateWidgetInteraction);
  document.body.addEventListener("pointerup", finishWidgetInteraction);
  document.body.addEventListener("pointercancel", finishWidgetInteraction);

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      render();
    });
  });

  $("#globalSearch").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim().toLowerCase();
    render();
  });

  $("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#taskTitle").value.trim();
    if (!title) return;
    await persist(upsertTask(state, {
      id: `task-${crypto.randomUUID()}`,
      title,
      priority: $("#taskPriority").value,
      date: currentDate,
      status: "open"
    }));
    event.target.reset();
  });

  $("#noteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#noteTitle").value.trim();
    const body = $("#noteBody").value.trim();
    if (!title || !body) return;
    await persist(addQuickNote(state, {
      id: `note-${crypto.randomUUID()}`,
      title,
      body,
      tags: ["빠른 메모"],
      createdAt: new Date().toISOString()
    }));
    event.target.reset();
  });

  $("#eventForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("#eventId").value || `event-${crypto.randomUUID()}`;
    const title = $("#eventTitle").value.trim();
    if (!title) return;
    await persist(upsertEvent(state, {
      id,
      title,
      date: $("#eventDate").value,
      time: $("#eventTime").value,
      memo: $("#eventMemo").value.trim(),
      color: $("#eventColor").value
    }));
    resetEventForm();
  });

  $("#homeEventForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#homeEventTitle").value.trim();
    if (!title) return;
    await persist(upsertEvent(state, {
      id: `event-${crypto.randomUUID()}`,
      title,
      date: state.selectedEventDate,
      time: "",
      memo: "홈 달력에서 추가",
      color: "blue"
    }));
    event.target.reset();
  });

  $("#stockForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const symbol = normalizeStockSymbol($("#stockSymbol").value, $("#stockMarket").value);
    const name = $("#stockName").value.trim();
    if (!symbol) return;
    await persist(upsertStock(state, { symbol, name, market: $("#stockMarket").value }));
    event.target.reset();
    await refreshQuotes();
  });

  document.body.addEventListener("click", async (event) => {
    const taskButton = event.target.closest("[data-task-id]");
    const habitButton = event.target.closest("[data-habit-id]");
    const stockButton = event.target.closest("[data-stock-symbol]");
    const calendarButton = event.target.closest("[data-calendar-date]");
    const editButton = event.target.closest("[data-edit-event]");
    const deleteButton = event.target.closest("[data-delete-event]");
    const filterButton = event.target.closest("[data-market-filter]");
    const openViewButton = event.target.closest("[data-open-view]");
    const widgetSizeButton = event.target.closest("[data-widget-size]");
    const widgetHideButton = event.target.closest("[data-widget-hide]");
    const widgetShowButton = event.target.closest("[data-widget-show]");
    const deleteStockButton = event.target.closest("[data-delete-stock]");

    if (deleteStockButton) {
      await persist(deleteStock(state, deleteStockButton.dataset.deleteStock));
      return;
    }
    if (taskButton) await persist(toggleTask(state, taskButton.dataset.taskId));
    if (habitButton) await persist(toggleHabitForDate(state, habitButton.dataset.habitId, currentDate));
    if (stockButton) await persist(selectStock(state, stockButton.dataset.stockSymbol));
    if (calendarButton) await persist(setSelectedEventDate(state, calendarButton.dataset.calendarDate));
    if (filterButton) {
      marketFilter = filterButton.dataset.marketFilter;
      render();
    }
    if (openViewButton) {
      activeView = openViewButton.dataset.openView;
      render();
    }
    if (widgetSizeButton) {
      await persist({
        ...state,
        dashboardLayout: resizeWidget(
          state.dashboardLayout,
          widgetSizeButton.dataset.widgetSize,
          widgetSizeButton.dataset.size
        )
      });
    }
    if (widgetHideButton) {
      await persist({
        ...state,
        dashboardLayout: hideWidget(state.dashboardLayout, widgetHideButton.dataset.widgetHide)
      });
    }
    if (widgetShowButton) {
      await persist({
        ...state,
        dashboardLayout: showWidget(state.dashboardLayout, widgetShowButton.dataset.widgetShow)
      });
    }
    if (editButton) {
      const found = state.events.find((item) => item.id === editButton.dataset.editEvent);
      if (found) {
        $("#eventId").value = found.id;
        $("#eventDate").value = found.date;
        $("#eventTime").value = found.time || "";
        $("#eventTitle").value = found.title;
        $("#eventMemo").value = found.memo || "";
        $("#eventColor").value = found.color || "blue";
      }
    }
    if (deleteButton) await persist(deleteEvent(state, deleteButton.dataset.deleteEvent));
  });

  $("#prevMonth").addEventListener("click", async () => {
    const [year, month] = state.calendarMonth.split("-").map(Number);
    const date = new Date(year, month - 2, 1);
    await persist(setCalendarMonth(state, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`));
  });
  $("#nextMonth").addEventListener("click", async () => {
    const [year, month] = state.calendarMonth.split("-").map(Number);
    const date = new Date(year, month, 1);
    await persist(setCalendarMonth(state, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`));
  });
  $("#thisMonth").addEventListener("click", async () => {
    await persist(setSelectedEventDate(state, currentDate));
  });
  $("#clearEventForm").addEventListener("click", resetEventForm);
  $("#refreshQuotes").addEventListener("click", refreshQuotes);
  $("#toggleLayoutLock").addEventListener("click", () => {
    layoutLocked = !layoutLocked;
    render();
  });
  $("#resetDashboardLayout").addEventListener("click", async () => {
    await persist({ ...state, dashboardLayout: resetDashboardLayout() });
  });
  $("#resetDashboardLayoutSettings").addEventListener("click", async () => {
    await persist({ ...state, dashboardLayout: resetDashboardLayout() });
  });
  $("#exportData").addEventListener("click", exportDashboardData);
  $("#importDataButton").addEventListener("click", () => $("#importDataInput").click());
  $("#importDataInput").addEventListener("change", async (event) => {
    try {
      await importDashboardData(event.target.files?.[0]);
      event.target.value = "";
    } catch (error) {
      alert(`가져오기에 실패했습니다: ${error.message}`);
    }
  });
  $("#addTaskFocus").addEventListener("click", () => {
    activeView = "dashboard";
    render();
    $("#taskTitle").focus();
  });
  $("#resetData").addEventListener("click", async () => {
    await persist(createDefaultState(currentDate));
    resetEventForm();
  });
}

async function init() {
  const saved = await loadStateFromDb();
  state = migrateState(saved, currentDate);
  bindEvents();
  render();
  await saveStateToDb(state);
  if (shouldAutoRefreshQuotes(state)) {
    await refreshQuotes();
  }
}

init();
