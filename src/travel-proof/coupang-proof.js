export const COUPANG_PROOF_FOLDERS = {
  welfare: "조활비",
  supply: "소모품비",
  review: "확인필요"
};

const WELFARE_KEYWORDS = [
  "과자", "쿠키", "초콜릿", "사탕", "커피", "음료", "생수", "차", "빵", "라면",
  "컵라면", "간식", "다과", "아이스크림", "주스", "탄산", "도시락", "김밥"
];

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

export function parseCoupangReceiptText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const joined = lines.join("\n");

  const dateMatch = joined.match(/(20\d{2})\s*[.\-/년 ]\s*(\d{1,2})\s*[.\-/월 ]\s*(\d{1,2})/);
  const amountMatch = joined.match(/실제\s*총\s*결제\s*금액\s*([0-9,]+)/) ||
    joined.match(/총\s*거래액\s*합계\s*([0-9,]+)/);

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
    amountWon: amountMatch ? parseWon(amountMatch[1]) : 0,
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

function sumByCategory(entries, category) {
  return entries
    .filter((entry) => entry.category === category)
    .reduce((sum, entry) => sum + (Number(entry.amountWon) || 0), 0);
}
