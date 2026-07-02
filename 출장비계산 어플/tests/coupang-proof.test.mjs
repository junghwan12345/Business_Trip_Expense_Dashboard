import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyCoupangReceipt,
  coupangOrderDateCandidates,
  coupangOrderDateKey,
  expenseLimitSummary,
  extractCoupangOrdersFromData,
  parseCoupangCaptureDates,
  parseCoupangReceiptText,
  sanitizeReceiptFilePart
} from "../src/travel-proof/coupang-proof.js";

test("parseCoupangCaptureDates accepts comma and newline separated month/day inputs", () => {
  assert.deepEqual(parseCoupangCaptureDates("06/04, 6/5\n2026-06-06", { year: 2026 }), [
    "2026-06-04",
    "2026-06-05",
    "2026-06-06"
  ]);
});

test("parseCoupangCaptureDates does not require selected month to match input", () => {
  assert.deepEqual(parseCoupangCaptureDates("5/21, 2026/7/2", { year: 2026 }), [
    "2026-05-21",
    "2026-07-02"
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

test("extractCoupangOrdersFromData reads nested order list JSON", () => {
  const orders = extractCoupangOrdersFromData({
    props: {
      pageProps: {
        domains: {
          desktopOrder: {
            orderList: [
              { orderId: 1234567890, orderedAt: "2026-06-29T02:10:00.000Z" },
              { orderId: "1234567891", orderedAt: "2026-06-29T08:30:00.000Z" }
            ]
          }
        }
      }
    }
  });

  assert.deepEqual(orders.map((order) => order.orderId), ["1234567890", "1234567891"]);
  assert.deepEqual(orders.map((order) => order.dateKey), ["2026-06-29", "2026-06-29"]);
});

test("extractCoupangOrdersFromData deduplicates order ids by date", () => {
  const orders = extractCoupangOrdersFromData({
    orderList: [
      { orderId: "5555555555", orderedAt: "2026-04-16T00:00:00+09:00" },
      { orderId: "5555555555", orderedAt: "2026-04-16T00:00:00+09:00" },
      { orderNo: "6666666666", orderDate: "2026-04-16T23:30:00+09:00" }
    ]
  });

  assert.deepEqual(orders.map((order) => order.orderId), ["5555555555", "6666666666"]);
});

test("coupangOrderDateKey normalizes orderedAt with Korea timezone", () => {
  assert.equal(coupangOrderDateKey("2026-06-28T15:30:00.000Z"), "2026-06-29");
  assert.equal(coupangOrderDateKey("not-a-date"), "");
});

test("extractCoupangOrdersFromData returns empty array when order fields are absent", () => {
  assert.deepEqual(extractCoupangOrdersFromData({ props: { pageProps: { products: [] } } }), []);
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

test("parseCoupangReceiptText extracts amount from alternate Coupang total labels", () => {
  const receipt = parseCoupangReceiptText([
    "\uac70\ub798\uba85\uc138\uc11c",
    "\uac70\ub798\uc77c\uc2dc \uc0c1\ud488\uba85 \uc218\ub7c9 \uac70\ub798\uae08\uc561",
    "2026 06 12 \uc0ac\ubb34\uc6a9 \ud14c\uc774\ud504 1 9,900",
    "\ucd5c\uc885 \uacb0\uc81c\uae08\uc561 9,900\uc6d0"
  ].join("\n"));

  assert.equal(receipt.amountWon, 9900);
});

test("parseCoupangReceiptText extracts amount from compact Coupang payment labels", () => {
  const receipt = parseCoupangReceiptText([
    "거래명세서",
    "2026. 06. 29",
    "상품명 수량 금액",
    "커피 원두 1 18,500",
    "총 결제금액 18,500원"
  ].join("\n"));

  assert.equal(receipt.dateKey, "2026-06-29");
  assert.equal(receipt.amountWon, 18500);
});

test("classifyCoupangReceipt separates welfare, supply, and review-needed receipts", () => {
  assert.equal(classifyCoupangReceipt(["과자", "커피"]).category, "welfare");
  assert.equal(classifyCoupangReceipt(["테이프", "사인펜"]).category, "supply");
  assert.equal(classifyCoupangReceipt(["과자", "물티슈"]).category, "review");
  assert.equal(classifyCoupangReceipt(["알 수 없는 상품"]).category, "review");
});

test("classifyCoupangReceipt treats decaf coffee beans as welfare", () => {
  assert.equal(classifyCoupangReceipt(["\uc77c\ub9ac \ub514\uce74\ud398\uc778 \uc6d0\ub450 250g"]).category, "welfare");
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
