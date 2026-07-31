import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("travel proof page keeps Google Drive onboarding without the long inline guide", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");

  assert.match(html, /Google Drive/);
  assert.match(html, /출장비증빙/);
  assert.doesNotMatch(html, /Google Drive 기본 저장 안내/);
  assert.doesNotMatch(html, /추가증빙\/2026-05-19\/영수증\.jpg/);
});

test("travel proof page keeps hidden year and month controls without the advanced guide", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /<details class="advanced-settings">/);
  assert.doesNotMatch(html, /날짜 기준 고급 설정/);
  assert.match(html, /id="yearInput"/);
  assert.match(html, /id="monthInput"/);
});

test("distance page uses the compact renewal structure without a visible fuel output", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");

  assert.match(html, /id="pageTitle">거리 유류대 통행료 캡처/);
  assert.match(html, /일반 출장 수동입력/);
  assert.match(html, /<h2><i[^>]+><\/i>출장 데이터 입력<\/h2>/);
  assert.match(html, /id="captureResultPanel"/);
  assert.match(html, /capture-target-card/);
  assert.match(html, /id="captureTargetToll"/);
  assert.match(html, /id="captureTargetRoute"/);
  assert.match(html, /id="captureTargetOil"/);
  assert.doesNotMatch(html, /id="copyFuelOutputButton"/);
  assert.doesNotMatch(html, /id="fuelOutput"/);
  assert.doesNotMatch(html, /현장매장방문출장 엑셀 붙여넣기 결과/);
});

test("distance page keeps long dealer and waypoint text visible", async () => {
  const app = await readFile(new URL("../src/travel-proof/travel-proof-app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/travel-proof/travel-proof.css", import.meta.url), "utf8");

  assert.match(app, /day\.groups\.length \? " has-schedule"/);
  assert.match(css, /calendar-day\.has-schedule/);
  assert.match(css, /manual-waypoint-grid \{\s*grid-template-columns: 1fr;/);
  assert.match(css, /calendar-entry span \{[\s\S]*overflow-wrap: anywhere;/);
});

test("remaining workspaces use the shared card design without removing the sidebar", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/travel-proof/travel-proof.css", import.meta.url), "utf8");

  for (const workspace of ["coupang-workspace", "excel-workspace", "ppt-workspace", "storage-workspace"]) {
    assert.match(html, new RegExp(workspace));
  }
  assert.match(html, /excel-workflow-guide/);
  assert.match(html, /data-excel-workflow-target="classify"/);
  assert.match(html, /data-excel-step-panel="result"/);
  assert.doesNotMatch(html, /ppt-summary-grid/);
  assert.doesNotMatch(html, /id="pptMissingCount"/);
  assert.match(html, /id="storageCleanupState"/);
  assert.match(css, /body:not\(\[data-active-page="distance"\]\) \.sidebar \{\s*display: flex;/);
  assert.match(css, /corporate-card-table thead \{[\s\S]*position: sticky;/);
  assert.match(css, /proof-type-chip/);
});

test("PPT creation stays restorable while its menu entry is removed", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /data-page-target="ppt"/);
  assert.match(html, /data-page-panel="ppt"/);
  assert.match(html, /id="createPptButton"/);
});

test("coupang workspace keeps compact allowance settings and manual entry controls", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/travel-proof/travel-proof.css", import.meta.url), "utf8");

  assert.match(html, /allowance-balance-grid/);
  assert.match(html, /allowance-card welfare-card/);
  assert.match(html, /id="welfareLimitCard"/);
  assert.match(html, /id="welfareRemainingCard"/);
  assert.match(html, /allowance-card supply-card/);
  assert.match(html, /id="supplyLimitCard"/);
  assert.match(html, /id="supplyRemainingCard"/);
  assert.match(html, /id="welfareProgressBar"/);
  assert.match(html, /id="supplyProgressBar"/);
  assert.match(html, /id="coupangPeopleInput"/);
  assert.match(html, /manual-expense-card/);
  assert.match(html, /id="toggleManualExpenseButton"/);
  assert.match(html, /id="addManualExpenseButton"/);
  assert.match(html, /ledger-history-table/);
  assert.match(html, /<tbody id="ledgerEntryList"><\/tbody>/);
  assert.doesNotMatch(html, /monthly-status-panel/);
  assert.doesNotMatch(html, /id="ledgerSummaryGrid"/);
  assert.doesNotMatch(html, /id="ledgerMonthInput"/);
  assert.doesNotMatch(html, /id="refreshLedgerButton"/);
  assert.match(css, /\.allowance-card/);
  assert.match(css, /\.allowance-progress-track/);
  assert.match(css, /\.manual-expense-grid/);
  assert.match(css, /\.ledger-history-table/);
});

test("page metadata switches title icon description and help text", async () => {
  const app = await readFile(new URL("../src/travel-proof/travel-proof-app.js", import.meta.url), "utf8");

  assert.match(app, /const PAGE_META = Object\.freeze/);
  assert.match(app, /"excel-export": \{/);
  assert.match(app, /pageIcon\.className = `ph \$\{pageMeta\.icon\}`/);
  assert.match(app, /pageDescription\.textContent = pageMeta\.description/);
  assert.match(app, /helpNote\.textContent = pageMeta\.help/);
});

test("travel proof page requires a personal Drive folder on first launch", async () => {
  const html = await readFile(new URL("../travel-proof.html", import.meta.url), "utf8");

  assert.match(html, /id="onboardingOverlay"/);
  assert.match(html, /본인 Google Drive 연결/);
  assert.match(html, /id="personalDriveRootInput"/);
  assert.match(html, /계정 비밀번호나 Google 토큰은 앱에 저장하지 않습니다/);
  assert.match(html, /id="storageHealthBanner"/);
});
