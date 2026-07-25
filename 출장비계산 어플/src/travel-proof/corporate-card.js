export const CORPORATE_CARD_CATEGORIES = {
  welfare: "조활비",
  supply: "소모품비",
  travel: "출장비",
  review: "확인필요",
  excluded: "제외"
};

export const CORPORATE_CARD_EXPENSE_ITEMS = [
  "조직활동비(지사)",
  "조직활동비(기타)",
  "소모품(사무용품)비",
  "도서구입비",
  "우편료",
  "접대비",
  "교육운영비",
  "기타"
];

export const CORPORATE_CARD_TARGET_SHEETS = {
  generalTravel: "일반출장",
  fieldVisit: "현장지원",
  corporateCard: "조활비/소모품비/기타",
  excluded: "제외"
};

export function corporateCardAllowanceType(entry) {
  const item = normalizeExpenseItemName(entry?.expenseItem || entry?.item);
  if (item === normalizeExpenseItemName("조직활동비(지사)") || item === normalizeExpenseItemName("조직활성비(지사)")) {
    return "welfare";
  }
  if (item === normalizeExpenseItemName("소모품(사무용품)비")) {
    return "supply";
  }
  return "";
}

const DATE_HEADERS = [
  "일자", "사용일자", "사용일시", "승인일자", "승인일시", "승인일",
  "이용일자", "이용일시", "이용일", "거래일자", "거래일시", "매입일자", "매출일자"
];
const MERCHANT_HEADERS = [
  "가맹점", "가맹점명", "가맹점명상호", "상호", "사용처", "이용가맹점", "업체명", "거래처"
];
const INDUSTRY_HEADERS = ["업종", "업종명", "가맹점업종", "업태", "업태명", "업종코드"];
const AMOUNT_HEADERS = [
  "최종금액", "이용금액", "이용금액원", "사용금액", "승인금액", "승인금액원",
  "청구금액", "청구금액원", "매출금액", "원화금액", "합계", "금액"
];

const TRANSIT_MODE_HEADERS = ["이용수단"];
const TRANSIT_START_HEADERS = ["승차역"];
const TRANSIT_END_HEADERS = ["하차역"];

export function parseCorporateCardPaste(text, { year = new Date().getFullYear() } = {}) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { entries: [], errors: [{ rowNumber: 0, message: "붙여넣은 법인카드 내역이 없습니다." }] };
  }

  const headerInfo = findHeaderRow(lines);
  const dateIndex = headerInfo.dateIndex;
  const merchantIndex = headerInfo.merchantIndex;
  const industryIndex = headerInfo.industryIndex;
  const amountIndex = headerInfo.amountIndex;
  const transitModeIndex = headerInfo.transitModeIndex;
  const transitStartIndex = headerInfo.transitStartIndex;
  const transitEndIndex = headerInfo.transitEndIndex;
  const errors = [];
  const isTransitSheet = transitModeIndex >= 0 && transitStartIndex >= 0 && transitEndIndex >= 0;

  if (dateIndex < 0) {
    errors.push({ rowNumber: 1, message: "일자/사용일자/승인일자/이용일시 열을 찾지 못했습니다." });
  }
  if (merchantIndex < 0 && !isTransitSheet) {
    errors.push({ rowNumber: 1, message: "가맹점/가맹점명 열을 찾지 못했습니다." });
  }
  if (amountIndex < 0) {
    errors.push({ rowNumber: 1, message: "최종금액/이용금액/금액 열을 찾지 못했습니다." });
  }
  if (errors.length) {
    return { entries: [], errors };
  }

  const entries = [];
  for (let index = headerInfo.headerRowIndex + 1; index < lines.length; index += 1) {
    const rowNumber = index + 1;
    const cells = splitRow(lines[index]);
    const dateKey = parseCardDate(cells[dateIndex], year);
    const transitMode = transitModeIndex >= 0 ? String(cells[transitModeIndex] || "").trim() : "";
    const transitStart = transitStartIndex >= 0 ? String(cells[transitStartIndex] || "").trim() : "";
    const transitEnd = transitEndIndex >= 0 ? String(cells[transitEndIndex] || "").trim() : "";
    const transitNote = [transitStart, transitEnd].filter(Boolean).join(" > ");
    const merchantName = String(cells[merchantIndex] || transitMode || "").trim();
    const industryName = industryIndex >= 0 ? String(cells[industryIndex] || "").trim() : isTransitSheet ? "대중교통" : "";
    const amountWon = parseWon(cells[amountIndex]);

    if (!dateKey || !merchantName || !amountWon) {
      errors.push({
        rowNumber,
        message: `${rowNumber}행: 일자, 가맹점, 최종금액을 확인해 주세요.`
      });
      continue;
    }

    const entry = normalizeCorporateCardEntry({
      dateKey,
      merchantName,
      industryName,
      amountWon,
      category: "review",
      status: "review",
      sourceType: isTransitSheet ? "publicTransit" : "",
      summary: isTransitSheet ? transitMode : "",
      note: transitNote,
      memo: ""
    });
    entries.push(entry);
  }

  return { entries, errors };
}

function findHeaderRow(lines) {
  let fallback = emptyHeaderInfo();

  for (let index = 0; index < lines.length; index += 1) {
    const headers = splitRow(lines[index]).map(normalizeHeader);
    const dateIndex = findHeaderIndex(headers, DATE_HEADERS);
    const merchantIndex = findHeaderIndex(headers, MERCHANT_HEADERS);
    const industryIndex = findHeaderIndex(headers, INDUSTRY_HEADERS);
    const amountIndex = findHeaderIndex(headers, AMOUNT_HEADERS);
    const transitModeIndex = findHeaderIndex(headers, TRANSIT_MODE_HEADERS);
    const transitStartIndex = findHeaderIndex(headers, TRANSIT_START_HEADERS);
    const transitEndIndex = findHeaderIndex(headers, TRANSIT_END_HEADERS);
    const hasMerchantSource = merchantIndex >= 0 || (transitModeIndex >= 0 && transitStartIndex >= 0 && transitEndIndex >= 0);
    const score = [dateIndex, amountIndex].filter((value) => value >= 0).length + (hasMerchantSource ? 1 : 0);

    if (score > fallback.score) {
      fallback = {
        headerRowIndex: index,
        dateIndex,
        merchantIndex,
        industryIndex,
        amountIndex,
        transitModeIndex,
        transitStartIndex,
        transitEndIndex,
        score
      };
    }
    if (score === 3) {
      return fallback;
    }
  }

  const inferred = inferHeaderFromDataRows(lines);
  return inferred.score > fallback.score ? inferred : fallback;
}

function inferHeaderFromDataRows(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitRow(lines[index]);
    if (cells.length < 3) {
      continue;
    }
    const dateIndex = cells.findIndex((cell) => Boolean(parseCardDate(cell)));
    const amountIndex = findLikelyAmountIndex(cells);
    const merchantIndex = cells.findIndex((cell, cellIndex) =>
      cellIndex !== dateIndex &&
      cellIndex !== amountIndex &&
      /[가-힣A-Za-z]/.test(String(cell || "")) &&
      !parseCardDate(cell) &&
      !parseWon(cell)
    );

    if (dateIndex >= 0 && merchantIndex >= 0 && amountIndex >= 0) {
      return {
        headerRowIndex: index - 1,
        dateIndex,
        merchantIndex,
        industryIndex: -1,
        amountIndex,
        score: 3
      };
    }
  }

  return emptyHeaderInfo();
}

function emptyHeaderInfo() {
  return {
    headerRowIndex: 0,
    dateIndex: -1,
    merchantIndex: -1,
    industryIndex: -1,
    amountIndex: -1,
    transitModeIndex: -1,
    transitStartIndex: -1,
    transitEndIndex: -1,
    score: -1
  };
}

function findLikelyAmountIndex(cells) {
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const text = String(cells[index] || "").trim();
    if (/[0-9]/.test(text) && parseWon(text)) {
      return index;
    }
  }
  return -1;
}

export function normalizeCorporateCardEntry(entry, nowIso = new Date().toISOString()) {
  const dateKey = parseCardDate(entry?.dateKey);
  if (!dateKey) {
    throw new Error("법인카드 내역 날짜가 필요합니다.");
  }

  const merchantName = String(entry?.merchantName || "").trim();
  if (!merchantName) {
    throw new Error("법인카드 내역 가맹점이 필요합니다.");
  }

  const amountWon = parseWon(entry?.amountWon);
  if (!amountWon) {
    throw new Error("법인카드 내역 최종금액이 필요합니다.");
  }

  const targetSheet = normalizeTargetSheet(entry);
  const category = targetSheet === "excluded"
    ? "excluded"
    : CORPORATE_CARD_CATEGORIES[entry?.category]
      ? entry.category
      : "review";
  const expenseItem = String(entry?.expenseItem || entry?.item || "").trim();
  const status = targetSheet === "excluded" || category === "excluded"
    ? "excluded"
    : entry?.status === "confirmed" || expenseItem
      ? "confirmed"
      : "review";

  const identityMerchantName = entry?.sourceType === "publicTransit" && entry?.note
    ? `${merchantName}:${entry.note}`
    : merchantName;

  return {
    id: String(entry?.id || corporateCardEntryId({ dateKey, merchantName: identityMerchantName, amountWon })),
    dateKey,
    merchantName,
    industryName: String(entry?.industryName || "").trim(),
    amountWon,
    category,
    targetSheet,
    expenseItem,
    summary: String(entry?.summary || "").trim(),
    note: String(entry?.note || "").trim(),
    memo: String(entry?.memo || "").trim(),
    sourceType: String(entry?.sourceType || "").trim(),
    status,
    createdAt: entry?.createdAt || nowIso,
    updatedAt: entry?.updatedAt || nowIso
  };
}

function normalizeTargetSheet(entry) {
  if (entry?.targetSheet && CORPORATE_CARD_TARGET_SHEETS[entry.targetSheet]) {
    return entry.targetSheet;
  }
  if (entry?.category === "excluded" || entry?.status === "excluded") {
    return "excluded";
  }
  return "corporateCard";
}

export function corporateCardEntryId({ dateKey, merchantName, amountWon }) {
  return `card:${dateKey}:${sanitizeIdPart(merchantName)}:${amountWon}`;
}

export function parseCardDate(value, fallbackYear = new Date().getFullYear()) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const compact = text.match(/^(20\d{2})(\d{2})(\d{2})$/);
  const full = text.match(/^(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  const shortYear = text.match(/^(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  const monthDay = text.match(/^(\d{1,2})\s*[-./월]\s*(\d{1,2})/);

  if (compact) {
    return formatDateKey(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  }
  if (full) {
    return formatDateKey(Number(full[1]), Number(full[2]), Number(full[3]));
  }
  if (shortYear) {
    return formatDateKey(2000 + Number(shortYear[1]), Number(shortYear[2]), Number(shortYear[3]));
  }
  if (monthDay) {
    return formatDateKey(Number(fallbackYear), Number(monthDay[1]), Number(monthDay[2]));
  }
  return "";
}

function splitRow(line) {
  const delimiter = line.includes("\t") ? "\t" : ",";
  return line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function normalizeHeader(value) {
  return String(value || "").replace(/[\s()[\]{}]/g, "").trim();
}

function normalizeExpenseItemName(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function findHeaderIndex(headers, candidates) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.findIndex((header) =>
    normalizedCandidates.some((candidate) => header === candidate || header.includes(candidate))
  );
}

function parseWon(value) {
  if (typeof value === "number") {
    return Math.trunc(value);
  }
  const text = String(value || "").trim();
  const negative = /^-/.test(text) || /\([^)]+\)/.test(text);
  const number = Number(text.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(number) || number === 0) {
    return 0;
  }
  return negative ? -number : number;
}

function formatDateKey(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return "";
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function sanitizeIdPart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[:\\/?#[\]@!$&'()*+,;=]/g, "_")
    .slice(0, 80);
}
