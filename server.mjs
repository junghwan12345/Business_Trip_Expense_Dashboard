import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, normalize, resolve } from "node:path";
import { normalizeQuoteFailure, normalizeYahooQuote } from "./src/dashboard/market-data.js";
import { COUPANG_PROOF_FOLDERS, receiptFileBaseName } from "./src/travel-proof/coupang-proof.js";
import { normalizeCorporateCardEntry } from "./src/travel-proof/corporate-card.js";
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
  buildMonthlyProofGroups,
  parseTravelProofTable
} from "./src/travel-proof/travel-proof.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const STORAGE_SETTING_KEYS = [
  "route",
  "oil",
  "extra",
  "coupang",
  "welfare",
  "supply",
  "review",
  "ppt",
  "ledger"
];
const STORAGE_SETTINGS_FILE = join("settings", "storage-settings.json");
const EXPENSE_LEDGER_FILE = "expense-ledger.json";
const CORPORATE_CARD_LEDGER_FILE = "corporate-card-ledger.json";

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

async function loadAutomationModule() {
  return import(`./src/travel-proof/naver-map-automation.js?updated=${Date.now()}`);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);

  if (url.pathname === "/api/quotes") {
    await handleQuotes(url, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/preview" && request.method === "POST") {
    await handleTravelProofPreview(request, response);
    return;
  }

  if (url.pathname === "/api/travel-proof/storage-info" && request.method === "GET") {
    await handleStorageInfo(response);
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

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
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

async function handleQuotes(url, response) {
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  const entries = await Promise.all(symbols.map(async (symbol) => [symbol, await fetchYahooQuote(symbol)]));
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(Object.fromEntries(entries)));
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
    const result = await captureNaverRoute(body.job);
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleTravelProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureNaverRoute } = await loadAutomationModule();
    const result = await captureNaverRoute(body.job);
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
    const result = await captureOilPriceProof(body.dateKey);
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleOilProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const { captureOilPriceProof } = await loadAutomationModule();
    const result = await captureOilPriceProof(body.dateKey);
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

    for (const receipt of result.results || []) {
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

    const ledger = await upsertLedgerEntries(savedResults.map(receiptToLedgerEntry));

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
    mkdir(join(outputRoot, monthKey, proofSubfolder("extra")), { recursive: true }),
    mkdir(join(outputRoot, monthKey, proofSubfolder("ppt")), { recursive: true })
  ]);
}

async function storageRootFor(key) {
  const storage = defaultStorage();
  const settings = await readStorageSettings(storage.outputRoot);
  return settings[key] || storage.outputRoot;
}

function effectiveStorageRoots(defaultRoot, settings) {
  return Object.fromEntries(STORAGE_SETTING_KEYS.map((key) => [key, settings[key] || defaultRoot]));
}

async function readStorageSettings(defaultRoot) {
  const filePath = join(defaultRoot, STORAGE_SETTINGS_FILE);
  try {
    const text = await readFile(filePath, "utf8");
    return normalizeStorageSettings(JSON.parse(text));
  } catch {
    return {};
  }
}

async function writeStorageSettings(defaultRoot, settings) {
  const filePath = join(defaultRoot, STORAGE_SETTINGS_FILE);
  await mkdir(join(defaultRoot, "settings"), { recursive: true });
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
      entries: Array.isArray(parsed.entries) ? parsed.entries.map((entry) => normalizeLedgerEntry(entry)) : []
    };
  } catch {
    return { version: 1, updatedAt: "", entries: [] };
  }
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
  const ledgerRoot = defaultStorage().outputRoot;
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
  const ledgerRoot = defaultStorage().outputRoot;
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
    id: `coupang:${receipt.requestedDateKey || receipt.dateKey}:${receipt.amountWon || 0}:${receipt.savedFileName || receipt.fileName || ""}`,
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

function normalizeLedgerEntry(entry, nowIso = new Date().toISOString()) {
  const source = entry?.source === "manual" ? "manual" : "coupang";
  const type = ["welfare", "supply", "review"].includes(entry?.type) ? entry.type : "review";
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
    ...EXTRA_PROOF_FOLDER_ALIASES.map((folderName) => ["extra", folderName]),
    ["welfare", COUPANG_PROOF_FOLDERS.welfare],
    ["supply", COUPANG_PROOF_FOLDERS.supply],
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

  return { images, unmatchedImages };
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
      extra: await imagesWithPreviewData(group.extra),
      welfare: await imagesWithPreviewData(group.welfare),
      supply: await imagesWithPreviewData(group.supply),
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

async function fetchYahooQuote(symbol) {
  try {
    const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
    const result = await fetch(endpoint, {
      headers: {
        "User-Agent": "Mozilla/5.0 personal-dashboard"
      }
    });
    if (!result.ok) {
      throw new Error(`HTTP ${result.status}`);
    }
    const data = await result.json();
    return normalizeYahooQuote(symbol, data);
  } catch (error) {
    return normalizeQuoteFailure(symbol, error);
  }
}

server.listen(port, () => {

  console.log(`Personal dashboard running at http://localhost:${port}`);
});
