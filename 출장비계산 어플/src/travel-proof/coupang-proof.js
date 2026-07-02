export const COUPANG_PROOF_FOLDERS = {
  welfare: "조활비",
  supply: "소모품비",
  other: "기타",
  review: "확인필요"
};

const WELFARE_KEYWORDS = [
  "과자", "쿠키", "초콜릿", "사탕", "커피", "음료", "생수", "차", "빵", "라면",
  "컵라면", "간식", "다과", "아이스크림", "주스", "탄산", "도시락", "김밥"
];

WELFARE_KEYWORDS.push("\uc6d0\ub450", "\ub514\uce74\ud398\uc778", "\uc77c\ub9ac");

const SUPPLY_KEYWORDS = [
  "테이프", "박스", "사인펜", "볼펜", "파일", "책꽂이", "디퓨저", "청소", "세제",
  "물티슈", "휴지", "장갑", "종이컵", "정수기", "공구", "사무용품", "건전지",
  "멀티탭", "문구", "청소포", "쓰레기", "봉투", "마스크"
];

export function parseCoupangCaptureDates(input, { year = new Date().getFullYear() } = {}) {
  const parsedYear = Number(year);
  if (!Number.isInteger(parsedYear)) {
    return [];
  }

  const dates = [];
  const tokens = String(input || "")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const full = token.match(/^(20\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
    const monthDay = token.match(/^(\d{1,2})[-./](\d{1,2})$/);
    const match = full || monthDay;
    if (!match) {
      continue;
    }
    const targetYear = full ? Number(match[1]) : parsedYear;
    const targetMonth = full ? Number(match[2]) : Number(match[1]);
    const targetDay = full ? Number(match[3]) : Number(match[2]);
    if (targetMonth < 1 || targetMonth > 12 || targetDay < 1 || targetDay > 31) {
      continue;
    }
    dates.push(`${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`);
  }

  return [...new Set(dates)];
}

export function coupangOrderDateCandidates(dateKey) {
  const match = String(dateKey || "").match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) {
    return [];
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return [
    `${year}. ${month}. ${day} 주문`,
    `${year}. ${String(month).padStart(2, "0")}. ${String(day).padStart(2, "0")} 주문`,
    `${year}년 ${month}월 ${day}일 주문`,
    `${month}. ${day} 주문`,
    `${String(month).padStart(2, "0")}. ${String(day).padStart(2, "0")} 주문`,
    `${year}. ${month}. ${day}`,
    `${year}. ${String(month).padStart(2, "0")}. ${String(day).padStart(2, "0")}`,
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
    `${year}년 ${month}월 ${day}일`,
    `${month}. ${day}`,
    `${String(month).padStart(2, "0")}. ${String(day).padStart(2, "0")}`
  ];
}

export function coupangOrderDateKey(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const date = typeof value === "number"
    ? new Date(value < 100000000000 ? value * 1000 : value)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return [part("year"), part("month"), part("day")].filter(Boolean).join("-");
}

export function extractCoupangOrdersFromData(data) {
  const orders = [];
  const seenObjects = new WeakSet();
  const visit = (value) => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (seenObjects.has(value)) {
      return;
    }
    seenObjects.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const orderId = coupangOrderIdFromObject(value);
    const orderedAt = value.orderedAt || value.orderDate || value.orderedDate || value.createdAt || value.paymentDate;
    const dateKey = coupangOrderDateKey(orderedAt);
    if (orderId && dateKey) {
      orders.push({ orderId, dateKey, orderedAt });
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  };

  visit(data);
  const seenIds = new Set();
  return orders.filter((order) => {
    const key = `${order.orderId}:${order.dateKey}`;
    if (seenIds.has(key)) {
      return false;
    }
    seenIds.add(key);
    return true;
  });
}

function coupangOrderIdFromObject(value) {
  for (const key of ["orderId", "orderNo", "orderNumber", "orderNumberString"]) {
    const candidate = String(value?.[key] || "").trim();
    if (/^\d{6,}$/.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

export function parseCoupangReceiptText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const joined = lines.join("\n");

  const dateMatch = joined.match(/(20\d{2})\s*[.\-/년 ]\s*(\d{1,2})\s*[.\-/월 ]\s*(\d{1,2})/);
  const amountMatch = joined.match(/실제\s*총\s*결제\s*금액\s*([0-9,]+)/) ||
    joined.match(/총\s*거래액\s*합계\s*([0-9,]+)/) ||
    joined.match(/(?:실제\s*)?총\s*결제\s*금액\s*([0-9,]+)/) ||
    joined.match(/결제\s*금액\s*합계\s*([0-9,]+)/) ||
    joined.match(/총\s*결제금액\s*([0-9,]+)/);

  const amountWon = amountMatch ? parseWon(amountMatch[1]) : findCoupangReceiptAmount(lines);

  const items = lines
    .filter((line) => /20\d{2}\s+\d{1,2}\s+\d{1,2}/.test(line))
    .map((line) => line
      .replace(/^20\d{2}\s+\d{1,2}\s+\d{1,2}\s+/, "")
      .replace(/\s+\d+\s+[0-9,]+$/, "")
      .trim())
    .filter(Boolean);

  return {
    dateKey: dateMatch
      ? `${dateMatch[1]}-${String(Number(dateMatch[2])).padStart(2, "0")}-${String(Number(dateMatch[3])).padStart(2, "0")}`
      : "",
    amountWon,
    items,
    rawText: joined
  };
}

export function classifyCoupangReceipt(items) {
  const text = (items || []).join(" ");
  const welfareHits = WELFARE_KEYWORDS.filter((keyword) => text.includes(keyword));
  const supplyHits = SUPPLY_KEYWORDS.filter((keyword) => text.includes(keyword));

  if (welfareHits.length && !supplyHits.length) {
    return { category: "welfare", label: "조활비", reasons: welfareHits };
  }
  if (supplyHits.length && !welfareHits.length) {
    return { category: "supply", label: "소모품비", reasons: supplyHits };
  }
  return {
    category: "review",
    label: "확인필요",
    reasons: [...welfareHits, ...supplyHits]
  };
}

export function expenseLimitSummary({ peopleCount = 3, entries = [], supplyLimitWon = 50000, welfarePerPersonWon = 50000 } = {}) {
  const count = Number.isFinite(Number(peopleCount)) && Number(peopleCount) > 0 ? Number(peopleCount) : 3;
  const welfareUnit = Number.isFinite(Number(welfarePerPersonWon)) && Number(welfarePerPersonWon) >= 0 ? Number(welfarePerPersonWon) : 50000;
  const supplyLimit = Number.isFinite(Number(supplyLimitWon)) && Number(supplyLimitWon) >= 0 ? Number(supplyLimitWon) : 50000;
  const welfareLimit = count * welfareUnit;
  const welfareUsed = sumByCategory(entries, "welfare");
  const supplyUsed = sumByCategory(entries, "supply");

  return {
    welfare: {
      label: "조활비",
      peopleCount: count,
      limitWon: welfareLimit,
      usedWon: welfareUsed,
      remainingWon: welfareLimit - welfareUsed
    },
    supply: {
      label: "소모품비",
      limitWon: supplyLimit,
      usedWon: supplyUsed,
      remainingWon: supplyLimit - supplyUsed
    }
  };
}

export function receiptFileBaseName({ dateKey, amountWon, site = "쿠팡" }) {
  return [
    dateKey || "날짜확인필요",
    amountWon ? String(amountWon) : "",
    sanitizeReceiptFilePart(site)
  ].filter(Boolean).join("_");
}

export function sanitizeReceiptFilePart(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "")
    .slice(0, 80);
}

function parseWon(value) {
  return Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
}

function findCoupangReceiptAmount(lines) {
  const labelPattern = new RegExp([
    "\\uc2e4\\uc81c\\s*\\ucd1d?\\s*\\uacb0\\uc81c\\s*\\uae08\\uc561",
    "\\ucd5c\\uc885\\s*\\uacb0\\uc81c\\s*\\uae08\\uc561",
    "\\ucd1d\\s*\\uacb0\\uc81c\\s*\\uae08\\uc561",
    "\\uacb0\\uc81c\\s*\\uae08\\uc561",
    "\\ucd1d\\s*\\uac70\\ub798\\s*\\ud569\\uacc4",
    "\\uac70\\ub798\\s*\\uae08\\uc561\\s*\\ud569\\uacc4",
    "\\uacb0\\uc81c\\s*\\uae08\\uc561\\s*\\ud569\\uacc4",
    "\\ucd1d\\s*\\uacb0\\uc81c\\uae08\\uc561",
    "\\ud569\\uacc4\\s*\\uae08\\uc561",
    "\\ud569\\uacc4"
  ].join("|"));

  for (const line of [...lines].reverse()) {
    if (!labelPattern.test(line)) {
      continue;
    }
    const amount = parseLastWonAmount(line);
    if (amount) {
      return amount;
    }
  }
  return 0;
}

function parseLastWonAmount(value) {
  const matches = String(value || "").match(/(?:\d{1,3}(?:,\d{3})+|\d+)\s*(?:\uc6d0)?/g) || [];
  for (const match of matches.reverse()) {
    const amount = parseWon(match);
    if (amount) {
      return amount;
    }
  }
  return 0;
}

function sumByCategory(entries, category) {
  return entries
    .filter((entry) => entry.category === category)
    .reduce((sum, entry) => sum + (Number(entry.amountWon) || 0), 0);
}
