export const GENERAL_TRAVEL_ITEMS = [
  "숙박비",
  "항공권·철도승차권",
  "대중교통",
  "유류대",
  "통행료(법인카드)",
  "통행료(개인카드)",
  "주차비",
  "일비",
  "활동비",
  "기타"
];

const CARD_OUTPUT_TARGETS = {
  generalTravel: "generalTravel",
  fieldVisit: "fieldVisit",
  corporateCard: "corporateCard"
};

const TRAVEL_SHEET_COLUMN_SPANS = [1, 2, 2, 1, 1, 1];

export function buildGeneralTravelPasteRows(entries = []) {
  return entries
    .filter(isOutputRow)
    .map((entry) => ({
      ...entry,
      text: excelPasteLine([
        entry.dateKey,
        entry.item,
        entry.place,
        formatWon(entry.amountWon),
        entry.summary,
        entry.note
      ], TRAVEL_SHEET_COLUMN_SPANS)
    }));
}

export function buildCorporateCardPasteRows(entries = []) {
  return entries
    .filter((entry) => isCardOutputRow(entry, CARD_OUTPUT_TARGETS.corporateCard))
    .map(cardEntryToCorporateCardRow);
}

export function buildCorporateCardGeneralTravelPasteRows(entries = []) {
  return entries
    .filter((entry) => isCardOutputRow(entry, CARD_OUTPUT_TARGETS.generalTravel))
    .map((entry) => cardEntryToTravelSheetRow(entry, TRAVEL_SHEET_COLUMN_SPANS));
}

export function buildCorporateCardFieldVisitPasteRows(entries = []) {
  return entries
    .filter((entry) => isCardOutputRow(entry, CARD_OUTPUT_TARGETS.fieldVisit))
    .map((entry) => cardEntryToTravelSheetRow(entry, TRAVEL_SHEET_COLUMN_SPANS));
}

export function buildCashExpensePasteRows(entries = []) {
  return entries
    .filter(isOutputRow)
    .map((entry) => ({
      ...entry,
      text: [
        entry.dateKey,
        entry.item,
        entry.place,
        entry.summary,
        formatWon(entry.amountWon),
        entry.note
      ].join("\t")
    }));
}

export function normalizeManualExpenseEntry(entry, prefix = "manual") {
  const dateKey = String(entry?.dateKey || "").trim();
  const item = String(entry?.item || "").trim();
  const place = String(entry?.place || "").trim();
  const summary = String(entry?.summary || "").trim();
  const note = String(entry?.note || "").trim();
  const amountWon = parseWon(entry?.amountWon);
  return {
    id: String(entry?.id || `${prefix}:${dateKey}:${Date.now()}:${Math.random().toString(16).slice(2)}`),
    dateKey,
    item,
    place,
    amountWon,
    summary,
    note
  };
}

export function pasteText(rows = []) {
  return rows.map((row) => row.text).filter(Boolean).join("\n");
}

function isOutputRow(entry) {
  return Boolean(String(entry?.dateKey || "").trim()) &&
    Boolean(Number(entry?.amountWon)) &&
    Boolean(String(entry?.item || entry?.expenseItem || "").trim());
}

function isCardOutputRow(entry, targetSheet) {
  const entryTargetSheet = entry?.targetSheet || "corporateCard";
  return isOutputRow(entry) &&
    entryTargetSheet === targetSheet &&
    entry?.status !== "excluded" &&
    entry?.category !== "excluded";
}

function cardEntryToTravelSheetRow(entry, columnSpans) {
  return {
    ...entry,
    text: excelPasteLine([
      entry.dateKey,
      entry.expenseItem || entry.item || "",
      entry.place || entry.merchantName || "",
      formatWon(entry.amountWon),
      entry.summary || entry.memo || entry.industryName || "",
      entry.note || ""
    ], columnSpans)
  };
}

function cardEntryToCorporateCardRow(entry) {
  return {
    ...entry,
    text: [
      entry.dateKey,
      entry.expenseItem || entry.item || "",
      entry.merchantName || entry.place || "",
      entry.summary || entry.memo || entry.industryName || "",
      formatWon(entry.amountWon),
      entry.note || ""
    ].join("\t")
  };
}

function parseWon(value) {
  if (typeof value === "number") {
    return Math.trunc(value);
  }
  return Number(String(value || "").replace(/[^0-9-]/g, "")) || 0;
}

function excelPasteLine(values, columnSpans = []) {
  return values
    .flatMap((value, index) => {
      const span = Math.max(1, Math.trunc(Number(columnSpans[index]) || 1));
      return [value, ...Array(span - 1).fill("")];
    })
    .join("\t");
}

function formatWon(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}
