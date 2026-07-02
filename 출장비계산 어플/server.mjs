import { spawn } from "node:child_process";
import http from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { COUPANG_PROOF_FOLDERS, receiptFileBaseName } from "./src/travel-proof/coupang-proof.js";
import { normalizeCorporateCardEntry } from "./src/travel-proof/corporate-card.js";
import { HIPASS_TOLL_FOLDER } from "./src/travel-proof/hipass-toll.js";
import { buildProofPptxBuffer } from "./src/travel-proof/proof-ppt-generator.js";
import {
  EXTRA_PROOF_FOLDER_ALIASES,
  groupProofImagesByDate,
  parseProofDateFromFileName,
  pptFileBaseName,
  proofSubfolder,
  proofTypeFromFileName
} from "./src/travel-proof/proof-ppt.js";
import { DEFAULT_JSON_BODY_LIMIT, jsonBodyLimitForPath } from "./src/shared/server-limits.js";
import { resolveDefaultOutputRoot } from "./src/shared/storage-root.js";
import {
  isLikelyGoogleDrivePath,
  isPathWithin,
  monthFolderPaths,
  normalizePersonalSettings,
  resolvePersonalDataRoot
} from "./src/shared/personal-storage.js";
import {
  buildMonthlyProofGroups,
  parseTravelProofTable
} from "./src/travel-proof/travel-proof.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const personalDataRoot = resolvePersonalDataRoot();
const personalSettingsFile = join(personalDataRoot, "personal-settings.json");
const pendingSyncRoot = join(personalDataRoot, "pending-sync");
let personalSettings = readPersonalSettingsSync();
applyPersonalSettingsToEnvironment(personalSettings);
const STORAGE_SETTING_KEYS = [
  "route",
  "oil",
  "toll",
  "extra",
  "coupang",
  "welfare",
  "supply",
  "other",
  "review",
  "ppt",
  "ledger"
];
const STORAGE_SETTINGS_FILE = join("settings", "storage-settings.json");
const EXPENSE_LEDGER_FILE = "expense-ledger.json";
const CORPORATE_CARD_LEDGER_FILE = "corporate-card-ledger.json";
const EXTERNAL_RECEIPT_OWNER_FOLDER = "배정환";
const EXTERNAL_RECEIPT_REVIEW_SUFFIX = "확인필요";

function defaultStorage() {
  return resolveDefaultOutputRoot({
    appRoot: root,
    existsSync
  });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

const automationModulePromise = import("./src/travel-proof/naver-map-automation.js");

async function loadAutomationModule() {
  return automationModulePromise;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);

  if (url.pathname === "/api/travel-proof/preview" && request.method === "POST") {
    await handleTravelProofPreview(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/storage-info" && request.method === "GET") {
    await handleStorageInfo(response);
    return;
  }

  if (url.pathname === "/api/travel-proof/personal-storage" && request.method === "GET") {
    await handlePersonalStorageInfo(response);
    return;
  }

  if (url.pathname === "/api/travel-proof/personal-storage" && request.method === "POST") {
    await handlePersonalStorageUpdate(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/personal-storage/sync" && request.method === "POST") {
    await handlePendingStorageSync(response);
    return;
  }

  if (url.pathname === "/api/travel-proof/prerequisites" && request.method === "GET") {
    await handlePrerequisites(response);
    return;
  }

  if (url.pathname === "/api/travel-proof/storage-settings" && request.method === "POST") {
    await handleStorageSettingsUpdate(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/expense-ledger" && request.method === "GET") {
    await handleExpenseLedgerRead(response);
    return;
  }

  if (url.pathname === "/api/travel-proof/expense-ledger/upsert" && request.method === "POST") {
    await handleExpenseLedgerUpsert(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/expense-ledger/delete" && request.method === "POST") {
    await handleExpenseLedgerDelete(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/corporate-card-ledger" && request.method === "GET") {
    await handleCorporateCardLedgerRead(response);
    return;
  }

  if (url.pathname === "/api/travel-proof/corporate-card-ledger/upsert" && request.method === "POST") {
    await handleCorporateCardLedgerUpsert(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/corporate-card-ledger/delete" && request.method === "POST") {
    await handleCorporateCardLedgerDelete(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/excel-write" && request.method === "POST") {
    await handleExcelWrite(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/capture" && request.method === "POST") {
    await handleTravelProofCapture(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/capture-save" && request.method === "POST") {
    await handleTravelProofCaptureSave(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/oil-capture" && request.method === "POST") {
    await handleOilProofCapture(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/oil-capture-save" && request.method === "POST") {
    await handleOilProofCaptureSave(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/toll-capture" && request.method === "POST") {
    await handleTollProofCapture(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/toll-capture-save" && request.method === "POST") {
    await handleTollProofCaptureSave(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/coupang-capture" && request.method === "POST") {
    await handleCoupangProofCapture(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/coupang-capture-save" && request.method === "POST") {
    await handleCoupangProofCaptureSave(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/ppt-create" && request.method === "POST") {
    await handleProofPptCreate(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/ppt-preview" && request.method === "POST") {
    await handleProofPptPreview(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/proof-image-delete" && request.method === "POST") {
    await handleProofImageDelete(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/ppt-build" && request.method === "POST") {
    await handleProofPptBuild(request, response);
    return;
  }

  const requested = url.pathname === "/" ? "/travel-proof.html" : url.pathname;
  const filePath = normalize(join(root, requested));

  if (!resolve(filePath).startsWith(resolve(root)) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(response);
});

async function handlePersonalStorageInfo(response) {
  const status = await personalStorageStatus();
  sendJson(response, { ok: true, settings: personalSettings, status });
}

async function handlePersonalStorageUpdate(request, response) {
  try {
    const body = await readJsonBody(request);
    const requestedDriveRoot = String(body.driveRoot || "").trim();
    if (!requestedDriveRoot) throw new Error("본인 Google Drive 폴더를 선택해 주세요.");
    const driveRoot = resolve(requestedDriveRoot);

    const selected = await stat(driveRoot);
    if (!selected.isDirectory()) throw new Error("선택한 Google Drive 경로가 폴더가 아닙니다.");
    const next = normalizePersonalSettings({
      driveRoot,
      updateRoot: body.updateRoot || personalSettings.updateRoot,
      onboardingComplete: true,
      updatedAt: new Date().toISOString()
    });
    await verifyWritableStorage(next.outputRoot, body.monthKey);
    await savePersonalSettings(next);
    personalSettings = next;
    applyPersonalSettingsToEnvironment(next);
    sendJson(response, {
      ok: true,
      settings: next,
      status: await personalStorageStatus(),
      warning: isLikelyGoogleDrivePath(driveRoot) ? "" : "Google Drive 경로인지 확인해 주세요."
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 400);
  }
}

async function handlePendingStorageSync(response) {
  try {
    if (!personalSettings.outputRoot) throw new Error("먼저 본인 Google Drive 폴더를 연결해 주세요.");
    await verifyWritableStorage(personalSettings.outputRoot);
    const moved = await movePendingDirectory(pendingSyncRoot, personalSettings.outputRoot);
    sendJson(response, { ok: true, moved, status: await personalStorageStatus() });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 409);
  }
}

async function handlePrerequisites(response) {
  const chromeCandidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  sendJson(response, {
    ok: true,
    prerequisites: {
      windows: process.platform === "win32",
      chrome: chromeCandidates.some((candidate) => existsSync(candidate)),
      googleDrive: Boolean(personalSettings.driveRoot && existsSync(personalSettings.driveRoot)),
      dataRoot: personalDataRoot,
      chromeProfileRoot: process.env.TRAVEL_PROOF_CHROME_PROFILE || join(personalDataRoot, "chrome-profile")
    }
  });
}

function readPersonalSettingsSync() {
  try {
    return normalizePersonalSettings(JSON.parse(readFileSync(personalSettingsFile, "utf8")));
  } catch {
    return normalizePersonalSettings();
  }
}

async function savePersonalSettings(settings) {
  await mkdir(personalDataRoot, { recursive: true });
  await writeFile(personalSettingsFile, JSON.stringify(settings, null, 2), "utf8");
}

function applyPersonalSettingsToEnvironment(settings) {
  if (settings.outputRoot) process.env.TRAVEL_PROOF_OUTPUT_ROOT = settings.outputRoot;
  process.env.TRAVEL_PROOF_DATA_ROOT = personalDataRoot;
  process.env.TRAVEL_PROOF_CHROME_PROFILE ||= join(personalDataRoot, "chrome-profile");
}

async function verifyWritableStorage(outputRoot, monthKey = "") {
  await mkdir(outputRoot, { recursive: true });
  await access(outputRoot, 2);
  const testFile = join(outputRoot, `.write-test-${process.pid}-${Date.now()}`);
  await writeFile(testFile, "ok", "utf8");
  await unlink(testFile);
  if (/^\d{4}-\d{2}$/.test(String(monthKey || ""))) {
    await Promise.all(monthFolderPaths(outputRoot, monthKey).map((folder) => mkdir(folder, { recursive: true })));
  }
}

async function personalStorageStatus() {
  let driveOnline = false;
  if (personalSettings.outputRoot) {
    try {
      await mkdir(personalSettings.outputRoot, { recursive: true });
      await access(personalSettings.outputRoot, 2);
      driveOnline = true;
    } catch {}
  }
  return {
    configured: personalSettings.onboardingComplete,
    driveOnline,
    usingFallback: Boolean(personalSettings.onboardingComplete && !driveOnline),
    pendingFiles: await countFiles(pendingSyncRoot)
  };
}

async function countFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const counts = await Promise.all(entries.map((entry) => entry.isDirectory()
      ? countFiles(join(directory, entry.name))
      : 1));
    return counts.reduce((sum, count) => sum + count, 0);
  } catch {
    return 0;
  }
}

async function movePendingDirectory(source, destination) {
  if (!isPathWithin(personalDataRoot, source) || !existsSync(source)) return 0;
  let moved = 0;
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    if (entry.isDirectory()) {
      moved += await movePendingDirectory(sourcePath, join(destination, entry.name));
      await rm(sourcePath, { recursive: false, force: true }).catch(() => {});
      continue;
    }
    const fileName = nextAvailableFileName(destination, entry.name);
    await copyFile(sourcePath, join(destination, fileName));
    await unlink(sourcePath);
    moved += 1;
  }
  if (source === pendingSyncRoot) await rm(source, { recursive: true, force: true }).catch(() => {});
  return moved;
}

async function handleStorageInfo(response) {
  const storage = defaultStorage();
  const settings = await readStorageSettings(storage.outputRoot);
  sendJson(response, {
    ok: true,
    storage,
    storageSettings: settings,
    effectiveStorageRoots: effectiveStorageRoots(storage.outputRoot, settings)
  });
}

async function handleStorageSettingsUpdate(request, response) {
  try {
    const body = await readJsonBody(request);
    const storage = defaultStorage();
    const settings = normalizeStorageSettings(body.storageSettings || body.overrides || {});
    await writeStorageSettings(storage.outputRoot, settings);
    sendJson(response, {
      ok: true,
      storage,
      storageSettings: settings,
      effectiveStorageRoots: effectiveStorageRoots(storage.outputRoot, settings)
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleExpenseLedgerRead(response) {
  try {
    const ledger = await readExpenseLedger();
    sendJson(response, { ok: true, ledger });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleExpenseLedgerUpsert(request, response) {
  try {
    const body = await readJsonBody(request);
    const incomingEntries = Array.isArray(body.entries) ? body.entries : [body.entry].filter(Boolean);
    const ledger = await readExpenseLedger();
    const nowIso = new Date().toISOString();
    const byId = new Map((ledger.entries || []).map((entry) => [entry.id, entry]));

    for (const incoming of incomingEntries) {
      if (shouldSkipInvalidCoupangLedgerEntry(incoming)) {
        continue;
      }
      const normalized = normalizeLedgerEntry(incoming, nowIso);
      const previous = byId.get(normalized.id);
      if (previous?.savedPath && normalized.source === "coupang" && normalized.status === "confirmed" && normalized.type !== previous.type) {
        normalized.savedPath = await moveLedgerProofFile(previous.savedPath, normalized);
      }
      byId.set(normalized.id, {
        ...previous,
        ...normalized,
        createdAt: previous?.createdAt || normalized.createdAt,
        updatedAt: nowIso
      });
    }

    const nextLedger = {
      version: 1,
      updatedAt: nowIso,
      entries: [...byId.values()].sort((left, right) =>
        String(left.dateKey || "").localeCompare(String(right.dateKey || "")) ||
        String(left.id || "").localeCompare(String(right.id || ""))
      )
    };
    await writeExpenseLedger(nextLedger);
    sendJson(response, { ok: true, ledger: nextLedger });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 400);
  }
}

async function handleExpenseLedgerDelete(request, response) {
  try {
    const body = await readJsonBody(request);
    const ids = new Set((body.ids || [body.id]).filter(Boolean).map(String));
    const ledger = await readExpenseLedger();
    const entriesToDelete = (ledger.entries || []).filter((entry) => ids.has(String(entry.id)));
    await Promise.all(entriesToDelete.map((entry) => deleteLedgerProofFile(entry.savedPath)));
    const nextLedger = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: (ledger.entries || []).filter((entry) => !ids.has(String(entry.id)))
    };
    await writeExpenseLedger(nextLedger);
    sendJson(response, { ok: true, ledger: nextLedger });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 400);
  }
}

async function handleCorporateCardLedgerRead(response) {
  try {
    const ledger = await readCorporateCardLedger();
    sendJson(response, { ok: true, ledger });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleCorporateCardLedgerUpsert(request, response) {
  try {
    const body = await readJsonBody(request);
    const incomingEntries = Array.isArray(body.entries) ? body.entries : [body.entry].filter(Boolean);
    const ledger = await readCorporateCardLedger();
    const nowIso = new Date().toISOString();
    const byId = new Map((ledger.entries || []).map((entry) => [entry.id, entry]));

    for (const incoming of incomingEntries) {
      const normalized = normalizeCorporateCardEntry(incoming, nowIso);
      const previous = byId.get(normalized.id);
      byId.set(normalized.id, {
        ...previous,
        ...normalized,
        createdAt: previous?.createdAt || normalized.createdAt,
        updatedAt: nowIso
      });
    }

    const nextLedger = {
      version: 1,
      updatedAt: nowIso,
      entries: sortCorporateCardEntries([...byId.values()])
    };
    await writeCorporateCardLedger(nextLedger);
    sendJson(response, { ok: true, ledger: nextLedger });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 400);
  }
}

async function handleCorporateCardLedgerDelete(request, response) {
  try {
    const body = await readJsonBody(request);
    const ids = new Set((body.ids || [body.id]).filter(Boolean).map(String));
    const ledger = await readCorporateCardLedger();
    const nextLedger = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: sortCorporateCardEntries((ledger.entries || []).filter((entry) => !ids.has(String(entry.id))))
    };
    await writeCorporateCardLedger(nextLedger);
    sendJson(response, { ok: true, ledger: nextLedger });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 400);
  }
}

// 내장 양식은 두 형태로 존재할 수 있습니다.
//  - expense-template.b64 : base64 텍스트 (프라이버시i DRM 자동 암호화를 피하려고 텍스트로 보관)
//  - expense-template.xlsx: 예전 방식(암호화 걱정 없는 환경) 또는 관리자 지정 원본
const EXCEL_TEMPLATE_BASENAMES = ["expense-template.b64", "expense-template.xlsx"];

// 지출결의서 양식 경로를 결정합니다.
// 1) 요청에 담긴 경로가 실제로 존재하면 그대로 사용 (관리자 본인 Drive 양식 등)
// 2) 없으면 앱에 내장된 양식(설치본/개발본)을 사용해 다른 직원도 바로 작성할 수 있게 합니다.
function resolveExcelTemplatePath(requestedPath = "") {
  const candidates = [];
  const requested = String(requestedPath || "").trim();
  if (requested) candidates.push(requested);
  if (process.env.TRAVEL_PROOF_EXCEL_TEMPLATE) {
    candidates.push(process.env.TRAVEL_PROOF_EXCEL_TEMPLATE);
  }
  const searchRoots = [];
  if (process.resourcesPath) searchRoots.push(process.resourcesPath);
  if (process.env.TRAVEL_PROOF_APP_ROOT) searchRoots.push(join(process.env.TRAVEL_PROOF_APP_ROOT, "build"));
  searchRoots.push(join(root, "build"));
  for (const searchRoot of searchRoots) {
    for (const name of EXCEL_TEMPLATE_BASENAMES) {
      candidates.push(join(searchRoot, name));
    }
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return "";
}

// base64 내장 양식이면 실제 xlsx 임시 파일로 복원해 경로를 돌려줍니다.
// 반환된 경로가 templatePath와 다르면 사용 후 삭제해야 하는 임시 파일입니다.
async function materializeExcelTemplate(templatePath) {
  if (!/\.b64$/i.test(templatePath)) return templatePath;
  const base64 = (await readFile(templatePath, "utf8")).replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error("내장 양식 복원에 실패했습니다. 양식 파일이 손상되었을 수 있습니다.");
  }
  await mkdir(personalDataRoot, { recursive: true });
  const outputPath = join(personalDataRoot, `expense-template-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
  await writeFile(outputPath, buffer);
  return outputPath;
}

async function handleExcelWrite(request, response) {
  let tempTemplatePath = "";
  try {
    const body = await readJsonBody(request, { maxBytes: 1_000_000 });
    const resolvedTemplate = resolveExcelTemplatePath(body.sourcePath);
    if (!resolvedTemplate) {
      throw new Error("지출결의서 양식 파일을 찾지 못했습니다. 앱에 내장된 양식이 없거나 지정한 경로가 올바르지 않습니다.");
    }
    const sourcePath = await materializeExcelTemplate(resolvedTemplate);
    if (sourcePath !== resolvedTemplate) tempTemplatePath = sourcePath;
    const payload = {
      sourcePath,
      monthKey: String(body.monthKey || "").trim(),
      outputFileName: excelWriteOutputFileName(body.monthKey, body.authorName),
      generalTravelRows: normalizeExcelWriteRows(body.generalTravelRows),
      fieldVisitRows: normalizeExcelWriteRows(body.fieldVisitRows),
      corporateCardRows: normalizeExcelWriteRows(body.corporateCardRows)
    };
    const result = await runExcelWriteAutomation(payload);
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  } finally {
    if (tempTemplatePath) await unlink(tempTemplatePath).catch(() => {});
  }
}

function excelWriteOutputFileName(monthKey, authorName) {
  const match = String(monthKey || "").match(/^20\d{2}-(\d{2})$/);
  if (!match) {
    throw new Error("출장비 엑셀을 만들 기준 월이 필요합니다.");
  }
  const cleanAuthor = sanitizeFileNamePart(authorName);
  if (!cleanAuthor) {
    throw new Error("작성자 이름이 필요합니다.");
  }
  return `별첨양식_통합 지출결의서_${Number(match[1])}월_${cleanAuthor}.xlsx`;
}

function sanitizeFileNamePart(value) {
  return String(value || "").trim().replace(/[<>:"\/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ");
}

function normalizeExcelWriteRows(rows) {
  return Array.isArray(rows)
    ? rows.map((row) => ({
      dateKey: String(row?.dateKey || "").trim(),
      item: String(row?.item || "").trim(),
      place: String(row?.place || "").trim(),
      amountWon: Math.trunc(Number(row?.amountWon) || 0),
      summary: String(row?.summary || "").trim(),
      note: String(row?.note || "").trim()
    })).filter((row) => row.dateKey && row.item && row.amountWon > 0)
    : [];
}

async function runExcelWriteAutomation(payload) {
  const inputPath = join(personalDataRoot, `excel-write-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await mkdir(personalDataRoot, { recursive: true });
  await writeFile(inputPath, JSON.stringify(payload), "utf8");
  const scriptPath = join(root, "src", "travel-proof", "excel-write-com.ps1");
  try {
    const { stdout, stderr } = await runProcess("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-InputJson",
      inputPath
    ], { timeoutMs: 120000 });
    const output = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}";
    const result = JSON.parse(output);
    if (!result.ok) {
      throw new Error(`${result.message || "엑셀 작성에 실패했습니다."}${result.line ? ` (line ${result.line})` : ""}`);
    }
    return result;
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

function runProcess(command, args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("엑셀 작성 시간이 초과되었습니다."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || stdout.trim().startsWith("{")) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `프로세스가 실패했습니다. 종료 코드 ${code}`));
      }
    });
  });
}

async function handleTravelProofPreview(request, response) {
  try {
    const body = await readJsonBody(request);
    const rows = parseTravelProofTable(body.tableText);
    const groups = buildMonthlyProofGroups(rows, {
      year: body.year,
      month: body.month,
      start: body.start,
      destination: body.destination
    });

    sendJson(response, {
      ok: true,
      groups: groups.valid,
      errors: groups.errors,
      rowCount: rows.length
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 400);
  }
}

async function handleTravelProofCapture(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureNaverRoute } = await loadAutomationModule();
    const result = await captureNaverRoute(body.job, { fastCapture: body.fastCapture });
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleTravelProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureNaverRoute } = await loadAutomationModule();
    const result = await captureNaverRoute(body.job, { fastCapture: body.fastCapture });
    const outputRoot = body.outputRoot || await storageRootFor("route");
    const monthKey = result.dateKey.slice(0, 7);
    const outputDirectory = join(outputRoot, monthKey, proofSubfolder("route"));
    await mkdir(outputDirectory, { recursive: true });

    await ensureProofMonthFolders(outputRoot, monthKey);
    const fileName = nextAvailableFileName(outputDirectory, result.fileName);
    const filePath = join(outputDirectory, fileName);
    await writeFile(filePath, Buffer.from(result.imageBase64, "base64"));

    sendJson(response, {
      ok: true,
      result: {
        ...result,
        savedPath: filePath,
        savedFileName: fileName
      }
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleOilProofCapture(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureOilPriceProof } = await loadAutomationModule();
    const result = await captureOilPriceProof(body.dateKey, { fastCapture: body.fastCapture });
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleOilProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureOilPriceProof } = await loadAutomationModule();
    const result = await captureOilPriceProof(body.dateKey, { fastCapture: body.fastCapture });
    const outputRoot = body.outputRoot || await storageRootFor("oil");
    const monthKey = result.dateKey.slice(0, 7);
    const outputDirectory = join(outputRoot, monthKey, proofSubfolder("oil"));
    await mkdir(outputDirectory, { recursive: true });

    await ensureProofMonthFolders(outputRoot, monthKey);
    const fileName = nextAvailableFileName(outputDirectory, result.fileName);
    const filePath = join(outputDirectory, fileName);
    await writeFile(filePath, Buffer.from(result.imageBase64, "base64"));

    sendJson(response, {
      ok: true,
      result: {
        ...result,
        savedPath: filePath,
        savedFileName: fileName
      }
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleTollProofCapture(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureHipassTollReceipt } = await loadAutomationModule();
    const result = await captureHipassTollReceipt(body.dateKey, { fastCapture: body.fastCapture });
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleTollProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureHipassTollReceipt } = await loadAutomationModule();
    const result = await captureHipassTollReceipt(body.dateKey, { fastCapture: body.fastCapture });
    if (!Number(result.amountWon) || !result.imageBase64) {
      sendJson(response, { ok: true, result });
      return;
    }

    const outputRoot = body.outputRoot || await storageRootFor("toll");
    const monthKey = result.dateKey.slice(0, 7);
    const outputDirectory = join(outputRoot, monthKey, HIPASS_TOLL_FOLDER);
    await mkdir(outputDirectory, { recursive: true });

    await ensureProofMonthFolders(outputRoot, monthKey);
    const fileName = nextAvailableFileName(outputDirectory, result.fileName);
    const filePath = join(outputDirectory, fileName);
    await writeFile(filePath, Buffer.from(result.imageBase64, "base64"));

    sendJson(response, {
      ok: true,
      result: {
        ...result,
        savedPath: filePath,
        savedFileName: fileName
      }
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleCoupangProofCapture(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureCoupangReceipts } = await loadAutomationModule();
    const result = await captureCoupangReceipts({ dateKeys: body.dateKeys || [] });
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleCoupangProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const outputRoot = body.outputRoot || await storageRootFor("coupang");
    const { captureCoupangReceipts } = await loadAutomationModule();
    const result = await captureCoupangReceipts({ dateKeys: body.dateKeys || [] });
    const savedResults = [];
    const existingLedger = await readExpenseLedger();
    const existingLedgerById = new Map((existingLedger.entries || []).map((entry) => [entry.id, entry]));
    const seenReceiptKeys = new Set();

    for (const receipt of result.results || []) {
      const ledgerId = coupangLedgerEntryId(receipt);
      const receiptKey = coupangReceiptDuplicateKey(receipt);
      if (seenReceiptKeys.has(receiptKey)) {
        savedResults.push({ ...receipt, duplicate: true });
        continue;
      }
      seenReceiptKeys.add(receiptKey);
      const existingEntry = existingLedgerById.get(ledgerId);
      if (existingEntry) {
        savedResults.push({
          ...receipt,
          savedPath: existingEntry.savedPath || "",
          savedFileName: existingEntry.savedPath ? basename(existingEntry.savedPath) : receipt.fileName,
          duplicate: true
        });
        continue;
      }
      const monthKey = receipt.dateKey.slice(0, 7);
      const folderName = COUPANG_PROOF_FOLDERS[receipt.category] || COUPANG_PROOF_FOLDERS.review;
      const categoryRoot = body.outputRoot || await storageRootFor(receipt.category);
      const outputDirectory = join(categoryRoot || outputRoot, monthKey, folderName);
      await mkdir(outputDirectory, { recursive: true });
      const baseName = receiptFileBaseName({
        dateKey: receipt.dateKey,
        amountWon: receipt.amountWon,
        site: "쿠팡"
      });
      const fileName = nextAvailableFileName(outputDirectory, `${baseName}.png`);
      const filePath = join(outputDirectory, fileName);
      await writeFile(filePath, Buffer.from(receipt.imageBase64, "base64"));
      const savedReceipt = {
        ...receipt,
        savedPath: filePath,
        savedFileName: fileName
      };
      savedResults.push(savedReceipt);
    }

    const ledgerEntries = savedResults
      .filter((receipt) => Number(receipt.amountWon) > 0)
      .filter((receipt) => !receipt.duplicate)
      .map(receiptToLedgerEntry);
    const ledger = ledgerEntries.length
      ? await upsertLedgerEntries(ledgerEntries)
      : await readExpenseLedger();

    sendJson(response, {
      ok: true,
      result: {
        ...result,
        results: savedResults,
        outputRoot,
        ledger
      }
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleProofPptCreate(request, response) {
  try {
    const body = await readJsonBody(request);
    const outputRoot = body.outputRoot || await storageRootFor("ppt");
    const monthKey = body.monthKey;
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) {
      throw new Error("PPT를 만들 기준 월이 필요합니다.");
    }

    const monthDirectory = join(outputRoot, monthKey);
    const pptDirectory = join(monthDirectory, proofSubfolder("ppt"));
    await ensureProofMonthFolders(outputRoot, monthKey);
    const { images } = await readProofImageCandidatesFromMonthDirectory(monthDirectory, monthKey);
    const buffer = await buildProofPptxBuffer({ monthKey, images });
    const fileName = nextAvailableFileName(pptDirectory, pptFileBaseName(monthKey));
    const filePath = join(pptDirectory, fileName);
    await writeFile(filePath, buffer);

    sendJson(response, {
      ok: true,
      result: {
        savedPath: filePath,
        savedFileName: fileName,
        imageCount: images.length
      }
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleProofPptPreview(request, response) {
  try {
    const body = await readJsonBody(request);
    const outputRoot = body.outputRoot || await storageRootFor("ppt");
    const monthKey = body.monthKey;
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) {
      throw new Error("PPT瑜?留뚮뱾 湲곗? ?붿씠 ?꾩슂?⑸땲??");
    }

    const monthDirectory = join(outputRoot, monthKey);
    const { images, unmatchedImages } = await readProofImageCandidatesFromMonthDirectory(monthDirectory, monthKey);
    const groups = await groupsWithPreviewData(groupProofImagesByDate(images, monthKey));

    sendJson(response, {
      ok: true,
      result: {
        outputRoot,
        monthDirectory,
        groups,
        unmatchedImages,
        imageCount: images.length
      }
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleProofImageDelete(request, response) {
  try {
    const body = await readJsonBody(request);
    const outputRoot = body.outputRoot || await storageRootFor("ppt");
    const monthKey = body.monthKey;
    const imageName = String(body.name || "").trim();
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) {
      throw new Error("삭제할 기준 월이 필요합니다.");
    }
    if (!imageName || imageName.includes("..")) {
      throw new Error("삭제할 파일명이 올바르지 않습니다.");
    }

    const monthDirectory = resolve(join(outputRoot, monthKey));
    const filePath = resolve(join(monthDirectory, imageName));
    if (!filePath.startsWith(`${monthDirectory}\\`) && filePath !== monthDirectory) {
      throw new Error("월 폴더 밖의 파일은 삭제할 수 없습니다.");
    }
    if (!existsSync(filePath)) {
      throw new Error("삭제할 파일을 찾지 못했습니다.");
    }
    await unlink(filePath);
    sendJson(response, { ok: true, result: { deletedPath: filePath } });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 400);
  }
}

async function handleProofPptBuild(request, response) {
  try {
    const body = await readJsonBody(request, {
      maxBytes: jsonBodyLimitForPath("/api/travel-proof/ppt-build"),
      tooLargeMessage: "PPT로 만들 이미지 데이터가 너무 큽니다. 이미지 수를 줄이거나 사진 용량을 줄여 주세요."
    });
    const monthKey = body.monthKey;
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) {
      throw new Error("PPT를 만들 기준 월이 필요합니다.");
    }
    const images = (body.images || []).map((image) => ({
      type: image.type,
      name: image.name,
      dateKey: image.dateKey,
      dataUri: image.dataUri
    }));
    const buffer = await buildProofPptxBuffer({ monthKey, images });
    sendJson(response, {
      ok: true,
      result: {
        fileName: pptFileBaseName(monthKey),
        pptBase64: Buffer.from(buffer).toString("base64"),
        imageCount: images.length
      }
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function ensureProofMonthFolders(outputRoot, monthKey) {
  await Promise.all([
    mkdir(join(outputRoot, monthKey, proofSubfolder("route")), { recursive: true }),
    mkdir(join(outputRoot, monthKey, proofSubfolder("oil")), { recursive: true }),
    mkdir(join(outputRoot, monthKey, HIPASS_TOLL_FOLDER), { recursive: true }),
    mkdir(join(outputRoot, monthKey, proofSubfolder("extra")), { recursive: true }),
    mkdir(join(outputRoot, monthKey, COUPANG_PROOF_FOLDERS.welfare), { recursive: true }),
    mkdir(join(outputRoot, monthKey, COUPANG_PROOF_FOLDERS.supply), { recursive: true }),
    mkdir(join(outputRoot, monthKey, COUPANG_PROOF_FOLDERS.other), { recursive: true }),
    mkdir(join(outputRoot, monthKey, COUPANG_PROOF_FOLDERS.review), { recursive: true }),
    mkdir(join(outputRoot, monthKey, "엑셀자료"), { recursive: true }),
    mkdir(join(outputRoot, monthKey, proofSubfolder("ppt")), { recursive: true })
  ]);
}

async function storageRootFor(key) {
  const storage = defaultStorage();
  const settings = await readStorageSettings(storage.outputRoot);
  const preferredRoot = settings[key] || storage.outputRoot;
  if (!personalSettings.onboardingComplete) return preferredRoot;
  try {
    await mkdir(preferredRoot, { recursive: true });
    await access(preferredRoot, 2);
    return preferredRoot;
  } catch {
    await mkdir(pendingSyncRoot, { recursive: true });
    return pendingSyncRoot;
  }
}

function effectiveStorageRoots(defaultRoot, settings) {
  return Object.fromEntries(STORAGE_SETTING_KEYS.map((key) => [key, settings[key] || defaultRoot]));
}

async function readStorageSettings(defaultRoot) {
  const filePath = join(personalDataRoot, STORAGE_SETTINGS_FILE);
  try {
    const text = await readFile(filePath, "utf8");
    return normalizeStorageSettings(JSON.parse(text));
  } catch {
    try {
      const legacyText = await readFile(join(defaultRoot, STORAGE_SETTINGS_FILE), "utf8");
      return normalizeStorageSettings(JSON.parse(legacyText));
    } catch {
      return {};
    }
  }
}

async function writeStorageSettings(defaultRoot, settings) {
  const filePath = join(personalDataRoot, STORAGE_SETTINGS_FILE);
  await mkdir(join(personalDataRoot, "settings"), { recursive: true });
  await writeFile(filePath, JSON.stringify(normalizeStorageSettings(settings), null, 2), "utf8");
}

function normalizeStorageSettings(settings) {
  const normalized = {};
  for (const key of STORAGE_SETTING_KEYS) {
    const value = String(settings?.[key] || "").trim();
    if (value) {
      normalized[key] = value;
    }
  }
  return normalized;
}

async function readExpenseLedger() {
  const ledgerRoot = await storageRootFor("ledger");
  const filePath = join(ledgerRoot, EXPENSE_LEDGER_FILE);
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return {
      version: 1,
      updatedAt: parsed.updatedAt || "",
      entries: normalizeExpenseLedgerEntries(parsed.entries)
    };
  } catch {
    return { version: 1, updatedAt: "", entries: [] };
  }
}

function normalizeExpenseLedgerEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const normalizedEntries = [];
  for (const entry of entries) {
    if (shouldSkipInvalidCoupangLedgerEntry(entry)) {
      continue;
    }
    try {
      normalizedEntries.push(normalizeLedgerEntry(entry));
    } catch {
      // Keep the app usable even if an older ledger file contains a bad row.
    }
  }
  return normalizedEntries;
}

function shouldSkipInvalidCoupangLedgerEntry(entry) {
  return entry?.source === "coupang" && !(Number(entry?.amountWon) > 0);
}

async function writeExpenseLedger(ledger) {
  const ledgerRoot = await storageRootFor("ledger");
  await mkdir(ledgerRoot, { recursive: true });
  await writeFile(join(ledgerRoot, EXPENSE_LEDGER_FILE), JSON.stringify({
    version: 1,
    updatedAt: ledger.updatedAt || new Date().toISOString(),
    entries: Array.isArray(ledger.entries) ? ledger.entries : []
  }, null, 2), "utf8");
}

async function readCorporateCardLedger() {
  const ledgerRoot = await storageRootFor("ledger");
  const filePath = join(ledgerRoot, CORPORATE_CARD_LEDGER_FILE);
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return {
      version: 1,
      updatedAt: parsed.updatedAt || "",
      entries: sortCorporateCardEntries(
        Array.isArray(parsed.entries) ? parsed.entries.map((entry) => normalizeCorporateCardEntry(entry)) : []
      )
    };
  } catch {
    return { version: 1, updatedAt: "", entries: [] };
  }
}

async function writeCorporateCardLedger(ledger) {
  const ledgerRoot = await storageRootFor("ledger");
  await mkdir(ledgerRoot, { recursive: true });
  await writeFile(join(ledgerRoot, CORPORATE_CARD_LEDGER_FILE), JSON.stringify({
    version: 1,
    updatedAt: ledger.updatedAt || new Date().toISOString(),
    entries: sortCorporateCardEntries(Array.isArray(ledger.entries) ? ledger.entries : [])
  }, null, 2), "utf8");
}

function sortCorporateCardEntries(entries) {
  return entries.sort((left, right) =>
    String(right.dateKey || "").localeCompare(String(left.dateKey || "")) ||
    String(left.merchantName || "").localeCompare(String(right.merchantName || "")) ||
    Number(right.amountWon || 0) - Number(left.amountWon || 0)
  );
}

async function upsertLedgerEntries(entries) {
  const ledger = await readExpenseLedger();
  const nowIso = new Date().toISOString();
  const byId = new Map((ledger.entries || []).map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    if (shouldSkipInvalidCoupangLedgerEntry(entry)) {
      continue;
    }
    const normalized = normalizeLedgerEntry(entry, nowIso);
    const previous = byId.get(normalized.id);
    if (previous?.savedPath && normalized.source === "coupang" && normalized.status === "confirmed" && normalized.type !== previous.type) {
      normalized.savedPath = await moveLedgerProofFile(previous.savedPath, normalized);
    }
    byId.set(normalized.id, {
      ...previous,
      ...normalized,
      createdAt: previous?.createdAt || normalized.createdAt,
      updatedAt: nowIso
    });
  }
  const nextLedger = {
    version: 1,
    updatedAt: nowIso,
    entries: [...byId.values()].sort((left, right) =>
      String(left.dateKey || "").localeCompare(String(right.dateKey || "")) ||
      String(left.id || "").localeCompare(String(right.id || ""))
    )
  };
  await writeExpenseLedger(nextLedger);
  return nextLedger;
}

async function moveLedgerProofFile(currentPath, entry) {
  const sourcePath = String(currentPath || "").trim();
  if (!sourcePath || !existsSync(sourcePath)) {
    return sourcePath;
  }

  const folderName = COUPANG_PROOF_FOLDERS[entry.type];
  if (!folderName) {
    return sourcePath;
  }

  const monthKey = String(entry.dateKey || "").slice(0, 7);
  const targetRoot = await storageRootFor(entry.type);
  const targetDirectory = join(targetRoot, monthKey, folderName);
  await mkdir(targetDirectory, { recursive: true });
  const targetName = nextAvailableFileName(targetDirectory, basename(sourcePath));
  const targetPath = join(targetDirectory, targetName);
  await copyFile(sourcePath, targetPath);
  await unlink(sourcePath).catch(() => {});
  return targetPath;
}

async function deleteLedgerProofFile(savedPath) {
  const filePath = String(savedPath || "").trim();
  if (!filePath || !existsSync(filePath)) {
    return;
  }
  await unlink(filePath).catch(() => {});
}

function receiptToLedgerEntry(receipt) {
  const category = ["welfare", "supply"].includes(receipt.category) ? receipt.category : "review";
  return {
    id: coupangLedgerEntryId(receipt),
    dateKey: receipt.dateKey || receipt.requestedDateKey || "",
    type: category,
    source: "coupang",
    amountWon: receipt.amountWon || 0,
    items: receipt.items || [],
    memo: receipt.reasons?.length ? `분류 근거: ${receipt.reasons.join(", ")}` : "",
    status: category === "review" ? "review" : "confirmed",
    savedPath: receipt.savedPath || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function coupangLedgerEntryId(receipt) {
  return `coupang:${receipt.orderId || receipt.requestedDateKey || receipt.dateKey}:${receipt.amountWon || 0}:${receipt.dateKey || ""}`;
}

function coupangReceiptDuplicateKey(receipt) {
  return [
    receipt.orderId || "",
    receipt.dateKey || receipt.requestedDateKey || "",
    Number(receipt.amountWon) || 0,
    Array.isArray(receipt.items) ? receipt.items.join("|") : ""
  ].join("::");
}

function normalizeLedgerEntry(entry, nowIso = new Date().toISOString()) {
  const source = ["manual", "coupang", "corporateCard"].includes(entry?.source) ? entry.source : "coupang";
  const type = ["welfare", "supply", "other", "review"].includes(entry?.type) ? entry.type : "review";
  const status = entry?.status === "confirmed" ? "confirmed" : "review";
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(entry?.dateKey || "")) ? String(entry.dateKey) : "";
  if (!dateKey) {
    throw new Error("장부 항목 날짜가 필요합니다.");
  }
  const amountWon = Math.max(0, Number(entry?.amountWon) || 0);
  if (!amountWon) {
    throw new Error("장부 항목 금액이 필요합니다.");
  }
  return {
    id: String(entry?.id || `${source}:${dateKey}:${Date.now()}:${Math.random().toString(16).slice(2)}`),
    dateKey,
    type,
    source,
    amountWon,
    items: Array.isArray(entry?.items)
      ? entry.items.map((item) => String(item).trim()).filter(Boolean)
      : String(entry?.items || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
    memo: String(entry?.memo || "").trim(),
    status,
    savedPath: String(entry?.savedPath || "").trim(),
    createdAt: entry?.createdAt || nowIso,
    updatedAt: entry?.updatedAt || nowIso
  };
}

async function readProofImagesFromMonthDirectory(monthDirectory, monthKey) {
  const { images } = await readProofImageCandidatesFromMonthDirectory(monthDirectory, monthKey);
  return images;
}

async function readProofImageCandidatesFromMonthDirectory(monthDirectory, monthKey) {
  const folders = [
    ["route", proofSubfolder("route")],
    ["oil", proofSubfolder("oil")],
    ["toll", HIPASS_TOLL_FOLDER],
    ...EXTRA_PROOF_FOLDER_ALIASES.map((folderName) => ["extra", folderName]),
    ["welfare", COUPANG_PROOF_FOLDERS.welfare],
    ["supply", COUPANG_PROOF_FOLDERS.supply],
    ["other", COUPANG_PROOF_FOLDERS.other],
    ["review", COUPANG_PROOF_FOLDERS.review]
  ];
  const images = [];
  const unmatchedImages = [];

  const seenFolders = new Set();
  for (const [type, folder] of folders) {
    if (seenFolders.has(folder)) {
      continue;
    }
    seenFolders.add(folder);
    const directory = join(monthDirectory, folder);
    if (!existsSync(directory)) {
      continue;
    }
    const result = await readProofImagesFromDirectory(directory, type, folder, monthKey);
    images.push(...result.images);
    unmatchedImages.push(...result.unmatchedImages);
  }

  if (existsSync(monthDirectory)) {
    const rootFiles = await readdir(monthDirectory, { withFileTypes: true });
    for (const file of rootFiles) {
      if (!file.isFile() || !isProofImageFile(file.name)) {
        continue;
      }
      const dateKey = parseProofDateFromFileName(file.name, monthKey);
      if (!dateKey || !dateKey.startsWith(`${monthKey}-`)) {
        unmatchedImages.push({
          type: proofTypeFromFileName(file.name, "route"),
          name: file.name,
          reason: "file-name-date-not-found"
        });
        continue;
      }
      images.push({
        type: proofTypeFromFileName(file.name, "route"),
        name: file.name,
        dateKey,
        path: join(monthDirectory, file.name)
      });
    }
  }

  const externalImages = await readExternalReceiptImages(dirname(monthDirectory), monthKey);
  images.push(...externalImages);

  return { images, unmatchedImages };
}

async function readExternalReceiptImages(outputRoot, monthKey) {
  const images = [];
  const seenDirectories = new Set();
  for (const directory of await externalReceiptMonthDirectories(outputRoot, monthKey)) {
    const normalizedDirectory = normalize(directory).toLowerCase();
    if (seenDirectories.has(normalizedDirectory) || !existsSync(directory)) {
      continue;
    }
    seenDirectories.add(normalizedDirectory);
    images.push(...await readExternalReceiptImagesFromDirectory(
      directory,
      `${EXTERNAL_RECEIPT_OWNER_FOLDER}/${basename(directory)}`,
      monthKey
    ));
  }
  return images;
}

async function externalReceiptMonthDirectories(outputRoot, monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return [];
  }
  const [, year, paddedMonth] = match;
  const month = String(Number(paddedMonth));
  const aliases = [
    monthKey,
    `${month}월`,
    `${paddedMonth}월`,
    `${year}년 ${month}월`,
    `${year}년 ${paddedMonth}월`
  ];
  const ownerDirectory = join(outputRoot, EXTERNAL_RECEIPT_OWNER_FOLDER);
  const directories = aliases.map((folderName) => join(ownerDirectory, folderName));
  if (!existsSync(ownerDirectory)) {
    return directories;
  }

  const entries = await readdir(ownerDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (
      entry.name.includes(monthKey) ||
      entry.name.includes(`${month}월`) ||
      entry.name.includes(`${paddedMonth}월`)
    ) {
      directories.push(join(ownerDirectory, entry.name));
    }
  }
  return directories;
}

async function readExternalReceiptImagesFromDirectory(directory, relativePrefix, monthKey) {
  const images = [];
  const files = await readdir(directory, { withFileTypes: true });
  for (const file of files) {
    const relativeName = `${relativePrefix}/${file.name}`;
    const filePath = join(directory, file.name);
    if (file.isDirectory()) {
      images.push(...await readExternalReceiptImagesFromDirectory(filePath, relativeName, monthKey));
      continue;
    }
    if (!file.isFile() || !isProofImageFile(file.name)) {
      continue;
    }
    images.push({
      type: "review",
      name: relativeName,
      dateKey: `${monthKey}-${EXTERNAL_RECEIPT_REVIEW_SUFFIX}`,
      path: filePath
    });
  }
  return images;
}

async function readProofImagesFromDirectory(directory, type, relativePrefix, monthKey) {
  const images = [];
  const unmatchedImages = [];
  const files = await readdir(directory, { withFileTypes: true });
  for (const file of files) {
    const relativeName = `${relativePrefix}/${file.name}`;
    const filePath = join(directory, file.name);
    if (file.isDirectory()) {
      const result = await readProofImagesFromDirectory(filePath, type, relativeName, monthKey);
      images.push(...result.images);
      unmatchedImages.push(...result.unmatchedImages);
      continue;
    }
    if (!file.isFile() || !isProofImageFile(file.name)) {
      continue;
    }
    const dateKey = parseProofDateFromFileName(relativeName, monthKey);
    if (!dateKey || !dateKey.startsWith(`${monthKey}-`)) {
      unmatchedImages.push({
        type,
        name: relativeName,
        reason: "file-name-date-not-found"
      });
      continue;
    }
    images.push({
      type,
      name: relativeName,
      dateKey,
      path: filePath
    });
  }
  return { images, unmatchedImages };
}

function isProofImageFile(fileName) {
  return /\.(png|jpe?g|webp)$/i.test(fileName);
}

async function groupsWithPreviewData(groups) {
  const withData = [];
  for (const group of groups) {
    withData.push({
      dateKey: group.dateKey,
      route: await imagesWithPreviewData(group.route),
      oil: await imagesWithPreviewData(group.oil),
      toll: await imagesWithPreviewData(group.toll),
      extra: await imagesWithPreviewData(group.extra),
      welfare: await imagesWithPreviewData(group.welfare),
      supply: await imagesWithPreviewData(group.supply),
      other: await imagesWithPreviewData(group.other),
      review: await imagesWithPreviewData(group.review)
    });
  }
  return withData;
}

async function imagesWithPreviewData(images) {
  return Promise.all((images || []).map(async (image) => ({
    type: image.type,
    name: image.name,
    dateKey: image.dateKey,
    dataUri: await imageDataUri(image.path)
  })));
}

async function imageDataUri(filePath) {
  const extension = extname(filePath).toLowerCase();
  const mimeType = extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : extension === ".webp"
      ? "image/webp"
      : "image/png";
  const buffer = await readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function nextAvailableFileName(directory, preferredName) {
  const extension = extname(preferredName);
  const baseName = extension ? preferredName.slice(0, -extension.length) : preferredName;
  let fileName = preferredName;
  let attempt = 1;
  while (existsSync(join(directory, fileName))) {
    attempt += 1;
    fileName = `${baseName}_${String(attempt).padStart(2, "0")}${extension}`;
  }
  return fileName;
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, options = {}) {
  return new Promise((resolveBody, rejectBody) => {
    const maxBytes = options.maxBytes || DEFAULT_JSON_BODY_LIMIT;
    const tooLargeMessage = options.tooLargeMessage || "요청 데이터가 너무 큽니다.";
    let raw = "";
    let rejected = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (rejected) {
        return;
      }
      raw += chunk;
      if (raw.length > maxBytes) {
        rejected = true;
        rejectBody(new Error(tooLargeMessage));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (rejected) {
        return;
      }
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        rejectBody(new Error("요청 형식이 올바르지 않습니다."));
      }
    });
    request.on("error", rejectBody);
  });
}

export function startServer({ port: requestedPort = port, host: requestedHost = host } = {}) {
  if (server.listening) {
    const address = server.address();
    return Promise.resolve({ server, host: requestedHost, port: address?.port || requestedPort });
  }
  return new Promise((resolveServer, rejectServer) => {
    const handleError = (error) => rejectServer(error);
    server.once("error", handleError);
    server.listen(requestedPort, requestedHost, () => {
      server.off("error", handleError);
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : requestedPort;
      console.log(`Business trip proof running at http://${requestedHost}:${activePort}`);
      resolveServer({ server, host: requestedHost, port: activePort });
    });
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  await startServer();
}
