// 네이버페이 쇼핑 결제내역과 영수증 화면을 읽어 증빙 정보를 뽑아내는 판독기
export const NAVER_PAY_SHOPPING_HISTORY_URL = "https://pay.naver.com/pc/history?serviceChannel=SHOPPING";

export function naverPayHistoryPageUrl(page = 1) {
  const safePage = Math.max(1, Math.trunc(Number(page) || 1));
  return `https://pay.naver.com/pc/history?page=${safePage}&serviceChannel=SHOPPING`;
}

export function naverPayReceiptUrl(orderNo) {
  const cleaned = String(orderNo || "").replace(/[^0-9]/g, "");
  return cleaned ? `https://pay.naver.com/receipts/issue-history?orderNo=${cleaned}` : "";
}

// 주문번호 앞 8자리가 주문일(YYYYMMDD)이라 목록의 "7. 10." 표기에 연도를 채워 넣을 수 있습니다.
export function orderNoDateKey(orderNo) {
  const match = String(orderNo || "").match(/^(20\d{2})(\d{2})(\d{2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return "";
  return `${year}-${month}-${day}`;
}

// 목록에 보이는 "7. 10. 02:10" 형태(연도 없음)를 주문번호나 기준 연도로 보정합니다.
export function naverPayListDateKey(dateText, { orderNo = "", today = new Date() } = {}) {
  const fromOrderNo = orderNoDateKey(orderNo);
  const match = String(dateText || "").match(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\./);
  if (!match) return fromOrderNo;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return fromOrderNo;
  if (fromOrderNo) {
    const [year, orderMonth, orderDay] = fromOrderNo.split("-");
    // 주문일과 결제일이 같은 달이면 주문번호의 연도를 그대로 사용합니다.
    if (Number(orderMonth) === month && Number(orderDay) === day) return fromOrderNo;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // 주문번호가 없으면 오늘 기준으로 연도를 추정합니다(미래 날짜면 작년으로).
  const year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const resolvedYear = candidate.getTime() > today.getTime() ? year - 1 : year;
  return `${resolvedYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseNaverPayAmount(value) {
  return Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
}

// 영수증 발급 내역 화면의 텍스트에서 상품명과 금액을 뽑습니다.
export function parseNaverPayReceiptText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const orderNoIndex = lines.findIndex((line) => line === "주문번호");
  const orderNo = orderNoIndex >= 0 ? String(lines[orderNoIndex + 1] || "").replace(/[^0-9]/g, "") : "";

  const items = [];
  let deliveryFeeWon = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^배송비\s*[\d,]+원$/.test(line)) {
      deliveryFeeWon += parseNaverPayAmount(line);
      continue;
    }
    // "금액" 다음 줄에 실제 금액이 오고, 그 위쪽에 상품명이 있습니다.
    if (line === "금액" && lines[index + 1]) {
      const amountWon = parseNaverPayAmount(lines[index + 1]);
      const name = findItemName(lines, index);
      if (name) items.push({ name, amountWon });
    }
  }

  const itemsTotalWon = items.reduce((sum, item) => sum + item.amountWon, 0);
  return {
    orderNo,
    dateKey: orderNoDateKey(orderNo),
    items: items.map((item) => item.name),
    itemDetails: items,
    deliveryFeeWon,
    amountWon: itemsTotalWon + deliveryFeeWon,
    rawText: lines.join("\n")
  };
}

// 영수증은 [상품명] [옵션] 수량 N개 금액 N원 카드영수증 순서로 반복됩니다.
// "금액" 라벨에서 위로 올라가며 직전 구분선까지의 상품명·옵션을 모읍니다.
const RECEIPT_BLOCK_MARKERS = new Set([
  "카드영수증",
  "구매영수증",
  "현금영수증",
  "카드영수증 일괄 발급",
  "주문번호"
]);

function findItemName(lines, amountLabelIndex) {
  const collected = [];
  for (let index = amountLabelIndex - 1; index >= 0 && index >= amountLabelIndex - 8; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    if (RECEIPT_BLOCK_MARKERS.has(line)) break;
    if (line === "수량" || line === "금액") continue;
    if (/^\d+개$/.test(line)) continue;
    if (/^[\d,]+원$/.test(line)) continue;
    if (/^배송비/.test(line)) continue;
    collected.unshift(line);
  }
  return collected.join(" ").trim();
}
