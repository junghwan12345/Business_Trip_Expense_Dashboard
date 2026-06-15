export const koreanHolidays = {
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "삼일절 대체공휴일",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "부처님오신날 대체공휴일",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "개천절 대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절"
};

export function getKoreanHoliday(dateKey) {
  return koreanHolidays[dateKey] || "";
}

export function buildCalendarMonth(year, monthIndex, events = []) {
  const first = new Date(year, monthIndex, 1);
  const start = new Date(year, monthIndex, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateKey = toDateKey(date);
    const holidayName = getKoreanHoliday(dateKey);
    const dayEvents = events.filter((event) => event.date === dateKey);
    return {
      date: dateKey,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === monthIndex,
      isSunday: date.getDay() === 0,
      isToday: dateKey === toDateKey(new Date()),
      holidayName,
      isRedDay: date.getDay() === 0 || Boolean(holidayName),
      events: dayEvents
    };
  });

  return {
    year,
    month: monthIndex + 1,
    label: `${year}년 ${monthIndex + 1}월`,
    days
  };
}

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function upsertEvent(state, event) {
  const now = new Date().toISOString();
  const exists = (state.events || []).some((item) => item.id === event.id);
  const nextEvent = {
    memo: "",
    time: "",
    color: "blue",
    createdAt: event.createdAt || now,
    updatedAt: now,
    ...event
  };

  return {
    ...state,
    selectedEventDate: nextEvent.date,
    events: exists
      ? state.events.map((item) => (item.id === nextEvent.id ? { ...item, ...nextEvent } : item))
      : [...(state.events || []), nextEvent]
  };
}

export function deleteEvent(state, eventId) {
  return {
    ...state,
    events: (state.events || []).filter((event) => event.id !== eventId)
  };
}

export function listEventsForDate(state, dateKey) {
  return (state.events || [])
    .filter((event) => event.date === dateKey)
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}

export function setCalendarMonth(state, yearMonth) {
  return {
    ...state,
    calendarMonth: yearMonth
  };
}

export function setSelectedEventDate(state, dateKey) {
  return {
    ...state,
    selectedEventDate: dateKey,
    calendarMonth: dateKey.slice(0, 7)
  };
}
