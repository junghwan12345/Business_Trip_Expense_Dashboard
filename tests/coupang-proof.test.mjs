import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyCoupangReceipt,
  coupangOrderDateCandidates,
  expenseLimitSummary,
  parseCoupangCaptureDates,
  parseCoupangReceiptText,
  sanitizeReceiptFilePart
} from "../src/travel-proof/coupang-proof.js";

test("parseCoupangCaptureDates accepts comma and newline separated month/day inputs", () => {
  assert.deepEqual(parseCoupangCaptureDates("06/04, 6/5\n2026-06-06", { year: 2026, month: 6 }), [
    "2026-06-04",
    "2026-06-05",
    "2026-06-06"
  ]);
});

test("coupangOrderDateCandidates builds visible Coupang order date labels", () => {
  assert.deepEqual(coupangOrderDateCandidates("2026-06-04"), [
    "2026. 6. 4 주문",
    "2026. 06. 04 주문",
    "2026년 6월 4일 주문",
    "6. 4 주문",
    "06. 04 주문",
    "2026. 6. 4",
    "2026. 06. 04",
    "2026-06-04",
    "2026/06/04",
    "2026년 6월 4일",
    "6. 4",
    "06. 04"
  ]);
});

test("parseCoupangReceiptText extracts products and final amount from transaction statement text", () => {
  const receipt = parseCoupangReceiptText([
    "거래명세표",
    "거래일시 상품명 수량 거래액",
    "2026 05 29 에이센트 디퓨저 리필, 그린에어리, 500ml, 2개 1 17,800",
    "2026 05 29 코멧 53 um 경포장용 박스 테이프 48 mm*40 m, 5개 1 3,690",
    "실제 총 결제 금액 46,530"
  ].join("\n"));

  assert.equal(receipt.dateKey, "2026-05-29");
  assert.equal(receipt.amountWon, 46530);
  assert.ok(receipt.items.some((item) => item.includes("디퓨저")));
  assert.ok(receipt.items.some((item) => item.includes("테이프")));
});

test("classifyCoupangReceipt separates welfare, supply, and review-needed receipts", () => {
  assert.equal(classifyCoupangReceipt(["과자", "커피"]).category, "welfare");
  assert.equal(classifyCoupangReceipt(["테이프", "사인펜"]).category, "supply");
  assert.equal(classifyCoupangReceipt(["과자", "물티슈"]).category, "review");
  assert.equal(classifyCoupangReceipt(["알 수 없는 상품"]).category, "review");
});

test("expenseLimitSummary calculates monthly allowance totals", () => {
  const summary = expenseLimitSummary({
    peopleCount: 3,
    entries: [
      { category: "welfare", amountWon: 12000 },
      { category: "supply", amountWon: 18500 }
    ]
  });

  assert.equal(summary.welfare.limitWon, 150000);
  assert.equal(summary.welfare.usedWon, 12000);
  assert.equal(summary.supply.limitWon, 50000);
  assert.equal(summary.supply.remainingWon, 31500);
});

test("sanitizeReceiptFilePart removes filename separators", () => {
  assert.equal(sanitizeReceiptFilePart("쿠팡/간식:음료"), "쿠팡_간식_음료");
});
