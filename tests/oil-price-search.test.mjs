import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeOilPageDates,
  compareOilTargetToPage,
  estimateOilTargetPage,
  normalizeOilDateText,
  parseOilPriceRowsFromHtml
} from "../src/travel-proof/oil-price-search.js";

test("normalizeOilDateText accepts spaced Naver date labels", () => {
  assert.equal(normalizeOilDateText("2026. 06. 18"), "2026-06-18");
  assert.equal(normalizeOilDateText("06.18", "2026"), "2026-06-18");
});

test("parseOilPriceRowsFromHtml reads dates and closing prices without a browser", () => {
  const html = `
    <table class="tbl_exchange today"><tbody>
      <tr><td class="date">2026. 06. 19</td><td class="num">1,701.25</td><td class="num">1.2</td></tr>
      <tr><td class="date">2026. 06. 18</td><td class="num"><strong>1,698.42</strong></td><td class="num">-0.1</td></tr>
    </tbody></table>`;

  assert.deepEqual(parseOilPriceRowsFromHtml(html), [
    { dateKey: "2026-06-19", dateText: "2026. 06. 19", priceText: "1,701.25" },
    { dateKey: "2026-06-18", dateText: "2026. 06. 18", priceText: "1,698.42" }
  ]);
});

test("estimateOilTargetPage uses the first page date density", () => {
  const firstPageDates = [
    "2026-06-30", "2026-06-29", "2026-06-26", "2026-06-25",
    "2026-06-24", "2026-06-23", "2026-06-22"
  ];
  assert.equal(estimateOilTargetPage("2026-06-18", firstPageDates), 2);
});

test("compareOilTargetToPage sends an overshot search back to the previous page", () => {
  const thirdPageDates = ["2026-06-12", "2026-06-11", "2026-06-10"];
  assert.equal(compareOilTargetToPage("2026-06-18", thirdPageDates), "previous");
  assert.equal(compareOilTargetToPage("2026-06-05", thirdPageDates), "next");
});

test("compareOilTargetToPage stops when a non-business date falls inside the page range", () => {
  const pageDates = ["2026-06-22", "2026-06-19", "2026-06-18"];
  assert.equal(compareOilTargetToPage("2026-06-20", pageDates), "missing");
  assert.deepEqual(analyzeOilPageDates(pageDates).dates, pageDates);
});
