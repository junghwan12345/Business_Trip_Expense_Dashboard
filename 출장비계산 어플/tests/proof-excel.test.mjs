// 지출결의서 증빙 블록의 분류와 제목 생성을 검증합니다.
import test from "node:test";
import assert from "node:assert/strict";

import { buildExcelProofBlocks } from "../src/travel-proof/proof-excel.js";

test("buildExcelProofBlocks combines field proofs but separates expense proof kinds", () => {
  const result = buildExcelProofBlocks({
    monthKey: "2026-07",
    images: [
      { type: "route", name: "거리캡처/2026-07-15.png", path: "route.png" },
      { type: "oil", name: "유가캡처/oil-2026-07-15.png", path: "oil.png" },
      { type: "toll", name: "통행료캡처/toll-2026-07-15.png", path: "toll.png" },
      { type: "welfare", name: "조활비/2026-07-15-1.png", path: "welfare.png" },
      { type: "supply", name: "소모품비/2026-07-15-1.png", path: "supply.png" },
      { type: "other", name: "기타/2026-07-15-1.png", path: "other.png" }
    ],
    fieldVisitRows: [
      { dateKey: "2026-07-15", item: "유류대", summary: "천안 / 아산", amountWon: 22000 },
      { dateKey: "2026-07-15", item: "통행료(개인카드)", amountWon: 7000 }
    ],
    corporateCardRows: [
      { dateKey: "2026-07-15", item: "조직활동비(지사)", amountWon: 30000 },
      { dateKey: "2026-07-15", item: "조직활동비(지사)", amountWon: 19500 },
      { dateKey: "2026-07-15", item: "소모품(사무용품)비", amountWon: 12000 },
      { dateKey: "2026-07-15", item: "기타", amountWon: 24000 }
    ]
  });

  assert.deepEqual(result.blocks.map((block) => block.kind), ["field", "welfare", "supply", "other"]);
  assert.equal(result.blocks[0].images.length, 3);
  assert.equal(result.blocks[0].title, "7/15 현장지원방문_천안·아산");
  assert.equal(result.blocks[1].title, "7/15 조활비 49,500원");
  assert.equal(result.blocks[2].title, "7/15 소모품비 12,000원");
  assert.equal(result.blocks[3].title, "7/15 기타 24,000원");
  assert.equal(result.blocks.every((block) => block.needsReview === false), true);
});

test("buildExcelProofBlocks uses general travel rows for extra proof titles", () => {
  const result = buildExcelProofBlocks({
    monthKey: "2026-07",
    images: [
      { type: "extra", name: "추가증빙/2026-07-10-영수증.png", path: "receipt.png" }
    ],
    generalTravelRows: [
      { dateKey: "2026-07-10", item: "주차비", amountWon: 5000 },
      { dateKey: "2026-07-10", item: "주차비", amountWon: 3000 }
    ]
  });

  assert.equal(result.blocks[0].kind, "extra");
  assert.equal(result.blocks[0].title, "7/10 주차비 8,000원");
  assert.equal(result.blocks[0].needsReview, false);
});

test("buildExcelProofBlocks keeps unmatched and unlinked proofs visible for review", () => {
  const result = buildExcelProofBlocks({
    monthKey: "2026-07",
    images: [
      { type: "supply", name: "소모품비/2026-07-21.png", path: "supply.png" },
      { type: "extra", name: "추가증빙/날짜없음.png", path: "unknown.png" },
      {
        type: "review",
        name: "확인필요/영수증.png",
        dateKey: "2026-07-확인필요",
        path: "review.png"
      }
    ]
  });

  assert.equal(result.blocks[0].title, "7/21 소모품비");
  assert.equal(result.blocks[0].needsReview, true);
  assert.equal(result.blocks[1].title, "7월 확인필요 증빙");
  assert.equal(result.unmatchedImages.length, 1);
  assert.equal(result.unmatchedImages[0].name, "추가증빙/날짜없음.png");
});
