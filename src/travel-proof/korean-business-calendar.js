const KOREAN_PUBLIC_HOLIDAYS = Object.freeze({
  "2025-01-01": "신정",
  "2025-01-27": "임시공휴일",
  "2025-01-28": "설날 연휴",
  "2025-01-29": "설날",
  "2025-01-30": "설날 연휴",
  "2025-03-01": "삼일절",
  "2025-03-03": "삼일절 대체공휴일",
  "2025-05-05": "어린이날·부처님오신날",
  "2025-05-06": "대체공휴일",
  "2025-06-03": "대통령 선거일",
  "2025-06-06": "현충일",
  "2025-08-15": "광복절",
  "2025-10-03": "개천절",
  "2025-10-05": "추석 연휴",
  "2025-10-06": "추석",
  "2025-10-07": "추석 연휴",
  "2025-10-08": "추석 대체공휴일",
  "2025-10-09": "한글날",
  "2025-12-25": "성탄절",
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "삼일절 대체공휴일",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "부처님오신날 대체공휴일",
  "2026-06-03": "전국동시지방선거일",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절",
  "2026-08-17": "광복절 대체공휴일",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "개천절 대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
  "2027-01-01": "신정",
  "2027-02-06": "설날 연휴",
  "2027-02-07": "설날",
  "2027-02-08": "설날 연휴",
  "2027-02-09": "설날 대체공휴일",
  "2027-03-01": "삼일절",
  "2027-05-05": "어린이날",
  "2027-05-13": "부처님오신날",
  "2027-06-06": "현충일",
  "2027-08-15": "광복절",
  "2027-08-16": "광복절 대체공휴일",
  "2027-09-14": "추석 연휴",
  "2027-09-15": "추석",
  "2027-09-16": "추석 연휴",
  "2027-10-03": "개천절",
  "2027-10-04": "개천절 대체공휴일",
  "2027-10-09": "한글날",
  "2027-10-11": "한글날 대체공휴일",
  "2027-12-25": "성탄절",
  "2027-12-27": "성탄절 대체공휴일",
  "2028-01-01": "신정",
  "2028-01-25": "설날 연휴",
  "2028-01-26": "설날",
  "2028-01-27": "설날 연휴",
  "2028-03-01": "삼일절",
  "2028-04-12": "국회의원 선거일",
  "2028-05-02": "부처님오신날",
  "2028-05-05": "어린이날",
  "2028-06-06": "현충일",
  "2028-08-15": "광복절",
  "2028-10-02": "추석 연휴",
  "2028-10-03": "추석·개천절",
  "2028-10-04": "추석 연휴",
  "2028-10-05": "추석 대체공휴일",
  "2028-10-09": "한글날",
  "2028-12-25": "성탄절",
  "2029-01-01": "신정",
  "2029-02-12": "설날 연휴",
  "2029-02-13": "설날",
  "2029-02-14": "설날 연휴",
  "2029-03-01": "삼일절",
  "2029-05-05": "어린이날",
  "2029-05-07": "어린이날 대체공휴일",
  "2029-05-20": "부처님오신날",
  "2029-05-21": "부처님오신날 대체공휴일",
  "2029-06-06": "현충일",
  "2029-08-15": "광복절",
  "2029-09-21": "추석 연휴",
  "2029-09-22": "추석",
  "2029-09-23": "추석 연휴",
  "2029-09-24": "추석 대체공휴일",
  "2029-10-03": "개천절",
  "2029-10-09": "한글날",
  "2029-12-25": "성탄절",
  "2030-01-01": "신정",
  "2030-02-01": "설날 연휴",
  "2030-02-02": "설날",
  "2030-02-03": "설날 연휴",
  "2030-02-04": "설날 대체공휴일",
  "2030-03-01": "삼일절",
  "2030-05-05": "어린이날",
  "2030-05-06": "어린이날 대체공휴일",
  "2030-05-09": "부처님오신날",
  "2030-06-06": "현충일",
  "2030-08-15": "광복절",
  "2030-09-11": "추석 연휴",
  "2030-09-12": "추석",
  "2030-09-13": "추석 연휴",
  "2030-10-03": "개천절",
  "2030-10-09": "한글날",
  "2030-12-25": "성탄절"
});

export const BUSINESS_WEEKDAY_NAMES = Object.freeze(["월", "화", "수", "목", "금"]);

export function getKoreanHoliday(dateKey) {
  return KOREAN_PUBLIC_HOLIDAYS[String(dateKey || "")] || "";
}

export function isWeekendDate(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay();
  return day === 0 || day === 6;
}

export function buildWeekdayCalendarMonth(year, month, groups = []) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    return { weekdayNames: BUSINESS_WEEKDAY_NAMES, leadingBlankCount: 0, days: [], weekendGroups: [] };
  }

  const groupsByDate = new Map();
  for (const group of groups || []) {
    const dateKey = String(group?.dateKey || "");
    if (!groupsByDate.has(dateKey)) groupsByDate.set(dateKey, []);
    groupsByDate.get(dateKey).push(group);
  }

  const monthPrefix = `${numericYear}-${String(numericMonth).padStart(2, "0")}-`;
  const weekendGroups = (groups || []).filter((group) =>
    String(group?.dateKey || "").startsWith(monthPrefix) && isWeekendDate(group.dateKey)
  );
  const lastDay = new Date(numericYear, numericMonth, 0).getDate();
  const days = [];
  let leadingBlankCount = 0;

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(numericYear, numericMonth - 1, day);
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) continue;
    if (!days.length) leadingBlankCount = weekday - 1;
    const dateKey = `${monthPrefix}${String(day).padStart(2, "0")}`;
    days.push({
      dateKey,
      day,
      weekday,
      holidayName: getKoreanHoliday(dateKey),
      groups: groupsByDate.get(dateKey) || []
    });
  }

  return { weekdayNames: BUSINESS_WEEKDAY_NAMES, leadingBlankCount, days, weekendGroups };
}
