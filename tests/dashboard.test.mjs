import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardSummary,
  createDefaultState,
  deleteStock,
  normalizeStockSymbol,
  toggleHabitForDate,
  upsertStock,
  upsertTask
} from "../src/dashboard/dashboard-data.js";
import {
  buildQuoteUrl,
  mapQuoteResponse,
  normalizeStockFailure
} from "../src/dashboard/stocks-api.js";

test("buildDashboardSummary counts today's open tasks and completed habits", () => {
  const state = createDefaultState("2026-05-25");
  const updated = toggleHabitForDate(state, "habit-morning-walk", "2026-05-25");

  const summary = buildDashboardSummary(updated, "2026-05-25");

  assert.equal(summary.openTasksToday, 3);
  assert.equal(summary.completedHabitsToday, 2);
  assert.equal(summary.totalHabits, 4);
  assert.equal(summary.eventsToday, 0);
});

test("upsertTask replaces an existing task without losing other tasks", () => {
  const state = createDefaultState("2026-05-25");

  const updated = upsertTask(state, {
    id: "task-review-market",
    title: "Review AAPL thesis",
    date: "2026-05-25",
    status: "done",
    priority: "high"
  });

  const changed = updated.tasks.find((task) => task.id === "task-review-market");

  assert.equal(updated.tasks.length, state.tasks.length);
  assert.equal(changed.status, "done");
  assert.equal(changed.title, "Review AAPL thesis");
});

test("toggleHabitForDate toggles a date check without mutating original state", () => {
  const state = createDefaultState("2026-05-25");

  const first = toggleHabitForDate(state, "habit-reading", "2026-05-25");
  const second = toggleHabitForDate(first, "habit-reading", "2026-05-25");

  assert.deepEqual(state.habits.find((habit) => habit.id === "habit-reading").checkedDates, []);
  assert.deepEqual(first.habits.find((habit) => habit.id === "habit-reading").checkedDates, ["2026-05-25"]);
  assert.deepEqual(second.habits.find((habit) => habit.id === "habit-reading").checkedDates, []);
});

test("upsertStock adds a stock and selects it for immediate research", () => {
  const state = createDefaultState("2026-05-25");

  const updated = upsertStock(state, {
    symbol: "googl",
    name: "Alphabet",
    market: "NASDAQ"
  });

  assert.equal(updated.selectedSymbol, "GOOGL");
  assert.equal(updated.stocks.at(-1).symbol, "GOOGL");
  assert.equal(updated.stocks.at(-1).name, "Alphabet");
});

test("normalizeStockSymbol helps Korean ticker entry", () => {
  assert.equal(normalizeStockSymbol("005930", "KOSPI"), "005930.KS");
  assert.equal(normalizeStockSymbol("035720", "KOSDAQ"), "035720.KQ");
  assert.equal(normalizeStockSymbol("aapl", "US"), "AAPL");
});

test("deleteStock removes a user stock and falls back to another selection", () => {
  const state = createDefaultState("2026-05-25");
  const updated = deleteStock({ ...state, selectedSymbol: "005930.KS" }, "005930.KS");

  assert.equal(updated.stocks.some((stock) => stock.symbol === "005930.KS"), false);
  assert.equal(updated.selectedSymbol, "035420.KS");
  assert.equal(updated.quoteCache["005930.KS"], undefined);
});

test("stock API helpers build URLs and normalize a successful quote response", () => {
  const url = buildQuoteUrl("AAPL");
  const quote = mapQuoteResponse("AAPL", {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: 191.25,
            previousClose: 189.83,
            regularMarketDayHigh: 193,
            regularMarketDayLow: 188.1,
            regularMarketOpen: 189.8,
            regularMarketTime: 1779690000
          }
        }
      ]
    }
  });

  assert.match(url, /finance\/chart\/AAPL/);
  assert.equal(quote.symbol, "AAPL");
  assert.equal(quote.price, 191.25);
  assert.equal(quote.changePercent > 0, true);
  assert.equal(quote.isFallback, false);
});

test("stock API helpers report friendly failure state", () => {
  const failure = normalizeStockFailure("MSFT", new Error("rate limited"));

  assert.equal(failure.symbol, "MSFT");
  assert.equal(failure.isFallback, true);
  assert.match(failure.message, /데이터 갱신 실패/);
});
