import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCashExpensePasteRows,
  buildCorporateCardFieldVisitPasteRows,
  buildCorporateCardGeneralTravelPasteRows,
  buildCorporateCardPasteRows,
  buildGeneralTravelPasteRows,
  pasteHtmlTable,
  pasteText
} from "../src/travel-proof/expense-excel.js";

test("buildGeneralTravelPasteRows follows 일반출장 column order", () => {
  const [row] = buildGeneralTravelPasteRows([{
    dateKey: "2026-05-20",
    item: "주차비",
    place: "이세아주차장",
    amountWon: 5000,
    summary: "MNP 출입",
    note: "영수증 첨부"
  }]);

  assert.equal(row.text, "2026-05-20\t주차비\t\t이세아주차장\t\t5,000\tMNP 출입\t영수증 첨부");
});

test("buildGeneralTravelPasteRows applies captured 일반출장 merged-cell layout automatically", () => {
  const [row] = buildGeneralTravelPasteRows([{
    dateKey: "2026-06-02",
    item: "항공권·철도승차권",
    place: "에스와이",
    amountWon: 17400,
    summary: "출장 이동",
    note: "법인카드"
  }]);

  assert.equal(
    row.text,
    "2026-06-02\t항공권·철도승차권\t\t에스와이\t\t17,400\t출장 이동\t법인카드"
  );
});

test("buildCorporateCardPasteRows follows 법인카드사용 column order and skips excluded rows", () => {
  const rows = buildCorporateCardPasteRows([
    {
      dateKey: "2026-06-01",
      expenseItem: "조직활동비(지사)",
      merchantName: "터미널부속",
      industryName: "일시불",
      amountWon: 9200,
      summary: "회의 다과",
      note: "법인카드",
      status: "confirmed"
    },
    {
      dateKey: "2026-06-02",
      expenseItem: "기타",
      merchantName: "제외가맹점",
      amountWon: 1000,
      status: "excluded"
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, "2026-06-01\t조직활동비(지사)\t터미널부속\t회의 다과\t9,200\t법인카드");
});

test("corporate card rows route to selected excel sheet outputs", () => {
  const entries = [
    {
      dateKey: "2026-06-01",
      targetSheet: "generalTravel",
      expenseItem: "주차비",
      merchantName: "이세아주차장",
      amountWon: 5000,
      summary: "MNP출입",
      note: "법인카드"
    },
    {
      dateKey: "2026-06-02",
      targetSheet: "fieldVisit",
      expenseItem: "통행료(법인카드)",
      merchantName: "한국도로공사",
      amountWon: 19700,
      summary: "현장방문",
      note: "하이패스"
    },
    {
      dateKey: "2026-06-02",
      targetSheet: "fieldVisit",
      expenseItem: "주차비",
      merchantName: "현장주차장",
      amountWon: 3000,
      summary: "방문 주차",
      note: "법인카드"
    },
    {
      dateKey: "2026-06-03",
      targetSheet: "corporateCard",
      expenseItem: "소모품(사무용품)비",
      merchantName: "문구마트",
      amountWon: 12300,
      summary: "사무용품",
      note: "법인카드"
    }
  ];

  assert.equal(
    buildCorporateCardGeneralTravelPasteRows(entries)[0].text,
    "2026-06-01\t주차비\t\t이세아주차장\t\t5,000\tMNP출입\t법인카드"
  );
  assert.equal(
    buildCorporateCardFieldVisitPasteRows(entries)[0].text,
    "2026-06-02\t통행료(법인카드)\t\t한국도로공사\t\t19,700\t현장방문\t"
  );
  assert.equal(
    buildCorporateCardFieldVisitPasteRows(entries)[1].text,
    "2026-06-02\t주차비\t\t현장주차장\t\t3,000\t\t법인카드"
  );
  assert.equal(
    buildCorporateCardPasteRows(entries)[0].text,
    "2026-06-03\t소모품(사무용품)비\t문구마트\t사무용품\t12,300\t법인카드"
  );
});

test("buildCashExpensePasteRows follows 현금사용 column order", () => {
  const [row] = buildCashExpensePasteRows([{
    dateKey: "2026-06-03",
    item: "우편료",
    place: "우체국",
    amountWon: 4300,
    summary: "서류 발송",
    note: "현금 사용"
  }]);

  assert.equal(row.text, "2026-06-03\t우편료\t우체국\t서류 발송\t4,300\t현금 사용");
});

test("pasteText joins generated rows with newlines", () => {
  assert.equal(pasteText([{ text: "A\tB" }, { text: "C\tD" }]), "A\tB\nC\tD");
});

test("pasteHtmlTable keeps travel sheet merged column spans for Excel paste", () => {
  const rows = buildCorporateCardFieldVisitPasteRows([{
    dateKey: "2026-06-02",
    targetSheet: "fieldVisit",
    expenseItem: "유류대",
    merchantName: "하모니",
    amountWon: 23366,
    summary: "하모니 / 일선",
    note: "93/8*2010"
  }]);

  const html = pasteHtmlTable(rows);

  assert.match(html, /colspan="2"/);
  assert.match(html, /유류대/);
  assert.match(html, /하모니/);
});
