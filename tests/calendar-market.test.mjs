import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCalendarMonth,
  deleteEvent,
  getKoreanHoliday,
  listEventsForDate,
  upsertEvent
} from "../src/dashboard/calendar.js";
import {
  buildIssueLinks,
  defaultIndices,
  detectMarketType,
  normalizeYahooQuote,
  quoteSymbolsForState,
  shouldAutoRefreshQuotes
} from "../src/dashboard/market-data.js";
import { createDefaultState } from "../src/dashboard/dashboard-data.js";

test("buildCalendarMonth marks Korean holidays and Sundays as red days", () => {
  const month = buildCalendarMonth(2026, 2, []);
  const firstMarch = month.days.find((day) => day.date === "2026-03-01");

  assert.equal(firstMarch.holidayName, "삼일절");
  assert.equal(firstMarch.isRedDay, true);
});

test("upsertEvent, listEventsForDate, and deleteEvent manage calendar events immutably", () => {
  const state = createDefaultState("2026-05-25");
  const event = {
    id: "event-1",
    title: "실적 발표 확인",
    date: "2026-05-25",
    time: "09:30",
    memo: "장 시작 전 확인",
    color: "blue"
  };

  const added = upsertEvent(state, event);
  const edited = upsertEvent(added, { ...event, title: "실적 발표 메모 정리" });
  const removed = deleteEvent(edited, "event-1");

  assert.equal(listEventsForDate(added, "2026-05-25").length, 1);
  assert.equal(listEventsForDate(edited, "2026-05-25")[0].title, "실적 발표 메모 정리");
  assert.equal(listEventsForDate(removed, "2026-05-25").length, 0);
  assert.equal(state.events.length, 0);
});

test("market helpers classify Korean stocks, US stocks, and indices", () => {
  assert.equal(detectMarketType("005930.KS"), "KR");
  assert.equal(detectMarketType("AAPL"), "US");
  assert.equal(detectMarketType("^GSPC"), "INDEX");
  assert.deepEqual(defaultIndices.map((item) => item.symbol), ["^KS11", "^KQ11", "^GSPC", "^IXIC"]);
});

test("quoteSymbolsForState includes stocks and default indices without duplicates", () => {
  const state = createDefaultState("2026-05-25");
  const symbols = quoteSymbolsForState({
    ...state,
    stocks: [...state.stocks, { id: "stock-sp", symbol: "^GSPC", name: "S&P 500", marketType: "INDEX" }]
  });

  assert.equal(symbols.filter((symbol) => symbol === "^GSPC").length, 1);
  assert.ok(symbols.includes("^KS11"));
  assert.ok(symbols.includes("AAPL"));
});

test("normalizeYahooQuote maps Yahoo chart data into the app quote shape", () => {
  const quote = normalizeYahooQuote("^KS11", {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: 2710.3,
            previousClose: 2700,
            regularMarketTime: 1779690000,
            exchangeName: "KSC",
            shortName: "KOSPI Composite Index"
          }
        }
      ]
    }
  });

  assert.equal(quote.symbol, "^KS11");
  assert.equal(quote.price, 2710.3);
  assert.equal(quote.change, 10.3);
  assert.equal(quote.changePercent > 0, true);
  assert.equal(quote.isFallback, false);
});

test("normalizeYahooQuote includes chart points when close data is available", () => {
  const quote = normalizeYahooQuote("AAPL", {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: 120,
            previousClose: 100,
            regularMarketTime: 1779690000
          },
          indicators: {
            quote: [{ close: [100, null, 110, 120] }]
          }
        }
      ]
    }
  });

  assert.deepEqual(quote.chartPoints, [100, 110, 120]);
});

test("buildIssueLinks creates useful external issue links", () => {
  const links = buildIssueLinks({ symbol: "005930.KS", name: "삼성전자", marketType: "KR" });

  assert.equal(links.length, 3);
  assert.match(links[0].url, /finance\.naver\.com/);
  assert.match(links[1].url, /news\.google\.com/);
});

test("shouldAutoRefreshQuotes asks for refresh when quotes are missing or stale", () => {
  const state = createDefaultState("2026-05-25");
  const now = new Date("2026-05-25T10:30:00.000Z");
  const freshState = {
    ...state,
    quoteCache: Object.fromEntries(
      quoteSymbolsForState(state).map((symbol) => [
        symbol,
        { symbol, updatedAt: "2026-05-25T10:25:00.000Z", isFallback: false }
      ])
    )
  };
  const staleState = {
    ...freshState,
    quoteCache: {
      ...freshState.quoteCache,
      AAPL: { symbol: "AAPL", updatedAt: "2026-05-25T09:00:00.000Z", isFallback: false }
    }
  };

  assert.equal(shouldAutoRefreshQuotes(state, now), true);
  assert.equal(shouldAutoRefreshQuotes(freshState, now), false);
  assert.equal(shouldAutoRefreshQuotes(staleState, now), true);
});

test("getKoreanHoliday returns known holiday names", () => {
  assert.equal(getKoreanHoliday("2026-08-15"), "광복절");
  assert.equal(getKoreanHoliday("2026-08-16"), "");
});
