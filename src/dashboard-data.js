import { normalizeDashboardLayout, resetDashboardLayout } from "./dashboard-layout.js";

export function todayKey(date = new Date()) {
  if (typeof date === "string") return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function createDefaultState(date = todayKey()) {
  return {
    schemaVersion: 2,
    tasks: [
      {
        id: "task-review-market",
        title: "시장 상황과 관심 종목 확인",
        date,
        status: "open",
        priority: "high"
      },
      {
        id: "task-plan-day",
        title: "오늘의 핵심 3가지 정리",
        date,
        status: "open",
        priority: "high"
      },
      {
        id: "task-read-news",
        title: "저장한 시장 뉴스 링크 읽기",
        date,
        status: "open",
        priority: "medium"
      },
      {
        id: "task-backup-notes",
        title: "어제의 빠른 메모 정리",
        date,
        status: "done",
        priority: "low"
      }
    ],
    events: [],
    habits: [
      {
        id: "habit-reading",
        name: "20분 독서",
        streak: 4,
        checkedDates: []
      },
      {
        id: "habit-morning-walk",
        name: "아침 산책",
        streak: 7,
        checkedDates: []
      },
      {
        id: "habit-market-journal",
        name: "시장 일지 작성",
        streak: 2,
        checkedDates: [date]
      },
      {
        id: "habit-water",
        name: "물 마시기",
        streak: 12,
        checkedDates: []
      }
    ],
    notes: [
      {
        id: "note-1",
        title: "오늘의 초점",
        body: "대시보드는 조용하게 유지한다. 결정하고, 기록하고, 다음 행동으로 넘어간다.",
        tags: ["오늘"],
        createdAt: `${date}T09:00:00.000Z`
      }
    ],
    stocks: [
      {
        id: "stock-005930",
        symbol: "005930.KS",
        name: "삼성전자",
        market: "KOSPI",
        marketType: "KR",
        tags: ["반도체", "한국"]
      },
      {
        id: "stock-035420",
        symbol: "035420.KS",
        name: "NAVER",
        market: "KOSPI",
        marketType: "KR",
        tags: ["플랫폼", "한국"]
      },
      {
        id: "stock-aapl",
        symbol: "AAPL",
        name: "Apple",
        market: "NASDAQ",
        marketType: "US",
        tags: ["quality", "hardware"]
      },
      {
        id: "stock-msft",
        symbol: "MSFT",
        name: "Microsoft",
        market: "NASDAQ",
        marketType: "US",
        tags: ["cloud", "ai"]
      }
    ],
    quoteCache: {},
    selectedSymbol: "005930.KS",
    selectedEventDate: date,
    calendarMonth: date.slice(0, 7),
    dashboardLayout: resetDashboardLayout()
  };
}

export function migrateState(saved, date = todayKey()) {
  const defaults = createDefaultState(date);
  if (!saved) return defaults;
  const stocks = Array.isArray(saved.stocks) && saved.stocks.length ? saved.stocks : defaults.stocks;
  return {
    ...defaults,
    ...saved,
    schemaVersion: 2,
    tasks: Array.isArray(saved.tasks) ? saved.tasks : defaults.tasks,
    events: Array.isArray(saved.events) ? saved.events : [],
    habits: Array.isArray(saved.habits) ? saved.habits : defaults.habits,
    notes: Array.isArray(saved.notes) ? saved.notes : defaults.notes,
    stocks: stocks.map((stock) => ({
      ...stock,
      marketType: stock.marketType || inferMarketType(stock.symbol)
    })),
    quoteCache: saved.quoteCache || {},
    selectedSymbol: stocks.some((stock) => stock.symbol === saved.selectedSymbol)
      ? saved.selectedSymbol
      : stocks[0]?.symbol || defaults.selectedSymbol,
    selectedEventDate: saved.selectedEventDate || date,
    calendarMonth: saved.calendarMonth || date.slice(0, 7),
    dashboardLayout: normalizeDashboardLayout(saved.dashboardLayout)
  };
}

function inferMarketType(symbol) {
  if (symbol.startsWith("^")) return "INDEX";
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) return "KR";
  return "US";
}

export function buildDashboardSummary(state, date = todayKey()) {
  const openTasksToday = state.tasks.filter((task) => task.date === date && task.status !== "done").length;
  const completedHabitsToday = state.habits.filter((habit) => habit.checkedDates.includes(date)).length;
  const eventsToday = (state.events || []).filter((event) => event.date === date).length;

  return {
    openTasksToday,
    completedHabitsToday,
    totalHabits: state.habits.length,
    watchlistCount: state.stocks.length,
    eventsToday
  };
}

export function upsertTask(state, task) {
  const exists = state.tasks.some((item) => item.id === task.id);
  return {
    ...state,
    tasks: exists
      ? state.tasks.map((item) => (item.id === task.id ? { ...item, ...task } : item))
      : [{ ...task }, ...state.tasks]
  };
}

export function toggleTask(state, taskId) {
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId ? { ...task, status: task.status === "done" ? "open" : "done" } : task
    )
  };
}

export function toggleHabitForDate(state, habitId, date = todayKey()) {
  return {
    ...state,
    habits: state.habits.map((habit) => {
      if (habit.id !== habitId) return habit;
      const checked = habit.checkedDates.includes(date);
      return {
        ...habit,
        checkedDates: checked
          ? habit.checkedDates.filter((item) => item !== date)
          : [...habit.checkedDates, date]
      };
    })
  };
}

export function addQuickNote(state, note) {
  return {
    ...state,
    notes: [{ ...note }, ...state.notes]
  };
}

export function normalizeStockSymbol(symbol, marketHint = "") {
  const trimmed = symbol.trim().toUpperCase();
  if (/^\d{6}$/.test(trimmed)) {
    return marketHint === "KOSDAQ" || marketHint === "KQ" ? `${trimmed}.KQ` : `${trimmed}.KS`;
  }
  return trimmed;
}

export function upsertStock(state, stock) {
  const symbol = normalizeStockSymbol(stock.symbol, stock.market);
  const exists = state.stocks.some((item) => item.symbol === symbol);
  const nextStock = {
    id: stock.id || `stock-${symbol.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
    name: stock.name || symbol,
    market: stock.market || (inferMarketType(symbol) === "KR" ? "KRX" : "US"),
    marketType: stock.marketType || inferMarketType(symbol),
    tags: stock.tags || [],
    symbol
  };

  return {
    ...state,
    selectedSymbol: symbol,
    stocks: exists
      ? state.stocks.map((item) => (item.symbol === symbol ? { ...item, ...nextStock } : item))
      : [...state.stocks, nextStock]
  };
}

export function selectStock(state, symbol) {
  return {
    ...state,
    selectedSymbol: symbol
  };
}

export function deleteStock(state, symbol) {
  const stocks = state.stocks.filter((stock) => stock.symbol !== symbol);
  const quoteCache = { ...(state.quoteCache || {}) };
  delete quoteCache[symbol];
  return {
    ...state,
    stocks,
    quoteCache,
    selectedSymbol: state.selectedSymbol === symbol
      ? stocks[0]?.symbol || "^KS11"
      : state.selectedSymbol
  };
}
