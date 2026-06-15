import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("travel proof page explains Google Drive sync folder workflow", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");

  assert.match(html, /Google Drive/);
  assert.match(html, /출장비증빙/);
  assert.match(html, /추가증빙\/2026-05-19\/영수증\.jpg/);
  assert.match(html, /조활비와 소모품비 쿠팡 캡처본도 같은 월 폴더 아래에 저장됩니다/);
  assert.match(html, /동기화가 끝난 뒤 PPT 생성/);
});

test("travel proof page keeps year and month inside advanced settings", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");

  assert.match(html, /<details class="advanced-settings">/);
  assert.match(html, /날짜 기준 고급 설정/);
  assert.match(html, /id="yearInput"/);
  assert.match(html, /id="monthInput"/);
});
