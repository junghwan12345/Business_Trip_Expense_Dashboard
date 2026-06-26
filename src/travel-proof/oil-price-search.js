const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeOilDateText(value, fallbackYear = "") {
  const numbers = String(value || "").match(/\d+/g)?.map(Number) || [];
  const parts = numbers.length >= 3
    ? numbers.slice(-3)
    : (numbers.length === 2 && fallbackYear ? [Number(fallbackYear), ...numbers] : []);
  if (parts.length !== 3) return "";

  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return "";

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function analyzeOilPageDates(values, fallbackYear = "") {
  const dates = [...new Set((values || [])
    .map((value) => normalizeOilDateText(value, fallbackYear))
    .filter(Boolean))]
    .sort((left, right) => right.localeCompare(left));

  if (!dates.length) {
    return { dates: [], newest: "", oldest: "", rowsPerPage: 0, averageDaysPerRow: 1 };
  }

  const spanDays = dates.length > 1
    ? Math.max(1, daysBetween(dates.at(-1), dates[0]))
    : 1;
  return {
    dates,
    newest: dates[0],
    oldest: dates.at(-1),
    rowsPerPage: dates.length,
    averageDaysPerRow: spanDays / Math.max(1, dates.length - 1)
  };
}

export function estimateOilTargetPage(targetDate, firstPageDates, maxPage = 80) {
  const target = normalizeOilDateText(targetDate);
  const page = analyzeOilPageDates(firstPageDates, target.slice(0, 4));
  if (!target || !page.dates.length || target >= page.oldest) return 1;

  const daysFromNewest = daysBetween(target, page.newest);
  const estimatedRow = daysFromNewest / Math.max(page.averageDaysPerRow, 0.5);
  return clamp(Math.floor(estimatedRow / Math.max(page.rowsPerPage, 1)) + 1, 1, maxPage);
}

export function compareOilTargetToPage(targetDate, pageDates) {
  const target = normalizeOilDateText(targetDate);
  const page = analyzeOilPageDates(pageDates, target.slice(0, 4));
  if (!target || !page.dates.length) return "unknown";
  if (page.dates.includes(target)) return "found";
  if (target > page.newest) return "previous";
  if (target < page.oldest) return "next";
  return "missing";
}

export function parseOilPriceRowsFromHtml(html) {
  const rows = [];
  const rowMatches = String(html || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => htmlCellText(match[1]));
    const dateIndex = cells.findIndex((cell) => /20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}/.test(cell));
    if (dateIndex < 0) continue;

    const dateKey = normalizeOilDateText(cells[dateIndex]);
    const priceText = cells.slice(dateIndex + 1)
      .find((cell) => /^\d[\d,]*(?:\.\d+)?$/.test(cell.replace(/\s+/g, ""))) || "";
    if (dateKey) {
      rows.push({ dateKey, dateText: cells[dateIndex], priceText: priceText.replace(/\s+/g, "") });
    }
  }
  return rows;
}

function daysBetween(olderDate, newerDate) {
  return Math.round((Date.parse(`${newerDate}T00:00:00Z`) - Date.parse(`${olderDate}T00:00:00Z`)) / DAY_MS);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function htmlCellText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#44;/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}
