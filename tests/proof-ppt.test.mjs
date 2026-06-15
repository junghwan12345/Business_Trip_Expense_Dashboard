import test from "node:test";
import assert from "node:assert/strict";

import {
  PROOF_FOLDERS,
  parseProofDateFromFileName,
  pptFileBaseName,
  groupProofImagesByDate,
  proofSubfolder,
  proofTypeFromFileName,
  proofMonthDirectoryPath,
  selectedMonthKey,
  selectedProofMonthDirectoryMode,
  titleForProofDate
} from "../src/proof-ppt.js";

test("proof folders separate route, oil, extra, and ppt assets", () => {
  assert.deepEqual(PROOF_FOLDERS, {
    route: "거리캡처",
    oil: "유가캡처",
    extra: "추가증빙",
    ppt: "PPT"
  });
  assert.equal(proofSubfolder("route"), "거리캡처");
  assert.equal(proofSubfolder("oil"), "유가캡처");
});

test("parseProofDateFromFileName matches full and month-only Korean receipt names", () => {
  assert.equal(parseProofDateFromFileName("2026-05-19-주차영수증.jpg", "2026-05"), "2026-05-19");
  assert.equal(parseProofDateFromFileName("2026.05.20 영수증.png", "2026-05"), "2026-05-20");
  assert.equal(parseProofDateFromFileName("05-21-영수증.webp", "2026-05"), "2026-05-21");
  assert.equal(parseProofDateFromFileName("05.22 증빙.jpeg", "2026-05"), "2026-05-22");
});

test("ppt output naming and slide title use the selected month and date only", () => {
  assert.equal(pptFileBaseName("2026-05"), "2026-05-지출결의서-증빙자료.pptx");
  assert.equal(titleForProofDate("2026-05-19"), "5/19");
});

test("parseProofDateFromFileName matches short-year and Korean date proof names", () => {
  assert.equal(parseProofDateFromFileName("26-05-8 부산 양정역 대학 민영 주차장.jpg", "2026-05"), "2026-05-08");
  assert.equal(parseProofDateFromFileName("26-05-12 아세아주차장 영수증.jpg", "2026-05"), "2026-05-12");
  assert.equal(parseProofDateFromFileName("추가증빙/5월 19일/영수증.jpg", "2026-05"), "2026-05-19");
  assert.equal(parseProofDateFromFileName("2026년 5월 20일 영수증.jpg", "2026-05"), "2026-05-20");
  assert.equal(parseProofDateFromFileName("26-13-8 잘못된 날짜.jpg", "2026-05"), "");
});

test("groupProofImagesByDate combines route, oil, and extra proof images by date", () => {
  const grouped = groupProofImagesByDate([
    { type: "route", name: "2026-05-19.png" },
    { type: "oil", name: "oil-2026-05-19.png" },
    { type: "extra", name: "05-19-주차영수증.jpg" },
    { type: "route", name: "2026-05-20.png" }
  ], "2026-05");

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].dateKey, "2026-05-19");
  assert.equal(grouped[0].route.length, 1);
  assert.equal(grouped[0].oil.length, 1);
  assert.equal(grouped[0].extra.length, 1);
});

test("groupProofImagesByDate excludes explicitly dated images outside the selected month", () => {
  const grouped = groupProofImagesByDate([
    { type: "route", name: "2026-05-19.png" },
    { type: "route", name: "2026-06-01.png" }
  ], "2026-05");

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].dateKey, "2026-05-19");
});

test("proofTypeFromFileName classifies legacy flat-folder proof images", () => {
  assert.equal(proofTypeFromFileName("oil-2026-05-19.png", "route"), "oil");
  assert.equal(proofTypeFromFileName("2026-05-19.png", "route"), "route");
  assert.equal(proofTypeFromFileName("debug-2026-05-08.png", "route"), "route");
});

test("selectedMonthKey builds the PPT target month from the visible year and month inputs", () => {
  assert.equal(selectedMonthKey("2026", "5"), "2026-05");
  assert.equal(selectedMonthKey(2026, 12), "2026-12");
  assert.equal(selectedMonthKey("2026", "13"), "");
});

test("selectedProofMonthDirectoryMode detects whether the selected folder is the month folder or storage root", () => {
  assert.equal(selectedProofMonthDirectoryMode("2026-05", "2026-05"), "selected");
  assert.equal(selectedProofMonthDirectoryMode("출장증빙", "2026-05"), "child");
});

test("proofMonthDirectoryPath resolves common selected folder shapes", () => {
  assert.deepEqual(proofMonthDirectoryPath({
    selectedFolderName: "2026-05",
    entryNames: [],
    monthKey: "2026-05"
  }), []);
  assert.deepEqual(proofMonthDirectoryPath({
    selectedFolderName: "출장증빙",
    entryNames: ["2026-05"],
    monthKey: "2026-05"
  }), ["2026-05"]);
  assert.deepEqual(proofMonthDirectoryPath({
    selectedFolderName: "코덱스",
    entryNames: ["travel-proof-output"],
    monthKey: "2026-05"
  }), ["travel-proof-output", "2026-05"]);
  assert.deepEqual(proofMonthDirectoryPath({
    selectedFolderName: "5월 증빙",
    entryNames: ["거리캡처", "유가캡처", "추가증빙"],
    monthKey: "2026-05"
  }), []);
  assert.deepEqual(proofMonthDirectoryPath({
    selectedFolderName: "5월 추가자료",
    entryNames: ["추가증빙자료"],
    monthKey: "2026-05"
  }), []);
  assert.deepEqual(proofMonthDirectoryPath({
    selectedFolderName: "내가 모아둔 자료",
    entryNames: ["2026-05-08.png", "oil-2026-05-08.png"],
    monthKey: "2026-05"
  }), []);
});
