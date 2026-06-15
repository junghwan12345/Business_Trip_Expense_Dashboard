import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { normalizeQuoteFailure, normalizeYahooQuote } from "./src/dashboard/market-data.js";
import { COUPANG_PROOF_FOLDERS, receiptFileBaseName } from "./src/travel-proof/coupang-proof.js";
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
import { captureCoupangReceipts, captureNaverRoute, captureOilPriceProof } from "./src/travel-proof/naver-map-automation.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);

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
  sendJson(response, {
    ok: true,
    storage
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
    const result = await captureNaverRoute(body.job);
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleTravelProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const result = await captureNaverRoute(body.job);
    const outputRoot = body.outputRoot || defaultStorage().outputRoot;
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
    const result = await captureOilPriceProof(body.dateKey);
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleOilProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const result = await captureOilPriceProof(body.dateKey);
    const outputRoot = body.outputRoot || defaultStorage().outputRoot;
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
    const result = await captureCoupangReceipts({ dateKeys: body.dateKeys || [] });
    sendJson(response, { ok: true, result });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleCoupangProofCaptureSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const outputRoot = body.outputRoot || defaultStorage().outputRoot;
    const result = await captureCoupangReceipts({ dateKeys: body.dateKeys || [] });
    const savedResults = [];

    for (const receipt of result.results || []) {
      const monthKey = receipt.dateKey.slice(0, 7);
      const folderName = COUPANG_PROOF_FOLDERS[receipt.category] || COUPANG_PROOF_FOLDERS.review;
      const outputDirectory = join(outputRoot, monthKey, folderName);
      await mkdir(outputDirectory, { recursive: true });
      const baseName = receiptFileBaseName({
        dateKey: receipt.dateKey,
        amountWon: receipt.amountWon,
        site: "쿠팡"
      });
      const fileName = nextAvailableFileName(outputDirectory, `${baseName}.png`);
      const filePath = join(outputDirectory, fileName);
      await writeFile(filePath, Buffer.from(receipt.imageBase64, "base64"));
      savedResults.push({
        ...receipt,
        savedPath: filePath,
        savedFileName: fileName
      });
    }

    sendJson(response, {
      ok: true,
      result: {
        ...result,
        results: savedResults,
        outputRoot
      }
    });
  } catch (error) {
    sendJson(response, { ok: false, message: error.message }, 500);
  }
}

async function handleProofPptCreate(request, response) {
  try {
    const body = await readJsonBody(request);
    const outputRoot = body.outputRoot || defaultStorage().outputRoot;
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
    const outputRoot = body.outputRoot || defaultStorage().outputRoot;
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

async function readProofImagesFromMonthDirectory(monthDirectory, monthKey) {
  const { images } = await readProofImageCandidatesFromMonthDirectory(monthDirectory, monthKey);
  return images;
}

async function readProofImageCandidatesFromMonthDirectory(monthDirectory, monthKey) {
  const folders = [
    ["route", proofSubfolder("route")],
    ["oil", proofSubfolder("oil")],
    ...EXTRA_PROOF_FOLDER_ALIASES.map((folderName) => ["extra", folderName]),
    ["extra", COUPANG_PROOF_FOLDERS.welfare],
    ["extra", COUPANG_PROOF_FOLDERS.supply],
    ["extra", COUPANG_PROOF_FOLDERS.review]
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
      extra: await imagesWithPreviewData(group.extra)
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
