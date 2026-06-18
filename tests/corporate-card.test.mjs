import test from "node:test";
import assert from "node:assert/strict";

import {
  CORPORATE_CARD_EXPENSE_ITEMS,
  CORPORATE_CARD_TARGET_SHEETS,
  corporateCardEntryId,
  normalizeCorporateCardEntry,
  parseCorporateCardPaste
} from "../src/travel-proof/corporate-card.js";

test("parseCorporateCardPaste reads date merchant and final amount columns", () => {
  const text = [
    "일자\t가맹점\t최종금액\t비고",
    "2026-06-17\t문구마트\t12,300원\t사무용품",
    "2026. 6. 18.\t커피하우스\t8,500\t간식"
  ].join("\n");

  const result = parseCorporateCardPaste(text);

  assert.deepEqual(result.errors, []);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].dateKey, "2026-06-17");
  assert.equal(result.entries[0].merchantName, "문구마트");
  assert.equal(result.entries[0].amountWon, 12300);
  assert.equal(result.entries[0].category, "review");
});

test("corporate card and cash expense item options match company dropdown values", () => {
  assert.deepEqual(CORPORATE_CARD_EXPENSE_ITEMS, [
    "조직활동비(지사)",
    "조직활동비(기타)",
    "소모품(사무용품)비",
    "도서구입비",
    "우편료",
    "접대비",
    "교육운영비",
    "기타"
  ]);
});

test("corporate card target sheet options match excel output sheets", () => {
  assert.deepEqual(CORPORATE_CARD_TARGET_SHEETS, {
    generalTravel: "일반출장",
    fieldVisit: "현장매장방문출장",
    corporateCard: "법인카드사용",
    excluded: "제외"
  });
});

test("parseCorporateCardPaste accepts alternate card company headers", () => {
  const text = [
    "승인일자\t가맹점명\t이용금액",
    "26-06-17\t대구주차장\t 15,000 원 "
  ].join("\n");

  const result = parseCorporateCardPaste(text);

  assert.equal(result.errors.length, 0);
  assert.equal(result.entries[0].dateKey, "2026-06-17");
  assert.equal(result.entries[0].merchantName, "대구주차장");
  assert.equal(result.entries[0].amountWon, 15000);
});

test("parseCorporateCardPaste finds headers below copied card page summary rows", () => {
  const text = [
    "조회기간\t2026-06-01 ~ 2026-06-30",
    "카드번호\t1234-****-****-5678",
    "승인일시\t가맹점명(상호)\t승인금액(원)\t승인번호",
    "2026-06-17 12:30\t대구문구센터\t12,300\tA123"
  ].join("\n");

  const result = parseCorporateCardPaste(text);

  assert.equal(result.errors.length, 0);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].dateKey, "2026-06-17");
  assert.equal(result.entries[0].merchantName, "대구문구센터");
  assert.equal(result.entries[0].amountWon, 12300);
});

test("parseCorporateCardPaste reads KB style billing sheet columns", () => {
  const text = [
    "청구일\t승인일\t카드번호\t이용자명\t가맹점명\t업종\t결제방법\t승인금액\t할인금액\t청구원금",
    "20260715\t20260601\t4265-8697\t배*환\t터미널부속\t일시불\t일시불\t9200\t0\t9200",
    "20260715\t20260601\t4265-8697\t배*환\tKICC(세오전자상거래)\t일시불\t일시불\t12600\t0\t12600",
    "합계\t\t\t\t\t\t\t21800\t0\t21800"
  ].join("\n");

  const result = parseCorporateCardPaste(text);

  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].dateKey, "2026-06-01");
  assert.equal(result.entries[0].merchantName, "터미널부속");
  assert.equal(result.entries[0].industryName, "일시불");
  assert.equal(result.entries[0].amountWon, 9200);
  assert.equal(result.entries[1].merchantName, "KICC(세오전자상거래)");
  assert.equal(result.entries[1].industryName, "일시불");
  assert.equal(result.entries[1].amountWon, 12600);
});

test("parseCorporateCardPaste can infer columns when only card rows are pasted", () => {
  const text = [
    "2026-06-17\t대구문구센터\t12,300",
    "2026-06-18\t커피하우스\t8,500"
  ].join("\n");

  const result = parseCorporateCardPaste(text);

  assert.equal(result.errors.length, 0);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].merchantName, "대구문구센터");
  assert.equal(result.entries[1].amountWon, 8500);
});

test("parseCorporateCardPaste reports invalid rows without saving them", () => {
  const text = [
    "사용일자\t사용처\t금액",
    "2026-06-17\t\t12,300",
    "2026-06-18\t정상가맹점\t9,900"
  ].join("\n");

  const result = parseCorporateCardPaste(text);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].merchantName, "정상가맹점");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /2행/);
});

test("corporate card entry id uses date merchant and amount as duplicate key", () => {
  assert.equal(
    corporateCardEntryId({ dateKey: "2026-06-17", merchantName: "문구 마트", amountWon: 12300 }),
    corporateCardEntryId({ dateKey: "2026-06-17", merchantName: "문구마트", amountWon: 12300 })
  );
});

test("normalizeCorporateCardEntry keeps excluded entries stored with excluded status", () => {
  const entry = normalizeCorporateCardEntry({
    dateKey: "2026-06-17",
    merchantName: "제외가맹점",
    industryName: "철도",
    amountWon: "1,000",
    category: "excluded"
  });

  assert.equal(entry.status, "excluded");
  assert.equal(entry.industryName, "철도");
  assert.equal(entry.amountWon, 1000);
});

test("normalizeCorporateCardEntry stores selected excel target sheet", () => {
  const entry = normalizeCorporateCardEntry({
    dateKey: "2026-06-17",
    merchantName: "이세아주차장",
    amountWon: 5000,
    targetSheet: "fieldVisit",
    expenseItem: "주차비"
  });

  assert.equal(entry.targetSheet, "fieldVisit");
  assert.equal(entry.expenseItem, "주차비");
  assert.equal(entry.status, "confirmed");
});

test("normalizeCorporateCardEntry defaults old entries to corporate card sheet", () => {
  const entry = normalizeCorporateCardEntry({
    dateKey: "2026-06-17",
    merchantName: "문구마트",
    amountWon: 12300,
    expenseItem: "소모품(사무용품)비"
  });

  assert.equal(entry.targetSheet, "corporateCard");
  assert.equal(entry.status, "confirmed");
});
