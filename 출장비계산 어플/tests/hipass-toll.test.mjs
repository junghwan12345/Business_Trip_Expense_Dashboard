import test from "node:test";
import assert from "node:assert/strict";

import {
  HIPASS_TOLL_ITEM,
  buildTollExpensePasteRows,
  isNoHipassTollResult,
  parseHipassReceiptText
} from "../src/travel-proof/hipass-toll.js";

const sampleReceiptText = [
  "하이패스는 빠르고 편리합니다",
  "영수증",
  "한국도로공사 서대구영업소",
  "2026년06월04일 16시57분",
  "입구영업소 : 가산",
  "1종 2,100원(카드)",
  "공급가액 : 2,100원",
  "하이패스는 빠르고 편리합니다",
  "영수증",
  "한국도로공사 가산영업소",
  "2026년06월04일 10시21분",
  "입구영업소 : 서대구",
  "1종 2,100원(카드)",
  "공급가액 : 2,100원"
].join("\n");

test("parseHipassReceiptText sums same-day receipt amounts", () => {
  const result = parseHipassReceiptText(sampleReceiptText, "2026-06-04");

  assert.equal(result.dateKey, "2026-06-04");
  assert.equal(result.count, 2);
  assert.equal(result.amountWon, 4200);
});

test("parseHipassReceiptText reads supply amount when card amount label is absent", () => {
  const result = parseHipassReceiptText("2026년06월04일\n공급가액: 2,100원", "2026-06-04");

  assert.equal(result.amountWon, 2100);
});

test("parseHipassReceiptText reads common toll amount labels", () => {
  const result = parseHipassReceiptText("2026년 7월 3일 15시 20분\n이용금액 : 4,200원", "2026-07-03");

  assert.equal(result.amountWon, 4200);
});

test("parseHipassReceiptText ignores receipts from other dates", () => {
  const result = parseHipassReceiptText(sampleReceiptText, "2026-06-05");

  assert.equal(result.count, 0);
  assert.equal(result.amountWon, 0);
});

test("parseHipassReceiptText excludes receipts issued from 21:00", () => {
  const result = parseHipassReceiptText([
    "하이패스는 빠르고 편리합니다",
    "영수증",
    "2026년06월25일 17시00분",
    "1종 1,800원(카드)",
    "하이패스는 빠르고 편리합니다",
    "영수증",
    "2026년06월25일 21시00분",
    "1종 2,700원(카드)",
    "하이패스는 빠르고 편리합니다",
    "영수증",
    "2026년06월25일 23시42분",
    "1종 1,200원(카드)"
  ].join("\n"), "2026-06-25");

  assert.equal(result.count, 1);
  assert.equal(result.excludedCount, 2);
  assert.equal(result.amountWon, 1800);
});

test("parseHipassReceiptText returns excluded count when every receipt is after 21:00", () => {
  const result = parseHipassReceiptText([
    "영수증",
    "2026년 7월 3일 23시 9분",
    "1종 1,200 원 카드)",
    "영수증",
    "2026년 7월 3일 23시 6분",
    "1종 1,200 원 카드)"
  ].join("\n"), "2026-07-03");

  assert.equal(result.count, 0);
  assert.equal(result.excludedCount, 2);
  assert.equal(result.amountWon, 0);
});

test("buildTollExpensePasteRows creates field visit toll rows", () => {
  const [row] = buildTollExpensePasteRows([{
    group: {
      dateKey: "2026-06-04",
      fileBaseName: "2026-06-04",
      sourceRows: [{ dealerName: "서대구매장" }, { dealerName: "가산매장" }]
    },
    dateKey: "2026-06-04",
    amountWon: 4200
  }]);

  assert.equal(row.key, "2026-06-04:toll");
  assert.equal(row.text, `2026-06-04\t${HIPASS_TOLL_ITEM}\t\t\t\t4,200\t서대구매장 / 가산매장\t`);
});

test("isNoHipassTollResult treats empty toll capture as completed no-result status", () => {
  assert.equal(isNoHipassTollResult({ noToll: true, amountWon: 0 }), true);
  assert.equal(isNoHipassTollResult({ amountWon: 4200, imageBase64: "abc" }), false);
});
