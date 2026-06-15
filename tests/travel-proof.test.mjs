import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMonthlyProofGroups,
  buildFuelExpensePasteRows,
  canRetryFailedCapture,
  canRunCapture,
  calculateFuelExpenseAmount,
  createCaptureJobs,
  createManualProofGroup,
  extractRouteDistanceKm,
  parseTravelProofTable,
  parseFuelPriceWon,
  rememberFailedCapture,
  removeFailedCapture,
  sanitizeFilePart
} from "../src/출장비/travel-proof.js";

const sampleTable = [
  "대리점명\tPOS코드\tPOS명\t유형요약\tPOS주소\t날짜\t시간",
  "하이라이트 대구\tP045763\t동성로3가_중앙파출소점\t위탁지원\t대구 중구 동성로 1 (동성로3가)\t05/08(금)\t오후",
  "(주)후(WHO)\tP267248\t율하동_율하광장점\t위탁지원\t대구 동구 안심로22길 46 (율하동)\t05/08(금)\t오전",
  "(주)후(WHO)\tP571347\t양덕동_포항법원사거리점\t일반판매점\t경북 포항시 북구 장량중앙로 52 LGU+동 1층(양덕동)\t05/12(화)\t오후",
  "(주)후(WHO)\tP320414\t두호동_두호사거리점\t위탁지원\t경북 포항시 북구 두호로 32 (두호동)\t05/12(화)\t오전"
].join("\n");

test("parseTravelProofTable reads the required Korean columns from pasted Excel data", () => {
  const rows = parseTravelProofTable(sampleTable);

  assert.equal(rows.length, 4);
  assert.equal(rows[0].posName, "동성로3가_중앙파출소점");
  assert.equal(rows[0].posAddress, "대구 중구 동성로 1 (동성로3가)");
  assert.equal(rows[0].dateLabel, "05/08(금)");
  assert.equal(rows[0].timeOfDay, "오후");
  assert.equal(rows[0].dealerName, "하이라이트 대구");
  assert.equal(rows[0].posCode, "P045763");
});

test("canRunCapture allows default server saving when no folder is selected", () => {
  assert.equal(canRunCapture({ groupCount: 1, hasDirectoryHandle: false, running: false }), true);
  assert.equal(canRunCapture({ groupCount: 0, hasDirectoryHandle: false, running: false }), false);
  assert.equal(canRunCapture({ groupCount: 1, hasDirectoryHandle: false, running: true }), false);
});

test("failed capture jobs can be remembered, replaced, and removed for retry", () => {
  const group = { dateKey: "2026-05-28", fileBaseName: "2026-05-28" };
  const other = { dateKey: "2026-05-29", fileBaseName: "2026-05-29" };

  let failedJobs = rememberFailedCapture([], group, "first failure");
  failedJobs = rememberFailedCapture(failedJobs, other, "other failure");
  failedJobs = rememberFailedCapture(failedJobs, group, "latest failure");

  assert.equal(failedJobs.length, 2);
  assert.equal(failedJobs[0].dateKey, "2026-05-29");
  assert.equal(failedJobs[1].dateKey, "2026-05-28");
  assert.equal(failedJobs[1].message, "latest failure");

  failedJobs = removeFailedCapture(failedJobs, "2026-05-28");

  assert.deepEqual(failedJobs.map((entry) => entry.dateKey), ["2026-05-29"]);
});

test("canRetryFailedCapture only enables retry when failed jobs are waiting", () => {
  assert.equal(canRetryFailedCapture({ failedCount: 1, running: false }), true);
  assert.equal(canRetryFailedCapture({ failedCount: 0, running: false }), false);
  assert.equal(canRetryFailedCapture({ failedCount: 1, running: true }), false);
});

test("extractRouteDistanceKm reads the first route distance from Naver summary text", () => {
  const summary = ["실시간 추천", "3시간 17분", "242km", "택시비 260,120원"].join("\n");

  assert.equal(extractRouteDistanceKm(summary), 242);
});

test("parseFuelPriceWon uses whole won from Naver oil close price", () => {
  assert.equal(parseFuelPriceWon("2,011.24"), 2011);
  assert.equal(parseFuelPriceWon("2010.02"), 2010);
});

test("calculateFuelExpenseAmount rounds distance divided by 8 times fuel price", () => {
  assert.equal(calculateFuelExpenseAmount(27, 2011), 6787);
});

test("buildFuelExpensePasteRows creates Excel-ready usage date through note columns", () => {
  const group = {
    dateKey: "2026-05-08",
    sourceRows: [
      { dealerName: "하이라이트 대구" },
      { dealerName: "(주)후(WHO)" }
    ]
  };

  const rows = buildFuelExpensePasteRows([
    { group, distanceKm: 27, fuelPriceWon: 2011 }
  ]);

  assert.equal(rows[0].text, "2026-05-08\t유류대\t\t6,787\t하이라이트 대구 / (주)후(WHO)\t27/8*2011");
});

test("createManualProofGroup builds a separate same-day capture item without Uplus prefix", () => {
  const group = createManualProofGroup({
    dateKey: "2026-05-08",
    start: "태왕디아너스오페라",
    destination: "태왕디아너스오페라",
    waypointNames: ["대구 진석타워 주차장", "유플러스 동인사옥"]
  });

  assert.equal(group.manual, true);
  assert.equal(group.dateKey, "2026-05-08");
  assert.equal(group.monthKey, "2026-05");
  assert.match(group.fileBaseName, /^2026-05-08-manual-/);
  assert.deepEqual(
    group.waypoints.map((waypoint) => waypoint.searchName),
    ["대구 진석타워 주차장", "유플러스 동인사옥"]
  );
  assert.deepEqual(
    group.sourceRows.map((row) => row.dealerName),
    ["대구 진석타워 주차장", "유플러스 동인사옥"]
  );
});

test("buildFuelExpensePasteRows keeps same-day manual and Excel rows separate", () => {
  const excelGroup = {
    dateKey: "2026-05-08",
    fileBaseName: "2026-05-08",
    sourceRows: [{ dealerName: "하이라이트 대구" }]
  };
  const manualGroup = createManualProofGroup({
    dateKey: "2026-05-08",
    start: "태왕디아너스오페라",
    destination: "태왕디아너스오페라",
    waypointNames: ["대구 진석타워 주차장"]
  });

  const rows = buildFuelExpensePasteRows([
    { group: excelGroup, distanceKm: 27, fuelPriceWon: 2011 },
    { group: manualGroup, distanceKm: 10, fuelPriceWon: 2011 }
  ]);

  assert.notEqual(rows[0].key, rows[1].key);
  assert.equal(rows[1].text, "2026-05-08\t유류대\t\t2,514\t대구 진석타워 주차장\t10/8*2011");
});

test("buildMonthlyProofGroups groups rows by date and orders morning before afternoon", () => {
  const groups = buildMonthlyProofGroups(parseTravelProofTable(sampleTable), {
    year: 2026,
    month: 5,
    start: "태왕디아너스오페라",
    destination: "태왕디아너스오페라"
  });

  assert.equal(groups.valid.length, 2);
  assert.equal(groups.errors.length, 0);
  assert.deepEqual(
    groups.valid[0].waypoints.map((waypoint) => waypoint.timeOfDay),
    ["오전", "오후"]
  );
  assert.deepEqual(
    groups.valid[0].waypoints.map((waypoint) => waypoint.searchName),
    ["유플러스 율하동_율하광장점", "유플러스 동성로3가_중앙파출소점"]
  );
  assert.equal(groups.valid[0].dateKey, "2026-05-08");
  assert.equal(groups.valid[0].fileBaseName, "2026-05-08");
});

test("buildMonthlyProofGroups reports duplicate same-day time slots as errors", () => {
  const duplicateTable = [
    "POS명\tPOS주소\t날짜\t시간",
    "A점\t대구 중구 A로 1\t05/08(금)\t오전",
    "B점\t대구 중구 B로 2\t05/08(금)\t오전"
  ].join("\n");

  const groups = buildMonthlyProofGroups(parseTravelProofTable(duplicateTable), {
    year: 2026,
    month: 5,
    start: "출발지",
    destination: "도착지"
  });

  assert.equal(groups.valid.length, 0);
  assert.equal(groups.errors.length, 1);
  assert.equal(groups.errors[0].dateKey, "2026-05-08");
  assert.match(groups.errors[0].message, /오전/);
});

test("buildMonthlyProofGroups accepts pasted dates even when the selected month differs", () => {
  const rows = [
    {
      sourceRowNumber: 2,
      posName: "동성로3가_중앙파출소점",
      posAddress: "대구 중구 동성로 1",
      dateLabel: "05/08(금)",
      timeOfDay: "오전"
    }
  ];

  const groups = buildMonthlyProofGroups(rows, {
    year: 2026,
    month: 6,
    start: "출발지",
    destination: "도착지"
  });

  assert.equal(groups.valid.length, 1);
  assert.equal(groups.valid[0].dateKey, "2026-05-08");
  assert.equal(groups.valid[0].monthKey, "2026-05");
  assert.equal(groups.errors.length, 0);
});

test("buildMonthlyProofGroups accepts common Excel date paste formats", () => {
  const baseRow = {
    sourceRowNumber: 2,
    posName: "동성로3가_중앙파출소점",
    posAddress: "대구 중구 동성로 1",
    timeOfDay: "오전"
  };
  const labels = ["2026-05-08", "2026. 5. 8.", "2026/05/08", "5월 8일"];

  for (const dateLabel of labels) {
    const groups = buildMonthlyProofGroups([{ ...baseRow, dateLabel }], {
      year: 2026,
      month: 5,
      start: "출발지",
      destination: "도착지"
    });

    assert.equal(groups.valid[0]?.dateKey, "2026-05-08", dateLabel);
  }
});

test("sanitizeFilePart removes Windows filename separators", () => {
  assert.equal(sanitizeFilePart("동성로/중앙:파출소점"), "동성로_중앙_파출소점");
});

test("createCaptureJobs builds month-folder PNG targets from valid date groups", () => {
  const groups = buildMonthlyProofGroups(parseTravelProofTable(sampleTable), {
    year: 2026,
    month: 5,
    start: "태왕디아너스오페라",
    destination: "태왕디아너스오페라"
  });

  const jobs = createCaptureJobs(groups.valid, "D:\\출장증빙");

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].outputDirectory, "D:\\출장증빙\\2026-05");
  assert.equal(jobs[0].outputFileName, "2026-05-08.png");
  assert.equal(jobs[0].route.waypoints[0].searchName, "유플러스 율하동_율하광장점");
  assert.equal(jobs[0].route.waypoints[0].fallbackAddress, "대구 동구 안심로22길 46 (율하동)");
});
