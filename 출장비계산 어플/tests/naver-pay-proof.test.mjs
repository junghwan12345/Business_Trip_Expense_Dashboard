import assert from "node:assert/strict";
import test from "node:test";
import {
  naverPayHistoryPageUrl,
  naverPayListDateKey,
  naverPayReceiptUrl,
  orderNoDateKey,
  parseNaverPayAmount,
  parseNaverPayReceiptText
} from "../src/travel-proof/naver-pay-proof.js";

// 실제 네이버페이 영수증 화면에서 읽은 텍스트 구조
const REAL_RECEIPT_TEXT = [
  "네이버페이",
  "영수증 발급 내역",
  "뒤로가기",
  "주문번호",
  "2026071024077731",
  "구매영수증",
  "카드영수증 일괄 발급",
  "반품/교환 비용 영수증, 기타 비용은 포함되지 않습니다.",
  "장사의신몰",
  "배송비 3,500원",
  "카드영수증",
  "[장사의신 장신몰] 캠핑 음식 순대국 순대 국밥 순댓국 240g 외",
  "푸짐한 한 그릇: 순대국밥 240g",
  "수량",
  "2개",
  "금액",
  "10,000원",
  "카드영수증",
  "[장사의신 장신몰] 캠핑 음식 순대국 순대 국밥 순댓국 240g 외",
  "푸짐한 한 그릇: 돼지국밥 230g",
  "수량",
  "2개",
  "금액",
  "9,000원",
  "카드영수증",
  "장사의신몰",
  "배송비 4,000원",
  "카드영수증",
  "[장사의신 장신몰] 통팥 앙금 인절미 쑥 떡 개떡 50g 12개입",
  "쫀득쫀득 찰보리가 들어간 콩쑥개떡: 찰보리 콩쑥개떡 600g",
  "수량",
  "2개",
  "금액",
  "9,800원",
  "카드영수증",
  "신용카드 매출전표는 결제완료 시 자동 발급되며, 결제완료 후 확인 및 출력이 가능합니다.",
  "현금영수증 안내"
].join("\n");

test("주문번호 앞 8자리에서 날짜를 읽는다", () => {
  assert.equal(orderNoDateKey("2026071024077731"), "2026-07-10");
  assert.equal(orderNoDateKey("2026020914442621"), "2026-02-09");
  assert.equal(orderNoDateKey(""), "");
  assert.equal(orderNoDateKey("abc"), "");
});

test("목록의 연도 없는 날짜를 주문번호로 보정한다", () => {
  assert.equal(naverPayListDateKey("7. 10. 02:10 결제", { orderNo: "2026071024077731" }), "2026-07-10");
  // 결제일이 주문일과 다른 달이면 주문번호의 연도만 사용한다
  assert.equal(naverPayListDateKey("8. 2. 09:00 결제", { orderNo: "2026071024077731" }), "2026-08-02");
});

test("주문번호가 없으면 오늘 기준으로 연도를 추정한다", () => {
  const today = new Date(2026, 7, 2); // 2026-08-02
  assert.equal(naverPayListDateKey("7. 10. 02:10", { today }), "2026-07-10");
  // 아직 오지 않은 날짜는 작년으로 본다
  assert.equal(naverPayListDateKey("12. 25. 10:00", { today }), "2025-12-25");
});

test("영수증 URL과 목록 URL을 만든다", () => {
  assert.equal(
    naverPayReceiptUrl("2026071024077731"),
    "https://pay.naver.com/receipts/issue-history?orderNo=2026071024077731"
  );
  assert.equal(naverPayReceiptUrl(""), "");
  assert.match(naverPayHistoryPageUrl(2), /page=2&serviceChannel=SHOPPING$/);
  assert.match(naverPayHistoryPageUrl(0), /page=1&/);
});

test("금액 문자열을 숫자로 바꾼다", () => {
  assert.equal(parseNaverPayAmount("10,000원"), 10000);
  assert.equal(parseNaverPayAmount("배송비 3,500원"), 3500);
  assert.equal(parseNaverPayAmount(""), 0);
});

test("실제 영수증 텍스트에서 주문번호·품목·금액을 읽는다", () => {
  const parsed = parseNaverPayReceiptText(REAL_RECEIPT_TEXT);

  assert.equal(parsed.orderNo, "2026071024077731");
  assert.equal(parsed.dateKey, "2026-07-10");
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.deliveryFeeWon, 7500, "배송비 3,500 + 4,000");
  assert.equal(parsed.amountWon, 36300, "상품 10,000+9,000+9,800 + 배송비 7,500");

  // 상품명과 옵션이 함께 모여 분류 키워드 판정에 쓰일 수 있어야 한다
  assert.match(parsed.items[0], /순대국밥/);
  assert.match(parsed.items[1], /돼지국밥/);
  assert.match(parsed.items[2], /개떡/);
  // 수량/금액/버튼 문구는 품목에 섞이지 않아야 한다
  for (const item of parsed.items) {
    assert.doesNotMatch(item, /카드영수증|^수량$|^\d+개$/);
  }
});

test("빈 입력에서도 안전하게 동작한다", () => {
  const parsed = parseNaverPayReceiptText("");
  assert.equal(parsed.orderNo, "");
  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.amountWon, 0);
});
