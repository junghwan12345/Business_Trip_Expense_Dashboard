import test from "node:test";
import assert from "node:assert/strict";

import {
  BUSINESS_WEEKDAY_NAMES,
  buildWeekdayCalendarMonth,
  getKoreanHoliday,
  isWeekendDate
} from "../src/travel-proof/korean-business-calendar.js";

test("weekday calendar renders Monday through Friday only", () => {
  const result = buildWeekdayCalendarMonth(2026, 6);
  assert.deepEqual(result.weekdayNames, BUSINESS_WEEKDAY_NAMES);
  assert.equal(result.days.some((day) => isWeekendDate(day.dateKey)), false);
  assert.equal(result.days.length, 22);
});

test("weekday calendar aligns a month that starts on a weekend", () => {
  const august = buildWeekdayCalendarMonth(2026, 8);
  assert.equal(august.days[0].dateKey, "2026-08-03");
  assert.equal(august.leadingBlankCount, 0);
});

test("weekday calendar keeps weekend groups outside the weekday grid", () => {
  const saturdayGroup = { dateKey: "2026-06-06", id: "weekend" };
  const mondayGroup = { dateKey: "2026-06-08", id: "weekday" };
  const result = buildWeekdayCalendarMonth(2026, 6, [saturdayGroup, mondayGroup]);
  assert.deepEqual(result.weekendGroups, [saturdayGroup]);
  assert.deepEqual(result.days.find((day) => day.dateKey === "2026-06-08").groups, [mondayGroup]);
});

test("Korean public holidays cover fixed lunar substitute and election dates", () => {
  assert.equal(getKoreanHoliday("2025-06-03"), "대통령 선거일");
  assert.equal(getKoreanHoliday("2026-05-25"), "부처님오신날 대체공휴일");
  assert.equal(getKoreanHoliday("2027-02-09"), "설날 대체공휴일");
  assert.equal(getKoreanHoliday("2028-10-03"), "추석·개천절");
  assert.equal(getKoreanHoliday("2029-09-24"), "추석 대체공휴일");
  assert.equal(getKoreanHoliday("2030-02-04"), "설날 대체공휴일");
});
