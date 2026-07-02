export const HIPASS_TOLL_FOLDER = "통행료캡처";
export const HIPASS_TOLL_ITEM = "통행료(개인카드)";
export const HIPASS_TOLL_NOTE = "";

const FIELD_VISIT_EXCEL_COLUMN_SPANS = [1, 2, 2, 1, 1, 1];

export function parseHipassReceiptText(text, targetDateKey = "", options = {}) {
  const normalizedText = String(text || "").replace(/\r/g, "\n");
  const targetDate = normalizeHipassDate(targetDateKey);
  const excludeFromHour = Number.isFinite(Number(options.excludeFromHour))
    ? Number(options.excludeFromHour)
    : 21;
  const receiptBlocks = splitHipassReceiptBlocks(normalizedText);
  const entries = [];
  let excludedCount = 0;

  for (const block of receiptBlocks) {
    const issuedAt = findHipassIssuedAt(block) || findHipassIssuedAt(normalizedText);
    const dateKey = issuedAt.dateKey || findHipassDate(block) || findHipassDate(normalizedText);
    if (targetDate && dateKey && dateKey !== targetDate) {
      continue;
    }
    if (issuedAt.dateKey && issuedAt.hour >= excludeFromHour) {
      excludedCount += 1;
      continue;
    }
    const amountWon = findHipassAmount(block);
    if (amountWon > 0) {
      entries.push({
        dateKey: dateKey || targetDate,
        amountWon,
        issuedAt,
        rawText: block.trim()
      });
    }
  }

  const fallbackAmount = entries.length || excludedCount ? 0 : findHipassAmount(normalizedText);
  if (!entries.length && fallbackAmount > 0) {
    const dateKey = findHipassDate(normalizedText) || targetDate;
    if (!targetDate || !dateKey || dateKey === targetDate) {
      entries.push({ dateKey, amountWon: fallbackAmount, rawText: normalizedText.trim() });
    }
  }

  const amountWon = entries.reduce((sum, entry) => sum + entry.amountWon, 0);
  return {
    dateKey: targetDate || entries[0]?.dateKey || "",
    amountWon,
    count: entries.length,
    excludedCount,
    entries,
    hasReceipts: entries.length > 0
  };
}

export function buildTollExpensePasteRows(entries = []) {
  return entries
    .filter((entry) => Number(entry?.amountWon) > 0)
    .map((entry) => {
      const group = entry.group || {};
      const summary = dealerSummary(group);
      const cells = [
        entry.dateKey || group.dateKey,
        HIPASS_TOLL_ITEM,
        "",
        formatWon(entry.amountWon),
        summary,
        HIPASS_TOLL_NOTE
      ];

      return {
        key: `${proofGroupKey(group)}:toll`,
        dateKey: entry.dateKey || group.dateKey,
        amount: Number(entry.amountWon) || 0,
        note: HIPASS_TOLL_NOTE,
        summary,
        savedPath: entry.savedPath || "",
        cells,
        columnSpans: FIELD_VISIT_EXCEL_COLUMN_SPANS,
        text: excelPasteLine(cells, FIELD_VISIT_EXCEL_COLUMN_SPANS)
      };
    });
}

export function isNoHipassTollResult(result) {
  return Boolean(result?.noToll || (!Number(result?.amountWon) && !result?.imageBase64));
}

function splitHipassReceiptBlocks(text) {
  const normalized = String(text || "");
  const parts = normalized
    .split(/(?=하이패스는\s+빠르고\s+편리합니다|영수증\s+한국도로공사)/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [normalized];
}

function findHipassDate(text) {
  const normalized = String(text || "");
  const korean = normalized.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (korean) {
    return normalizeDateParts(korean[1], korean[2], korean[3]);
  }
  const numeric = normalized.match(/(20\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  if (numeric) {
    return normalizeDateParts(numeric[1], numeric[2], numeric[3]);
  }
  return "";
}

function findHipassIssuedAt(text) {
  const normalized = String(text || "");
  const korean = normalized.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(\d{1,2})\s*시\s*(\d{1,2})\s*분/);
  if (korean) {
    return {
      dateKey: normalizeDateParts(korean[1], korean[2], korean[3]),
      hour: Number(korean[4]),
      minute: Number(korean[5])
    };
  }
  const compactKorean = normalized.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})/);
  if (compactKorean) {
    return {
      dateKey: normalizeDateParts(compactKorean[1], compactKorean[2], compactKorean[3]),
      hour: Number(compactKorean[4]),
      minute: Number(compactKorean[5])
    };
  }
  return { dateKey: "", hour: -1, minute: 0 };
}

function findHipassAmount(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const patterns = [
    /(?:\d+\s*종\s*)?(\d[\d,]*)\s*원\s*\(\s*카드\s*\)/,
    /공급가액\s*[:：]?\s*(\d[\d,]*)\s*원/,
    /통행료\s*[:：]?\s*(\d[\d,]*)\s*원/,
    /합계\s*[:：]?\s*(\d[\d,]*)\s*원/
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return parseWon(match[1]);
    }
  }
  return 0;
}

function normalizeHipassDate(value) {
  if (!value) return "";
  const match = String(value).match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  return match ? normalizeDateParts(match[1], match[2], match[3]) : "";
}

function normalizeDateParts(year, month, day) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);
  if (!Number.isInteger(parsedYear) || !Number.isInteger(parsedMonth) || !Number.isInteger(parsedDay)) {
    return "";
  }
  if (parsedMonth < 1 || parsedMonth > 12 || parsedDay < 1 || parsedDay > 31) {
    return "";
  }
  return `${parsedYear}-${String(parsedMonth).padStart(2, "0")}-${String(parsedDay).padStart(2, "0")}`;
}

function dealerSummary(group) {
  const rows = Array.isArray(group.sourceRows) ? group.sourceRows : [];
  return rows
    .map((row) => String(row.dealerName || "").trim())
    .filter(Boolean)
    .join(" / ");
}

function proofGroupKey(groupOrDateKey) {
  if (groupOrDateKey && typeof groupOrDateKey === "object") {
    return String(groupOrDateKey.fileBaseName || groupOrDateKey.dateKey || "");
  }
  return String(groupOrDateKey || "");
}

function excelPasteLine(values, columnSpans = []) {
  return values
    .flatMap((value, index) => {
      const span = Math.max(1, Math.trunc(Number(columnSpans[index]) || 1));
      return [value, ...Array(span - 1).fill("")];
    })
    .join("\t");
}

function parseWon(value) {
  return Number(String(value || "").replace(/[^0-9-]/g, "")) || 0;
}

function formatWon(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}
