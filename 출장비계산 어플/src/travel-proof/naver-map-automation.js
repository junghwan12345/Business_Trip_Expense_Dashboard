import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  classifyCoupangReceipt,
  coupangOrderDateCandidates,
  extractCoupangOrdersFromData,
  parseCoupangReceiptText,
  receiptFileBaseName
} from "./coupang-proof.js";
import { extractRouteDistanceKm, parseFuelPriceWon } from "./travel-proof.js";
import { parseHipassReceiptText } from "./hipass-toll.js";
import {
  compareOilTargetToPage,
  estimateOilTargetPage,
  normalizeOilDateText
} from "./oil-price-search.js";

const DEBUG_PORT = 9222;
const COUPANG_ORDER_LIST_URL = "https://mc.coupang.com/ssr/desktop/order/list";
const HIPASS_LOGIN_URL = "https://www.hipass.co.kr/main.do";
const HIPASS_USAGE_URL = "https://www.hipass.co.kr/usepculr/InitUsePculrTabSearch.do";
const HIPASS_LOGIN_WAIT_MS = 5 * 60 * 1000;
const COUPANG_LOGIN_WAIT_MS = 5 * 60 * 1000;
const COUPANG_ORDER_SEARCH_PAGES = 12;
const COUPANG_ORDER_SEARCH_SCROLLS = 14;
const DEFAULT_FAST_CAPTURE_ENABLED = process.env.TRAVEL_PROOF_FAST_CAPTURE !== "0";
const OIL_QUOTE_URL = "https://finance.naver.com/marketindex/oilDailyQuote.naver?marketindexCd=OIL_GSL";
const sharedAutomationStateKey = Symbol.for("travel-proof.fast-capture-state");
const sharedAutomationState = globalThis[sharedAutomationStateKey] ||= {
  reusableTabIds: new Map(),
  oilCaptureCache: new Map()
};
const { reusableTabIds, oilCaptureCache } = sharedAutomationState;
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

export async function captureNaverRoute(job, options = {}) {
  const fastCapture = isFastCaptureEnabled(options);
  const endpoint = await ensureChrome(options);
  const tab = await acquireAutomationTab(endpoint, "route", fastCapture);
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, tab.id);

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.setViewport", {}).catch(() => {});
    await navigate(client, "https://map.naver.com/p/directions/-/-/-/car?c=15.00,0,0,0,dh");
    await waitFor(client, "location.href.includes('/directions/')", 20000);

    await prepareDirections(client);
    await selectEndpoint(client, 0, job.route.start, "start");

    for (let index = 0; index < job.route.waypoints.length; index += 1) {
      await addWaypointInput(client, index);
    }

    for (let index = 0; index < job.route.waypoints.length; index += 1) {
      const waypoint = job.route.waypoints[index];
      const slot = index === 0 ? "via1" : "via2";
      const selected = await selectWaypoint(client, index + 1, waypoint, slot);
      if (!selected.ok) {
        throw new Error(`${waypoint.timeOfDay} ${waypoint.posName} search failed: ${selected.message}`);
      }
    }

    await selectEndpoint(client, job.route.waypoints.length + 1, job.route.destination, "goal");
    await clickControl(client, { text: "길찾기", classPart: "search", label: "search route button" });
    await waitFor(client, "document.body.innerText.includes('실시간 추천')", 30000);
    await delay(1200);

    const routeSummaryText = await getPrimaryRouteSummaryText(client);
    const clip = await getProofPanelClip(client);
    const screenshot = await client.call("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      clip
    });

    return {
      dateKey: job.dateKey,
      fileName: job.outputFileName,
      imageBase64: screenshot.result.data,
      distanceKm: extractRouteDistanceKm(routeSummaryText),
      summaryText: routeSummaryText.slice(0, 2000)
    };
  } finally {
    await client.close();
    await releaseAutomationTab(tab, "route", fastCapture);
  }
}

export async function captureOilPriceProof(dateKey, options = {}) {
  const fastCapture = isFastCaptureEnabled(options);
  const cacheKey = normalizeOilDateText(dateKey);
  if (fastCapture && cacheKey && oilCaptureCache.has(cacheKey)) {
    return oilCaptureCache.get(cacheKey);
  }

  const capturePromise = captureOilPriceProofFresh(dateKey, options);
  if (fastCapture && cacheKey) oilCaptureCache.set(cacheKey, capturePromise);
  try {
    return await capturePromise;
  } catch (error) {
    if (cacheKey && oilCaptureCache.get(cacheKey) === capturePromise) oilCaptureCache.delete(cacheKey);
    throw error;
  }
}

async function captureOilPriceProofFresh(dateKey, options = {}) {
  const fastCapture = isFastCaptureEnabled(options);
  const endpoint = await ensureChrome(options);
  const tab = await acquireAutomationTab(endpoint, "oil", fastCapture);
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, tab.id);
  const targetDate = normalizeOilDateText(dateKey);

  if (!targetDate) {
    throw new Error(`유류대 날짜 형식이 올바르지 않습니다: ${dateKey}`);
  }

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");

    if (fastCapture) {
      const prefetched = await findOilPricePageFromHtml(targetDate).catch(() => null);
      if (prefetched) {
        const pageData = await loadOilPricePage(client, prefetched.page, targetDate);
        if (pageData.highlighted) {
          return await captureHighlightedOilPrice(client, dateKey, prefetched.page, pageData.highlighted, true);
        }
      }
    }

    const firstPage = await loadOilPricePage(client, 1, targetDate);
    let page = estimateOilTargetPage(targetDate, firstPage.dateTexts, 80);
    const visitedPages = new Set();

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const pageData = page === 1 ? firstPage : await loadOilPricePage(client, page, targetDate);
      const highlighted = pageData.highlighted;
      if (!highlighted) {
        const direction = compareOilTargetToPage(targetDate, pageData.dateTexts);
        if (direction === "missing") {
          throw new Error(`해당 날짜는 유가 고시 목록에 없습니다: ${dateKey}`);
        }
        if (direction === "previous") {
          page = Math.max(1, page - 1);
        } else if (direction === "next") {
          page = Math.min(80, page + 1);
        } else {
          throw new Error(`유가 페이지의 날짜를 확인할 수 없습니다: ${dateKey}`);
        }

        if (visitedPages.has(page)) break;
        visitedPages.add(page);
        continue;
      }

      return await captureHighlightedOilPrice(client, dateKey, page, highlighted, false);
    }

    throw new Error(`해당 날짜의 휘발유 유가를 찾을 수 없습니다: ${dateKey}`);
  } finally {
    await client.close();
    await releaseAutomationTab(tab, "oil", fastCapture);
  }
}

async function captureHighlightedOilPrice(client, dateKey, page, highlighted, prefetched) {
  await delay(150);
  const clip = await getOilProofClip(client);
  const screenshot = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    clip
  });
  return {
    dateKey,
    fileName: `oil-${dateKey}.png`,
    imageBase64: screenshot.result.data,
    fuelPriceText: highlighted.priceText,
    fuelPriceWon: parseFuelPriceWon(highlighted.priceText),
    page,
    prefetched
  };
}

async function loadOilPricePage(client, page, targetDate) {
  await navigate(client, `${OIL_QUOTE_URL}&page=${page}`);
  await waitFor(client, "document.querySelector('.tbl_exchange.today tbody tr')", 15000);
  const dateTexts = await readOilPricePageDates(client, targetDate.slice(0, 4));
  const highlighted = await highlightOilPriceRow(client, targetDate);
  return { dateTexts, highlighted };
}

async function findOilPricePageFromHtml(targetDate) {
  const firstPage = await fetchOilPricePageHtml(1);
  let page = estimateOilTargetPage(targetDate, firstPage.map((row) => row.dateKey), 80);
  const visited = new Set();

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = page === 1 ? firstPage : await fetchOilPricePageHtml(page);
    const match = rows.find((row) => row.dateKey === targetDate);
    if (match) return { page, ...match };

    const direction = compareOilTargetToPage(targetDate, rows.map((row) => row.dateKey));
    if (direction === "previous") page = Math.max(1, page - 1);
    else if (direction === "next") page = Math.min(80, page + 1);
    else return null;

    if (visited.has(page)) return null;
    visited.add(page);
  }
  return null;
}

async function fetchOilPricePageHtml(page) {
  const response = await fetch(`${OIL_QUOTE_URL}&page=${page}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`유가 목록 조회 실패 (${response.status})`);

  const bytes = await response.arrayBuffer();
  const charset = /euc-?kr/i.test(response.headers.get("content-type") || "") ? "euc-kr" : "utf-8";
  const html = new TextDecoder(charset).decode(bytes);
  const rows = parseOilPriceRowsFromHtml(html);
  if (!rows.length) throw new Error("유가 목록 HTML에서 날짜를 읽을 수 없습니다.");
  return rows;
}

function parseOilPriceRowsFromHtml(html) {
  const rows = [];
  for (const rowMatch of String(html || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => String(match[1] || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&#44;/g, ",")
        .replace(/\s+/g, " ")
        .trim());
    const dateIndex = cells.findIndex((cell) => /20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}/.test(cell));
    if (dateIndex < 0) continue;

    const dateKey = normalizeOilDateText(cells[dateIndex]);
    const priceText = cells.slice(dateIndex + 1)
      .find((cell) => /^\d[\d,]*(?:\.\d+)?$/.test(cell.replace(/\s+/g, ""))) || "";
    if (dateKey) rows.push({ dateKey, dateText: cells[dateIndex], priceText: priceText.replace(/\s+/g, "") });
  }
  return rows;
}

export async function captureCoupangReceipts({ dateKeys = [] } = {}, options = {}) {
  const endpoint = await ensureChrome(options);
  const tab = await createTab(endpoint);
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, tab.id);
  const results = [];
  const failures = [];

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Network.enable").catch(() => {});
    await navigate(client, COUPANG_ORDER_LIST_URL);
    await waitForCoupangOrderList(client);
    const orderIndex = await buildCoupangOrderIndex(client, dateKeys);

    for (const dateKey of dateKeys) {
      const capturedForDate = await captureCoupangDateReceipts(client, dateKey, orderIndex).catch((error) => {
        failures.push({ dateKey, message: error.message });
        return [];
      });
      results.push(...capturedForDate);
      if (!options.keepOpen) {
        await navigate(client, COUPANG_ORDER_LIST_URL);
        await waitForCoupangOrderList(client);
      }
    }

    return { results, failures };
  } finally {
    await client.close();
    if (!options.keepOpen) {
      await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.id}`).catch(() => {});
    }
  }
}

export async function captureHipassTollReceipt(dateKey, options = {}) {
  const fastCapture = isFastCaptureEnabled(options);
  const endpoint = await ensureChrome(options);
  const tab = await acquireAutomationTab(endpoint, "hipass", fastCapture);
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, tab.id);

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await navigate(client, HIPASS_LOGIN_URL);
    await waitForHipassLogin(client);
    await openHipassUsagePage(client);
    const popupTarget = await queryHipassUsageDate(client, dateKey);
    const receiptClient = popupTarget
      ? await CdpClient.connect(popupTarget.webSocketDebuggerUrl, popupTarget.id)
      : client;
    await delay(1000);

    try {
      if (popupTarget) {
        await receiptClient.call("Page.enable");
        await receiptClient.call("Runtime.enable");
      }
      const textResult = await evaluate(receiptClient, "document.body.innerText", true);
      const bodyText = String(textResult.result.result.value || "");
      if (isHipassNoResultText(bodyText)) {
        return {
          dateKey,
          fileName: `toll-${dateKey}.png`,
          amountWon: 0,
          count: 0,
          noToll: true,
          summaryText: bodyText.slice(0, 2000)
        };
      }

      const receiptData = parseHipassReceiptText(bodyText, dateKey, { excludeFromHour: 21 });
      if (!receiptData.amountWon) {
        return {
          dateKey,
          fileName: `toll-${dateKey}.png`,
          amountWon: 0,
          count: 0,
          excludedCount: receiptData.excludedCount || 0,
          noToll: true,
          summaryText: bodyText.slice(0, 2000)
        };
      }

      await filterHipassReceiptPage(receiptClient, dateKey, { excludeFromHour: 21 });
      const clip = await getHipassReceiptClip(receiptClient);
      const screenshot = await receiptClient.call("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        clip
      });

      return {
        dateKey,
        fileName: `toll-${dateKey}.png`,
        imageBase64: screenshot.result.data,
        amountWon: receiptData.amountWon,
        count: receiptData.count,
        excludedCount: receiptData.excludedCount || 0,
        entries: receiptData.entries,
        noToll: false,
        summaryText: bodyText.slice(0, 2000)
      };
    } finally {
      if (popupTarget) {
        await receiptClient.close();
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${popupTarget.id}`).catch(() => {});
      }
    }
  } finally {
    await client.close();
    await releaseAutomationTab(tab, "hipass", fastCapture);
  }
}

async function captureCoupangDateReceipts(client, dateKey, orderIndex = new Map()) {
  const candidates = coupangOrderDateCandidates(dateKey);
  const indexedOrderIds = orderIndex.get(dateKey) || [];
  const orderIds = indexedOrderIds.length ? indexedOrderIds : await findCoupangOrderIdsForDateWithPages(client, dateKey);
  const orderCount = orderIds.length || await countCoupangOrdersForDateWithScroll(client, candidates);
  if (!orderCount) {
    throw new Error(`${dateKey} 주문목록 데이터에서 주문을 찾지 못했고, 화면 탐색에서도 주문을 찾지 못했습니다.`);
  }

  const captures = [];
  const capturedReceiptKeys = new Set();
  for (let index = 0; index < orderCount; index += 1) {
    const opened = orderIds[index]
      ? await openCoupangOrderDetailById(client, orderIds[index])
      : await clickCoupangOrderDetailForDate(client, candidates, index);
    if (!opened) {
      throw new Error(`${dateKey} 주문상세를 열지 못했습니다. 주문번호 직접 이동 또는 화면 상세보기 버튼 탐색에 실패했습니다.`);
    }

    const targetsBeforeReceipt = await listChromeTargets();
    const targetIdsBeforeReceipt = new Set(targetsBeforeReceipt.map((target) => target.id));
    const receiptButton = await waitUntil(async () => clickCoupangReceiptButton(client), 15000);
    if (!receiptButton) {
      throw new Error("거래명세서 버튼을 찾지 못했습니다.");
    }
    const popupTarget = await waitForCoupangReceiptPopupTarget(client.targetId, targetIdsBeforeReceipt);
    const receiptClient = popupTarget
      ? await CdpClient.connect(popupTarget.webSocketDebuggerUrl, popupTarget.id)
      : client;

    try {
      await receiptClient.call("Page.enable");
      await receiptClient.call("Runtime.enable");
      await waitFor(
        receiptClient,
        `
          (() => {
            const text = (document.body.innerText || '').replace(/\\s+/g, ' ');
            const compact = text.replace(/\\s+/g, '');
            const hasReceiptTitle = ['거래명세서', '거래명세표'].some((label) => compact.includes(label));
            const hasReceiptTotals = /실제\\s*총?\\s*결제\\s*금액|최종\\s*결제\\s*금액|총\\s*거래\\s*합계|거래\\s*금액\\s*합계|합계\\s*금액/.test(text);
            const isOrderDetailOnly = text.includes('주문상세') && !hasReceiptTotals;
            return hasReceiptTitle && hasReceiptTotals && !isOrderDetailOnly;
          })()
        `,
        45000,
        "쿠팡 거래명세서"
      );
      await delay(800);
      const textResult = await evaluate(receiptClient, "document.body.innerText", true);
      const receipt = parseCoupangReceiptText(textResult.result.result.value);
      if (!receipt.amountWon) {
        throw new Error("거래명세서 금액을 읽지 못했습니다. 주문상세 화면이 아닌 거래명세서 본문이 열렸는지 확인이 필요합니다.");
      }
      const receiptKey = coupangReceiptCaptureKey({
        orderId: orderIds[index] || "",
        dateKey: receipt.dateKey || dateKey,
        amountWon: receipt.amountWon,
        items: receipt.items,
        rawText: receipt.rawText
      });
      if (capturedReceiptKeys.has(receiptKey)) {
        continue;
      }
      capturedReceiptKeys.add(receiptKey);
      const classification = classifyCoupangReceipt(receipt.items);
      const clip = await getCoupangReceiptClip(receiptClient);
      const screenshot = await receiptClient.call("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        clip
      });
      captures.push({
        dateKey: receipt.dateKey || dateKey,
        requestedDateKey: dateKey,
        orderId: orderIds[index] || "",
        amountWon: receipt.amountWon,
        items: receipt.items,
        category: classification.category,
        categoryLabel: classification.label,
        reasons: classification.reasons,
        fileName: `${receiptFileBaseName({ dateKey: receipt.dateKey || dateKey, amountWon: receipt.amountWon })}.png`,
        imageBase64: screenshot.result.data,
        summaryText: receipt.rawText.slice(0, 2000)
      });
    } finally {
      if (popupTarget) {
        await receiptClient.close();
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${popupTarget.id}`).catch(() => {});
      }
    }

    await navigate(client, COUPANG_ORDER_LIST_URL);
    await waitForCoupangOrderList(client);
  }
  return captures;
}

function coupangReceiptCaptureKey(receipt) {
  const itemText = Array.isArray(receipt.items) ? receipt.items.join("|") : "";
  const orderPart = String(receipt.orderId || "").trim();
  const contentPart = orderPart || `${itemText}|${String(receipt.rawText || "").replace(/\s+/g, " ").slice(0, 300)}`;
  return [
    contentPart,
    receipt.dateKey || "",
    Number(receipt.amountWon) || 0
  ].join("::");
}

async function waitForHipassLogin(client) {
  await waitFor(client, "document.body && document.body.innerText", 15000, "하이패스 메인 화면");
  const initialState = await readHipassLoginState(client);
  if (initialState.loggedIn) {
    return;
  }
  await bringPageToFront(client);
  const loggedIn = await waitUntil(async () => (await readHipassLoginState(client)).loggedIn, HIPASS_LOGIN_WAIT_MS);
  if (!loggedIn) {
    throw new Error("로그인 필요: 열린 하이패스 창에서 직접 로그인해 주세요. 로그인 완료까지 기다렸지만 확인하지 못했습니다.");
  }
}

async function openHipassUsagePage(client) {
  const hrefResult = await evaluate(client, "location.href", true).catch(() => null);
  const href = String(hrefResult?.result?.result?.value || "");
  if (!href.includes("/usepculr/InitUsePculrTabSearch.do")) {
    const clicked = await clickHipassUsageLookupFromMain(client).catch(() => false);
    if (clicked) {
      await waitFor(
        client,
        "location.href.includes('/usepculr/InitUsePculrTabSearch.do') || document.body.innerText.includes('하이패스 카드 사용내역 조회')",
        20000,
        "하이패스 사용내역 조회 화면"
      );
    } else {
      await navigate(client, HIPASS_USAGE_URL);
      await waitForHipassLogin(client);
    }
  }
  await ensureHipassUsagePageReady(client);
}

async function clickHipassUsageLookupFromMain(client) {
  const result = await evaluate(client, `
    (() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, '');
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const labels = ['사용내역조회', '하이패스사용내역조회', '통행료사용내역조회'];
      const candidates = [...document.querySelectorAll('a,button,input[type=button],input[type=submit],[role=button]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.value || element.title || element.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
          return { element, rect, text, compact: normalize(text), href: element.href || '' };
        })
        .filter((item) =>
          visible(item.element) &&
          (
            labels.some((label) => item.compact.includes(label)) ||
            item.href.includes('/usepculr/InitUsePculrTabSearch.do') ||
            item.href.includes('/usepculr/InitUsePculrCalSearch.do')
          )
        )
        .sort((left, right) =>
          (left.compact.includes('사용내역조회') ? 0 : 1) - (right.compact.includes('사용내역조회') ? 0 : 1) ||
          left.rect.y - right.rect.y ||
          left.rect.x - right.rect.x
        );
      const hit = candidates[0];
      if (!hit) return null;
      hit.element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = hit.element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, text: hit.text, href: hit.href };
    })()
  `, true);
  const hit = result.result.result.value;
  if (!hit) return false;
  await click(client, hit.x + hit.w / 2, hit.y + hit.h / 2);
  return true;
}

async function queryHipassUsageDate(client, dateKey) {
  await ensureHipassUsagePageReady(client);
  if (await isHipassReceiptPrintPage(client)) {
    return null;
  }
  const tableViewClicked = await clickHipassText(
    client,
    ["표로 보기", "표로보기", "표 보기", "표보기"],
    { minY: 450 }
  ).catch(() => false);
  if (tableViewClicked) {
    await waitFor(
      client,
      "location.href.includes('/usepculr/InitUsePculrTabSearch.do') || document.querySelector('#sDate_view, #eDate_view')",
      15000,
      "하이패스 표로보기 화면"
    );
  }
  await delay(500);
  await setHipassDateInputs(client, dateKey);
  const clicked = await submitHipassUsageSearch(client) ||
    await clickHipassText(client, ["조회", "검색"], { minY: 450, preferBottom: true });
  if (!clicked) {
    throw new Error("하이패스 사용내역 조회 버튼을 찾지 못했습니다.");
  }
  await delay(1800);
  const targetsBeforeReceipt = await listChromeTargets();
  const targetIdsBeforeReceipt = new Set(targetsBeforeReceipt.map((target) => target.id));
  const receiptClicked = await submitHipassReceiptPrint(client) || await clickHipassText(
    client,
    ["영수증 전체 출력", "영수증전체출력", "전체 출력", "전체출력", "영수증 출력", "영수증출력"],
    { minY: 450, preferBottom: true }
  );
  if (!receiptClicked) {
    if (await isHipassReceiptPrintPage(client)) return null;
    const bodyText = await evaluate(client, "document.body.innerText", true).catch(() => null);
    const text = String(bodyText?.result?.result?.value || "");
    if (isHipassNoResultText(text)) return null;
    throw new Error("하이패스 영수증 전체 출력 버튼을 찾지 못했습니다.");
  }
  const popupTarget = await waitForHipassReceiptPopupTarget(client.targetId, targetIdsBeforeReceipt);
  await delay(1200);
  return popupTarget;
}

async function isHipassReceiptPrintPage(client) {
  const result = await evaluate(client, `
    (() => {
      const href = location.href || '';
      const text = (document.body.innerText || '').replace(/\\s+/g, '');
      return href.includes('/usepculr/UsePculrReceiptPrint.do') ||
        (text.includes('하이패스는빠르고편리합니다') && text.includes('영수증') && text.includes('공급가액'));
    })()
  `, true).catch(() => null);
  return Boolean(result?.result?.result?.value);
}

async function readHipassLoginState(client) {
  const result = await evaluate(client, `
    (() => {
      const text = (document.body.innerText || '').replace(/\\s+/g, ' ');
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const userId = [...document.querySelectorAll('#per_user_id, input[name=per_user_id], input[name=user_id], input[type=text]')]
        .find((input) => visible(input) && /아이디|id|user/i.test([input.id, input.name, input.placeholder, input.title].join(' ')));
      const password = [...document.querySelectorAll('#per_user_pw, input[type=password]')].find(visible);
      const visibleButtons = [...document.querySelectorAll('a,button,input[type=button],input[type=submit],[role=button]')]
        .filter(visible)
        .map((element) => (element.innerText || element.value || element.title || element.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' '))
        .filter(Boolean);
      const hasVisibleLogin = visibleButtons.some((label) => label === '로그인' || label.includes('개인 로그인') || label.includes('법인 로그인'));
      const hasVisibleLogout = visibleButtons.some((label) => label.includes('로그아웃'));
      return {
        loggedIn: hasVisibleLogout && !password && !userId,
        hasLoginForm: Boolean(userId || password),
        hasLoginButton: hasVisibleLogin
      };
    })()
  `, true).catch(() => null);
  return result?.result?.result?.value || { loggedIn: false, hasLoginForm: false, hasLoginButton: false };
}

async function ensureHipassUsagePageReady(client) {
  const state = await readHipassLoginState(client);
  if (!state.loggedIn && (state.hasLoginForm || state.hasLoginButton)) {
    await bringPageToFront(client);
    throw new Error("로그인 필요: 열린 하이패스 창에서 직접 로그인한 뒤 캡처를 다시 실행해 주세요.");
  }

  const ready = await waitUntil(async () => {
    const result = await evaluate(client, `
      (() => {
        const text = (document.body.innerText || '').replace(/\\s+/g, ' ');
        const hasDateInput = [...document.querySelectorAll('input')].some((input) => {
          const rect = input.getBoundingClientRect();
          const name = [input.name, input.id, input.title, input.placeholder, input.getAttribute('aria-label')]
            .filter(Boolean)
            .join(' ');
          return rect.width > 0 && rect.height > 0 && /date|dt|일자|날짜|기간|시작|종료|from|to/i.test(name);
        });
        return hasDateInput || text.includes('사용내역') || text.includes('조회기간') || text.includes('영수증');
      })()
    `, true).catch(() => null);
    return Boolean(result?.result?.result?.value);
  }, 10000);
  if (!ready) {
    throw new Error("하이패스 사용내역 조회 화면을 찾지 못했습니다. 로그인 후 사용내역 조회 화면이 열렸는지 확인해 주세요.");
  }
}

async function setHipassDateInputs(client, dateKey) {
  const result = await evaluate(client, `
    (() => {
      const dateKey = ${JSON.stringify(dateKey)};
      const compact = dateKey.replace(/-/g, '');
      const monthKey = dateKey.slice(0, 7);
      const compactMonth = monthKey.replace(/-/g, '');
      const inputs = [...document.querySelectorAll('input')]
        .filter((input) => {
          const rect = input.getBoundingClientRect();
          const type = String(input.type || '').toLowerCase();
          return rect.width > 0 && rect.height > 0 && !['hidden', 'button', 'submit', 'checkbox', 'radio'].includes(type);
        });
      const dateInputs = inputs.filter((input) => {
        const name = [input.name, input.id, input.title, input.placeholder, input.getAttribute('aria-label')]
          .filter(Boolean)
          .join(' ');
        return /date|dt|일자|날짜|기간|시작|종료|from|to|month|월|조회월|년월|ym/i.test(name) ||
          /\\d{4}[-.]?\\d{2}([-./]?\\d{2})?/.test(input.value || '');
      });
      const targets = dateInputs.length >= 2 ? dateInputs.slice(0, 2) : inputs.slice(0, 2);
      for (const input of targets) {
        const name = [input.name, input.id, input.title, input.placeholder, input.getAttribute('aria-label')]
          .filter(Boolean)
          .join(' ');
        input.focus();
        const isMonthInput = /month|월|조회월|년월|ym/i.test(name) || input.type === 'month' || input.maxLength === 6;
        const value = isMonthInput
          ? (input.maxLength === 6 || /^\\d{6}$/.test(input.value || '') ? compactMonth : monthKey)
          : (input.maxLength === 8 || /^\\d{8}$/.test(input.value || '') ? compact : dateKey);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      for (const [id, value] of [['sDate', compact], ['eDate', compact], ['sDate_view', dateKey], ['eDate_view', dateKey]]) {
        const input = document.getElementById(id);
        if (!input) continue;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const usageDateRadio = document.getElementById('rdo_date_type1');
      if (usageDateRadio) {
        usageDateRadio.checked = true;
        usageDateRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const receiptTimeRadio = document.getElementById('receipt_time_type1');
      if (receiptTimeRadio) {
        receiptTimeRadio.checked = true;
        receiptTimeRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      const datepicker = document.getElementById('ui-datepicker-div');
      if (datepicker) datepicker.style.display = 'none';
      const selects = [...document.querySelectorAll('select')].filter((select) => {
        const rect = select.getBoundingClientRect();
        const name = [select.name, select.id, select.title, select.getAttribute('aria-label')]
          .filter(Boolean)
          .join(' ');
        return rect.width > 0 && rect.height > 0 && /월|month|년|year|ym/i.test(name);
      });
      for (const select of selects) {
        const name = [select.name, select.id, select.title, select.getAttribute('aria-label')].filter(Boolean).join(' ');
        const wanted = /년|year/i.test(name) ? dateKey.slice(0, 4) : String(Number(dateKey.slice(5, 7)));
        const option = [...select.options].find((candidate) =>
          candidate.value === wanted ||
          candidate.textContent.trim() === wanted ||
          candidate.textContent.includes(wanted)
        );
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return { count: targets.length + selects.length + (document.getElementById('sDate') ? 1 : 0) };
    })()
  `, true);
  if (!result.result.result.value?.count) {
    throw new Error("하이패스 조회 날짜 입력칸을 찾지 못했습니다.");
  }
}

async function submitHipassUsageSearch(client) {
  const result = await evaluate(client, `
    (() => {
      if (typeof window.fn_search_usepculr === 'function') {
        const previousEvent = window.event;
        try {
          window.event = { clientX: 0, clientY: 0 };
          window.fn_search_usepculr(1, '/usepculr/UsePculrTabSearchList.do');
          return true;
        } finally {
          try { window.event = previousEvent; } catch (_) {}
        }
      }
      const lookup = document.querySelector('#lookupBtn a');
      if (lookup) {
        lookup.scrollIntoView({ block: 'center', inline: 'center' });
        lookup.click();
        return true;
      }
      return false;
    })()
  `, true).catch(() => null);
  return Boolean(result?.result?.result?.value);
}

async function submitHipassReceiptPrint(client) {
  const result = await evaluate(client, `
    (() => {
      const frames = [...document.querySelectorAll('iframe')];
      for (const frame of frames) {
        try {
          const win = frame.contentWindow;
          const doc = frame.contentDocument;
          if (win && typeof win.fn_print_receipt_html === 'function') {
            win.fn_print_receipt_html('1');
            return true;
          }
          const button = doc?.querySelector('#billAll');
          if (button) {
            button.click();
            return true;
          }
        } catch (_) {}
      }
      if (typeof window.fn_print_receipt_html === 'function') {
        window.fn_print_receipt_html('1');
        return true;
      }
      const button = document.querySelector('#billAll');
      if (button) {
        button.click();
        return true;
      }
      return false;
    })()
  `, true).catch(() => null);
  return Boolean(result?.result?.result?.value);
}

async function clickHipassText(client, labels, options = {}) {
  const result = await evaluate(client, `
    (() => {
      const labels = ${JSON.stringify(labels)};
      const minY = ${JSON.stringify(Number(options.minY) || 0)};
      const preferBottom = ${JSON.stringify(Boolean(options.preferBottom))};
      const normalize = (value) => String(value || '').replace(/\\s+/g, '');
      const documents = [{ doc: document, offsetX: 0, offsetY: 0 }];
      for (const frame of [...document.querySelectorAll('iframe')]) {
        try {
          const rect = frame.getBoundingClientRect();
          if (frame.contentDocument) documents.push({ doc: frame.contentDocument, offsetX: rect.x, offsetY: rect.y });
        } catch (_) {}
      }
      const elements = documents.flatMap(({ doc, offsetX, offsetY }) =>
        [...doc.querySelectorAll('a,button,input[type=button],input[type=submit],[role=button]')]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const text = (element.innerText || element.value || element.title || element.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
            return {
              element,
              offsetX,
              offsetY,
              rect: {
                x: rect.x + offsetX,
                y: rect.y + offsetY,
                width: rect.width,
                height: rect.height
              },
              text
            };
          })
      )
        .map((item) => {
          const { element, offsetX, offsetY, rect, text } = item;
          return { element, offsetX, offsetY, rect, text };
        })
        .filter((item) => {
          if (item.rect.width <= 0 || item.rect.height <= 0 || item.rect.y < minY) return false;
          const compact = normalize(item.text);
          return labels.some((label) => item.text.includes(label) || compact.includes(normalize(label)));
        })
        .sort((left, right) =>
          left.text.length - right.text.length ||
          (preferBottom ? right.rect.y - left.rect.y : left.rect.y - right.rect.y) ||
          left.rect.x - right.rect.x
        );
      const hit = elements[0];
      if (!hit) return null;
      hit.element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = hit.element.getBoundingClientRect();
      return {
        x: rect.x + (hit.offsetX || 0),
        y: rect.y + (hit.offsetY || 0),
        w: rect.width,
        h: rect.height
      };
    })()
  `, true);
  const hit = result.result.result.value;
  if (!hit) return false;
  await click(client, hit.x + hit.w / 2, hit.y + hit.h / 2);
  return true;
}

function isHipassNoResultText(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  return [
    "조회된내역이없습니다",
    "조회결과가없습니다",
    "사용내역이없습니다",
    "자료가없습니다"
  ].some((label) => compact.includes(label));
}

async function filterHipassReceiptPage(client, dateKey, options = {}) {
  const excludeFromHour = Number.isFinite(Number(options.excludeFromHour))
    ? Number(options.excludeFromHour)
    : 21;
  const result = await evaluate(client, `
    (() => {
      const targetDate = ${JSON.stringify(dateKey)};
      const excludeFromHour = ${JSON.stringify(excludeFromHour)};
      const normalizeDate = (year, month, day) =>
        [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
      const receiptTime = (text) => {
        const match = String(text || '').match(/(20\\d{2})\\s*년\\s*(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일\\s*(\\d{1,2})\\s*시\\s*(\\d{1,2})\\s*분/);
        if (!match) return null;
        return {
          dateKey: normalizeDate(match[1], match[2], match[3]),
          hour: Number(match[4]),
          minute: Number(match[5])
        };
      };
      const isReceiptText = (text) => {
        const compact = String(text || '').replace(/\\s+/g, '');
        return compact.includes('하이패스는빠르고편리합니다') || compact.includes('영수증한국도로공사') || compact.includes('공급가액');
      };
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const tables = [...document.querySelectorAll('table')]
        .filter((table) => visible(table) && isReceiptText(table.innerText));
      const containers = tables.filter((table) =>
        !tables.some((other) => other !== table && other.contains(table) && isReceiptText(other.innerText))
      );
      let kept = 0;
      let hidden = 0;
      for (const table of containers) {
        const text = table.innerText || '';
        const issuedAt = receiptTime(text);
        const keep = issuedAt && issuedAt.dateKey === targetDate && issuedAt.hour < excludeFromHour;
        if (keep) {
          kept += 1;
          table.dataset.travelProofHipassKeep = '1';
          table.style.display = '';
          table.style.visibility = 'visible';
          table.style.outline = '4px solid #ff0000';
          table.style.outlineOffset = '-4px';
          table.scrollIntoView({ block: 'start', inline: 'nearest' });
        } else {
          hidden += 1;
          table.dataset.travelProofHipassKeep = '0';
          table.style.display = 'none';
        }
      }
      const printControls = [...document.querySelectorAll('button,input[type=button],input[type=submit],a')]
        .filter((element) => /영수증\\s*인쇄|보고서\\s*인쇄|취소/.test(element.innerText || element.value || ''));
      for (const element of printControls) {
        const wrapper = element.closest('table,div,p') || element;
        wrapper.style.display = 'none';
      }
      return { kept, hidden };
    })()
  `, true);
  return result.result.result.value || { kept: 0, hidden: 0 };
}

async function getHipassReceiptClip(client) {
  const result = await evaluate(client, `
    (() => {
      const bodyRect = document.body.getBoundingClientRect();
      const candidates = [...document.querySelectorAll('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || '').replace(/\\s+/g, ' ');
          return { element, rect, text };
        })
        .filter((item) =>
          item.rect.width > 180 &&
          item.rect.height > 80 &&
          getComputedStyle(item.element).display !== 'none' &&
          getComputedStyle(item.element).visibility !== 'hidden' &&
          item.element.dataset.travelProofHipassKeep === '1'
        )
        .sort((left, right) => (left.rect.top - right.rect.top) || (left.rect.left - right.rect.left));
      const rect = candidates[0]?.rect || bodyRect;
      const padding = 8;
      const x = Math.max(0, Math.floor(rect.left - padding));
      const y = Math.max(0, Math.floor(rect.top - padding));
      const right = Math.min(document.documentElement.scrollWidth, Math.ceil(rect.right + padding));
      const bottom = Math.min(document.documentElement.scrollHeight, Math.ceil(rect.bottom + padding));
      return {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
        scale: 1
      };
    })()
  `, true);
  return result.result.result.value || { x: 0, y: 0, width: 900, height: 700, scale: 1 };
}

async function waitForHipassReceiptPopupTarget(currentTargetId, targetIdsBeforeReceipt) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const targets = await listChromeTargets();
    const popupTarget = targets.find((target) =>
      target.type === "page" &&
      target.webSocketDebuggerUrl &&
      target.id !== currentTargetId &&
      !targetIdsBeforeReceipt.has(target.id)
    );
    if (popupTarget) {
      return popupTarget;
    }
    await delay(500);
  }
  return null;
}

async function ensureChrome(options) {
  const endpoint = `http://127.0.0.1:${DEBUG_PORT}`;
  if (await canReachChrome(endpoint)) {
    return endpoint;
  }

  const chromePath = options.chromePath || CHROME_PATHS.find((candidate) => existsSync(candidate));
  if (!chromePath) {
    throw new Error("Chrome or Edge executable was not found.");
  }
  const profileDir = resolve(
    options.profileDir ||
    process.env.TRAVEL_PROOF_CHROME_PROFILE ||
    join(process.cwd(), "chrome-travel-proof-profile")
  );
  await mkdir(profileDir, { recursive: true });

  spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    "--window-size=1024,900",
    "--disable-popup-blocking",
    "about:blank"
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();

  const started = await waitUntil(async () => canReachChrome(endpoint), 15000);
  if (!started) {
    throw new Error("Chrome automation window did not start.");
  }
  return endpoint;
}

async function canReachChrome(endpoint) {
  try {
    const response = await fetch(`${endpoint}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function createTab(endpoint) {
  const response = await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) {
    throw new Error("Could not create a Chrome tab.");
  }
  return response.json();
}

async function acquireAutomationTab(endpoint, key, fastCapture) {
  if (fastCapture && reusableTabIds.has(key)) {
    const targetId = reusableTabIds.get(key);
    const target = (await listChromeTargets()).find((candidate) => candidate.id === targetId);
    if (target?.webSocketDebuggerUrl) return target;
    reusableTabIds.delete(key);
  }

  const tab = await createTab(endpoint);
  if (fastCapture) reusableTabIds.set(key, tab.id);
  return tab;
}

async function releaseAutomationTab(tab, key, fastCapture) {
  if (fastCapture && reusableTabIds.get(key) === tab.id) return;
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.id}`).catch(() => {});
}

function isFastCaptureEnabled(options = {}) {
  return options.fastCapture === undefined
    ? DEFAULT_FAST_CAPTURE_ENABLED
    : Boolean(options.fastCapture);
}

async function listChromeTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  if (!response.ok) {
    return [];
  }
  return response.json();
}

async function navigate(client, url) {
  const loaded = client.waitForEvent("Page.loadEventFired", 15000);
  await client.call("Page.navigate", { url });
  await loaded.catch(async () => {
    await waitFor(
      client,
      "document.readyState === 'interactive' || document.readyState === 'complete'",
      5000,
      "페이지 로딩"
    );
  });
}

async function prepareDirections(client) {
  await waitForSearchInputCount(client, 2, 15000);
}

async function addWaypointInput(client, waypointIndex) {
  const expectedCount = waypointIndex + 3;
  await waitForControl(client, { text: "경유지", classPart: "via", label: "add waypoint button" }, 10000);
  await clickControl(client, { text: "경유지", classPart: "via", label: "add waypoint button" });
  if (await hasSearchInputCount(client, expectedCount, 5000)) {
    return;
  }
  await waitForControl(client, { text: "경유지", classPart: "via", label: "add waypoint button retry" }, 10000);
  await clickControl(client, { text: "경유지", classPart: "via", label: "add waypoint button retry" });
  await waitForSearchInputCount(client, expectedCount, 10000);
}

async function selectEndpoint(client, inputIndex, query, slot) {
  await confirmSearchInput(client, inputIndex, query, slot);
}

async function selectWaypoint(client, inputIndex, waypoint, slot) {
  const selectedByName = await tryConfirmSearchInput(client, inputIndex, waypoint.searchName, slot);
  if (selectedByName.ok) {
    return selectedByName;
  }
  return tryConfirmSearchInput(client, inputIndex, waypoint.fallbackAddress, slot);
}

async function tryConfirmSearchInput(client, inputIndex, query, slot) {
  try {
    await confirmSearchInput(client, inputIndex, query, slot);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function confirmSearchInput(client, inputIndex, query, slot) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await typeIntoSearchInput(client, inputIndex, query);
      await pressEnter(client);
      await delay(2500);
      await clickFirstSearchResultAction(client, query, slot);
      await delay(1500);
      await waitForInputCommitted(client, inputIndex, query, slot);
      return;
    } catch (error) {
      lastError = error;
      await delay(1200);
    }
  }

  throw lastError || new Error(`Could not confirm ${slot}: ${query}`);
}

async function clickControl(client, { text = "", classPart = "", label = text || classPart }) {
  const button = await findVisibleButton(client, { text, classPart });
  if (!button) {
    const visible = await visibleControls(client);
    throw new Error(`Could not find ${label}. Visible controls: ${visible.slice(0, 12).join(" | ")}`);
  }
  await click(client, button.x + button.w / 2, button.y + button.h / 2);
}

async function waitForControl(client, query, timeoutMs) {
  const ok = await waitUntil(async () => Boolean(await findVisibleButton(client, query)), timeoutMs);
  if (ok) {
    return;
  }

  const visible = await visibleControls(client);
  throw new Error(`Could not find ${query.label || query.text || query.classPart}. Visible controls: ${visible.slice(0, 12).join(" | ")}`);
}

async function waitForSearchInputCount(client, count, timeoutMs) {
  const ok = await hasSearchInputCount(client, count, timeoutMs);
  if (!ok) {
    throw new Error(`Could not find ${count} route input fields.`);
  }
}

async function hasSearchInputCount(client, count, timeoutMs) {
  return waitUntil(async () => {
    const inputs = await getVisibleSearchInputs(client);
    return inputs.length >= count;
  }, timeoutMs);
}

async function waitForInputCommitted(client, inputIndex, query, slot) {
  const ok = await waitUntil(async () => {
    const inputs = await getVisibleSearchInputs(client);
    const input = inputs[inputIndex];
    return Boolean(input && String(input.value || query).trim());
  }, 8000);

  if (!ok) {
    throw new Error(`Could not confirm ${slot}: ${query}`);
  }
}

async function findVisibleButton(client, { text = "", classPart = "" }) {
  const escapedText = JSON.stringify(text);
  const escapedClass = JSON.stringify(classPart);
  const expression = `
    (() => {
      const text = ${escapedText};
      const classPart = ${escapedClass};
      const candidates = [...document.querySelectorAll('button,a,[role=button]')];
      const hit = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        const label = (element.innerText || element.getAttribute('aria-label') || '').trim();
        const classes = String(element.className || '');
        const classTokens = classes.split(/\\s+/).filter(Boolean);
        const textMatches = !text || label.includes(text);
        const classMatches = !classPart || classTokens.includes(classPart);
        return rect.width > 0 && rect.height > 0 && textMatches && classMatches;
      });
      if (!hit) return null;
      const rect = hit.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    })()
  `;
  const result = await evaluate(client, expression, true);
  return result.result.result.value || null;
}

async function visibleControls(client) {
  const result = await evaluate(client, `
    (() => [...document.querySelectorAll('button,a,[role=button]')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: (element.innerText || element.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' '),
          classes: String(element.className || '').replace(/\\s+/g, '.'),
          visible: rect.width > 0 && rect.height > 0,
          x: Math.round(rect.x),
          y: Math.round(rect.y)
        };
      })
      .filter((item) => item.visible)
      .map((item) => [item.label, item.classes, item.x + ',' + item.y].filter(Boolean).join(' / '))
    )()
  `, true);
  return result.result.result.value || [];
}

async function waitForCoupangOrderList(client) {
  const ok = await waitUntil(async () => {
    const result = await evaluate(client, `
      (() => {
        const text = (document.body?.innerText || '').replace(/\\s+/g, ' ');
        const isLoginPage = location.href.includes('login') ||
          (text.includes('로그인') && (text.includes('아이디') || text.includes('비밀번호')));
        const looksLikeOrderList = location.href.includes('/order/list') &&
          (text.includes('주문') || text.includes('구매') || text.includes('최근'));
        return !isLoginPage && looksLikeOrderList;
      })()
    `, true).catch(() => null);
    return Boolean(result?.result?.result?.value);
  }, COUPANG_LOGIN_WAIT_MS);

  if (!ok) {
    throw new Error("쿠팡 로그인 완료를 확인하지 못했습니다. 열린 자동화 Chrome에서 로그인 후 주문목록이 보일 때까지 기다려 주세요.");
  }
}

async function scrollCoupangOrderListToTop(client) {
  await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })", true).catch(() => {});
  await delay(700);
}

async function scrollCoupangOrderListNext(client) {
  await evaluate(client, `
    (() => {
      window.scrollBy({ top: Math.max(500, Math.floor(window.innerHeight * 0.8)), behavior: 'instant' });
    })()
  `, true).catch(() => null);
  await delay(1200);
}

async function buildCoupangOrderIndex(client, dateKeys = []) {
  const targetDates = new Set(dateKeys);
  const index = new Map(dateKeys.map((dateKey) => [dateKey, []]));
  const addOrders = (orders = []) => {
    for (const order of orders) {
      if (!targetDates.has(order.dateKey)) {
        continue;
      }
      const current = index.get(order.dateKey) || [];
      if (!current.includes(order.orderId)) {
        current.push(order.orderId);
        index.set(order.dateKey, current);
      }
    }
  };
  const isComplete = () => dateKeys.every((dateKey) => (index.get(dateKey) || []).length);

  for (let page = 1; page <= COUPANG_ORDER_SEARCH_PAGES; page += 1) {
    addOrders(await readCoupangOrdersFromCurrentPage(client));
    addOrders(await readCoupangOrdersFromNetworkEvents(client));
    if (isComplete()) {
      break;
    }

    const moved = await clickCoupangNextOrderPage(client);
    if (!moved) {
      break;
    }
  }

  await navigate(client, COUPANG_ORDER_LIST_URL);
  await waitForCoupangOrderList(client);
  return index;
}

async function readCoupangOrdersFromCurrentPage(client) {
  const result = await evaluate(client, `
    (() => {
      const values = [];
      const nextData = document.getElementById('__NEXT_DATA__')?.textContent || '';
      if (nextData) values.push(nextData);
      for (const script of document.querySelectorAll('script[type="application/json"], script:not([src])')) {
        const text = (script.textContent || '').trim();
        if (text && (text.includes('orderId') || text.includes('orderedAt'))) {
          values.push(text);
        }
      }
      return [...new Set(values)].slice(0, 12);
    })()
  `, true).catch(() => null);
  const scripts = result?.result?.result?.value || [];
  return extractCoupangOrdersFromJsonTexts(scripts);
}

async function readCoupangOrdersFromNetworkEvents(client) {
  const events = client.recentEvents("Network.responseReceived")
    .filter((event) => {
      const response = event?.response || {};
      const url = String(response.url || "");
      const mime = String(response.mimeType || "");
      return /order/i.test(url) && /json/i.test(mime || url);
    })
    .slice(-30);
  const orders = [];
  for (const event of events) {
    const requestId = event.requestId;
    if (!requestId) {
      continue;
    }
    const body = await client.call("Network.getResponseBody", { requestId }).catch(() => null);
    const text = body?.result?.body || "";
    if (text) {
      orders.push(...extractCoupangOrdersFromJsonTexts([text]));
    }
  }
  return orders;
}

function extractCoupangOrdersFromJsonTexts(texts = []) {
  const orders = [];
  for (const text of texts) {
    try {
      orders.push(...extractCoupangOrdersFromData(JSON.parse(text)));
    } catch {
      // Ignore non-JSON inline scripts. Existing DOM fallback will handle misses.
    }
  }
  return orders;
}

async function countCoupangOrdersForDateWithScroll(client, candidates) {
  for (let page = 1; page <= COUPANG_ORDER_SEARCH_PAGES; page += 1) {
    const orderCount = await countCoupangOrdersForDateOnCurrentPage(client, candidates);
    if (orderCount) {
      return orderCount;
    }

    const moved = await clickCoupangNextOrderPage(client);
    if (!moved) {
      return 0;
    }
  }

  return 0;
}

async function countCoupangOrdersForDateOnCurrentPage(client, candidates) {
  await scrollCoupangOrderListToTop(client);

  for (let attempt = 0; attempt <= COUPANG_ORDER_SEARCH_SCROLLS; attempt += 1) {
    const orderCount = await countCoupangOrdersForDate(client, candidates);
    if (orderCount) {
      return orderCount;
    }

    await scrollCoupangOrderListNext(client);
  }

  return 0;
}

async function findCoupangOrderIdsForDateWithPages(client, dateKey) {
  for (let page = 1; page <= COUPANG_ORDER_SEARCH_PAGES; page += 1) {
    const orderIds = await findCoupangOrderIdsForDateOnCurrentPage(client, dateKey);
    if (orderIds.length) {
      return orderIds;
    }

    const moved = await clickCoupangNextOrderPage(client);
    if (!moved) {
      return [];
    }
  }

  return [];
}

async function findCoupangOrderIdsForDateOnCurrentPage(client, dateKey) {
  await scrollCoupangOrderListToTop(client);
  const seenIds = new Set();
  for (let attempt = 0; attempt <= COUPANG_ORDER_SEARCH_SCROLLS; attempt += 1) {
    const result = await evaluate(client, `
    (() => {
      const targetDateKey = ${JSON.stringify(dateKey)};
      const nextDataText = document.getElementById('__NEXT_DATA__')?.textContent || '';
      if (!nextDataText) return [];

      const formatDateKey = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const parts = new Intl.DateTimeFormat('en', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(date);
        const part = (type) => parts.find((item) => item.type === type)?.value || '';
        return [part('year'), part('month'), part('day')].filter(Boolean).join('-');
      };

      try {
        const nextData = JSON.parse(nextDataText);
        const orderList = nextData?.props?.pageProps?.domains?.desktopOrder?.orderList || [];
        const ids = orderList
          .filter((order) => formatDateKey(order.orderedAt) === targetDateKey)
          .map((order) => String(order.orderId || '').trim())
          .filter(Boolean);
        return [...new Set(ids)];
      } catch {
        return [];
      }
    })()
  `, true).catch(() => null);

    const ids = result?.result?.result?.value;
    if (Array.isArray(ids)) {
      ids.forEach((id) => seenIds.add(id));
    }
    await scrollCoupangOrderListNext(client);
  }
  return [...seenIds];
}

async function openCoupangOrderDetailById(client, orderId) {
  await navigate(client, `https://mc.coupang.com/ssr/desktop/order/${encodeURIComponent(orderId)}`);
  await waitFor(
    client,
    "(document.body.innerText || '').includes('주문상세') || (document.body.innerText || '').includes('결제영수증 정보')",
    20000,
    "쿠팡 주문상세"
  );
  return true;
}

async function clickCoupangNextOrderPage(client) {
  await evaluate(client, "window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })", true).catch(() => {});
  await delay(700);

  const result = await evaluate(client, `
    (() => {
      const controls = [...document.querySelectorAll('a,button,[role=button]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().replace(/\\s+/g, ' ');
          const disabled = element.disabled ||
            element.getAttribute('aria-disabled') === 'true' ||
            /disabled/i.test(String(element.className || ''));
          return { element, rect, text, disabled };
        })
        .filter((item) => item.rect.width > 0 && item.rect.height > 0 && !item.disabled);

      const hit = controls.find((item) =>
        item.text === '다음' ||
        item.text.includes('다음') ||
        item.text.toLowerCase() === 'next' ||
        item.text.includes('>')
      );
      if (!hit) return null;

      hit.element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = hit.element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, text: hit.text };
    })()
  `, true);

  const hit = result.result.result.value;
  if (!hit) {
    return false;
  }

  const before = await coupangOrderListSignature(client);
  await click(client, hit.x + hit.w / 2, hit.y + hit.h / 2);
  await delay(1800);
  await waitForCoupangOrderList(client);

  return waitUntil(async () => {
    const after = await coupangOrderListSignature(client);
    return after && after !== before;
  }, 8000);
}

async function coupangOrderListSignature(client) {
  const result = await evaluate(client, `
    (() => {
      const text = (document.body?.innerText || '').trim().replace(/\\s+/g, ' ');
      return [location.href, text.slice(0, 5000), window.scrollY].join('\\n');
    })()
  `, true).catch(() => null);
  return result?.result?.result?.value || "";
}

async function countCoupangOrdersForDate(client, candidates) {
  const result = await evaluate(client, `
    (() => {
      const candidates = ${JSON.stringify(candidates)};
      const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
      const matchesDate = (text) => candidates.some((candidate) => text.includes(candidate));
      const visibleItems = [...document.querySelectorAll('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = normalize(element.innerText || element.getAttribute('aria-label') || '');
          return { element, rect, text };
        })
        .filter((item) => item.rect.width > 0 && item.rect.height > 0);
      const detailLinks = visibleItems.filter((item) => item.text === '주문 상세보기');
      const dateHeaders = visibleItems
        .filter((item) =>
          matchesDate(item.text) &&
          item.text.length <= 140 &&
          item.rect.height <= 90 &&
          !item.text.includes('주문 상세보기') &&
          !item.text.includes('배송') &&
          !item.text.includes('장바구니') &&
          !item.text.includes('리뷰')
        )
        .sort((left, right) => (left.rect.y - right.rect.y) || (left.rect.x - right.rect.x));
      const hits = dateHeaders
        .map((header) => detailLinks.find((link) =>
          Math.abs(link.rect.y - header.rect.y) <= 90 ||
          (link.rect.y >= header.rect.y - 30 && link.rect.y <= header.rect.y + 260)
        ))
        .filter(Boolean);
      if (hits.length) {
        return [...new Set(hits.map((hit) => Math.round(hit.rect.x) + ',' + Math.round(hit.rect.y)))].length;
      }

      const blocks = visibleItems
        .filter((item) =>
          item.rect.width > 250 &&
          item.rect.height > 40 &&
          item.text.includes('주문 상세보기') &&
          matchesDate(item.text)
        );
      return blocks.filter((block) =>
        !blocks.some((other) => other !== block && other.element.contains(block.element) && other.text.includes('주문 상세보기'))
      ).length || blocks.length;
    })()
  `, true);
  return Number(result.result.result.value || 0);
}

async function clickCoupangOrderDetailForDate(client, candidates, orderIndex) {
  for (let page = 1; page <= COUPANG_ORDER_SEARCH_PAGES; page += 1) {
    const clicked = await clickCoupangOrderDetailForDateOnCurrentPage(client, candidates, orderIndex);
    if (clicked) {
      return true;
    }

    const moved = await clickCoupangNextOrderPage(client);
    if (!moved) {
      return false;
    }
  }

  return false;
}

async function clickCoupangOrderDetailForDateOnCurrentPage(client, candidates, orderIndex) {
  await scrollCoupangOrderListToTop(client);

  for (let attempt = 0; attempt <= COUPANG_ORDER_SEARCH_SCROLLS; attempt += 1) {
    const hit = await findCoupangOrderDetailForDate(client, candidates, orderIndex);
    if (hit) {
      if (!hit.clicked) {
        await click(client, hit.x + hit.w / 2, hit.y + hit.h / 2);
      }
      return true;
    }

    await scrollCoupangOrderListNext(client);
  }

  return false;
}

async function findCoupangOrderDetailForDate(client, candidates, orderIndex) {
  const result = await evaluate(client, `
    (() => {
      const candidates = ${JSON.stringify(candidates)};
      const orderIndex = ${Number(orderIndex) || 0};
      const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
      const matchesDate = (text) => candidates.some((candidate) => text.includes(candidate));
      const visibleItems = [...document.querySelectorAll('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = normalize(element.innerText || element.getAttribute('aria-label') || '');
          return { element, rect, text };
        })
        .filter((item) => item.rect.width > 0 && item.rect.height > 0);
      const detailLinks = visibleItems
        .filter((item) => item.text === '주문 상세보기')
        .sort((left, right) => (left.rect.y - right.rect.y) || (left.rect.x - right.rect.x));
      const dateHeaders = visibleItems
        .filter((item) =>
          matchesDate(item.text) &&
          item.text.length <= 140 &&
          item.rect.height <= 90 &&
          !item.text.includes('주문 상세보기') &&
          !item.text.includes('배송') &&
          !item.text.includes('장바구니') &&
          !item.text.includes('리뷰')
        )
        .sort((left, right) => (left.rect.y - right.rect.y) || (left.rect.x - right.rect.x));
      const headerHits = dateHeaders
        .map((header) => ({
          header,
          link: detailLinks.find((link) =>
            Math.abs(link.rect.y - header.rect.y) <= 90 ||
            (link.rect.y >= header.rect.y - 30 && link.rect.y <= header.rect.y + 260)
          )
        }))
        .filter((item) => item.link);
      const uniqueHeaderHits = headerHits.filter((item, index, list) =>
        list.findIndex((other) =>
          Math.abs(other.link.rect.x - item.link.rect.x) < 2 &&
          Math.abs(other.link.rect.y - item.link.rect.y) < 2
        ) === index
      );
      const headerHit = uniqueHeaderHits[orderIndex];
      if (headerHit) {
        headerHit.link.element.scrollIntoView({ block: 'center', inline: 'center' });
        const clickable = headerHit.link.element.closest('a,button,[role=button]') || headerHit.link.element;
        clickable.click();
        const rect = headerHit.link.element.getBoundingClientRect();
        return { clicked: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      }

      const blocks = visibleItems
        .filter((item) =>
          item.rect.width > 250 &&
          item.rect.height > 40 &&
          matchesDate(item.text) &&
          item.text.includes('주문 상세보기')
        )
        .sort((left, right) => (left.rect.y - right.rect.y) || (left.rect.x - right.rect.x));
      const block = blocks[orderIndex];
      if (!block) return null;
      const buttons = [...block.element.querySelectorAll('a,button,[role=button]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
          return { element, rect, text };
        })
        .filter((item) => item.rect.width > 0 && item.rect.height > 0 && item.text.includes('주문 상세보기'));
      const hit = buttons[0];
      if (!hit) return null;
      hit.element.scrollIntoView({ block: 'center', inline: 'center' });
      const clickable = hit.element.closest('a,button,[role=button]') || hit.element;
      clickable.click();
      const rect = hit.element.getBoundingClientRect();
      return { clicked: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    })()
  `, true);
  return result.result.result.value || null;
}

async function clickCoupangReceiptButton(client) {
  const result = await evaluate(client, `
    (() => {
      const labels = ['\\uac70\\ub798\\uba85\\uc138\\uc11c', '\\uac70\\ub798\\uba85\\uc138\\ud45c'];
      const hit = [...document.querySelectorAll('a,button,[role=button],input[type=button],input[type=submit]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.value || element.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
          return { element, rect, text };
        })
        .filter((item) =>
          item.rect.width > 0 &&
          item.rect.height > 0 &&
          item.rect.width < 420 &&
          item.rect.height < 120 &&
          labels.some((label) => item.text.includes(label))
        )
        .sort((left, right) =>
          left.text.length - right.text.length ||
          left.rect.y - right.rect.y ||
          left.rect.x - right.rect.x
        )[0];
      if (!hit) return null;
      hit.element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = hit.element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    })()
  `, true);
  const hit = result.result.result.value;
  if (!hit) {
    return false;
  }
  await click(client, hit.x + hit.w / 2, hit.y + hit.h / 2);
  return true;
}

async function waitForCoupangReceiptPopupTarget(orderDetailTargetId, targetIdsBeforeReceipt) {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    const targets = await listChromeTargets();
    const popupTarget = targets.find((target) =>
      target.type === "page" &&
      target.webSocketDebuggerUrl &&
      target.id !== orderDetailTargetId &&
      !targetIdsBeforeReceipt.has(target.id)
    );
    if (popupTarget) {
      return popupTarget;
    }
    await delay(500);
  }
  return null;
}

async function getCoupangReceiptClip(client) {
  const result = await evaluate(client, `
    (() => {
      const bodyRect = document.body.getBoundingClientRect();
      const title = [...document.querySelectorAll('body *')]
        .find((element) => ['거래명세서', '거래명세표'].some((label) =>
          (element.innerText || '').replace(/\\s+/g, '').includes(label)
        ));
      const table = document.querySelector('table') || title?.closest('body');
      const rect = (table || document.body).getBoundingClientRect();
      const right = Math.min(window.innerWidth, Math.max(rect.right, bodyRect.right));
      const bottom = Math.min(document.documentElement.scrollHeight, Math.max(rect.bottom, bodyRect.bottom));
      return {
        x: Math.max(0, Math.floor(Math.min(rect.left, bodyRect.left))),
        y: Math.max(0, Math.floor(Math.min(rect.top, bodyRect.top))),
        width: Math.max(720, Math.ceil(right - Math.min(rect.left, bodyRect.left))),
        height: Math.max(520, Math.ceil(bottom - Math.min(rect.top, bodyRect.top))),
        scale: 1
      };
    })()
  `, true);
  return result.result.result.value || { x: 0, y: 0, width: 760, height: 620, scale: 1 };
}

async function typeIntoSearchInput(client, index, text) {
  const input = await getVisibleSearchInput(client, index);
  if (!input) {
    throw new Error(`Could not find search input #${index + 1}.`);
  }

  await click(client, input.x + Math.min(120, input.w / 2), input.y + input.h / 2);
  await delay(200);
  await key(client, "a", 65, 2);
  await key(client, "Backspace", 8);
  await delay(250);
  await client.call("Input.insertText", { text });
  await delay(700);
}

async function getVisibleSearchInput(client, index) {
  const inputs = await getVisibleSearchInputs(client);
  return inputs[index] || null;
}

async function getVisibleSearchInputs(client) {
  const result = await evaluate(client, `
    (() => [...document.querySelectorAll('input.input_search')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, value: element.value };
      })
    )()
  `, true);
  return result.result.result.value || [];
}

async function clickFirstPlaceResult(client, query, slot) {
  const result = await evaluate(client, `
    (() => {
      const candidates = [...document.querySelectorAll('.item_place,.link_place')];
      const hit = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || '').trim();
        return rect.width > 0 && rect.height > 0 && text.includes(${JSON.stringify(query.split(/\s+/).at(-1) || query)});
      }) || candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!hit) return null;
      const rect = hit.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    })()
  `, true);
  const hit = result.result.result.value;
  if (!hit) {
    throw new Error(`Could not find a place result for ${slot}: ${query}`);
  }
  await click(client, hit.x + Math.min(160, hit.w / 2), hit.y + hit.h / 2);
}

async function clickFirstSearchResultAction(client, query, slot) {
  const ok = await waitUntil(async () => {
    const result = await evaluate(client, `
      (() => {
        const buttons = [...document.querySelectorAll('li[role=option] button.directions_box')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const hit = buttons[0];
        if (!hit) return null;
        const rect = hit.getBoundingClientRect();
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, label: hit.innerText || '' };
      })()
    `, true);
    const hit = result.result.result.value;
    if (!hit) {
      return false;
    }
    await click(client, hit.x + hit.w / 2, hit.y + hit.h / 2);
    return true;
  }, 10000);

  if (!ok) {
    throw new Error(`No place selection button found for ${slot}: ${query}`);
  }
}

async function getProofPanelClip(client) {
  const result = await evaluate(client, `
    (() => {
      const candidates = [...document.querySelectorAll('[class*="StyledCarDirectionsSummaryItem"],button,[role=button]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const classes = String(element.className || '');
          const text = (element.innerText || '').trim().replace(/\\s+/g, ' ');
          return { text, classes, visible: rect.width > 0 && rect.height > 0, x: rect.x, y: rect.y, w: rect.width, h: rect.height, bottom: rect.bottom };
        })
        .filter((item) =>
          item.visible &&
          item.x >= 60 &&
          item.x < 470 &&
          item.w >= 320 &&
          item.h >= 90 &&
          item.h <= 240 &&
          item.text.includes('실시간 추천')
        );
      const firstRoute = candidates
        .sort((a, b) => (a.y - b.y) || (b.h - a.h))[0];
      const height = firstRoute ? Math.ceil(firstRoute.bottom + 12) : 560;
      return { x: 63, y: 0, width: 410, height: Math.max(520, Math.min(height, 760)), scale: 1 };
    })()
  `, true);
  return result.result.result.value || { x: 63, y: 0, width: 410, height: 560, scale: 1 };
}

async function getPrimaryRouteSummaryText(client) {
  const result = await evaluate(client, `
    (() => {
      const candidates = [...document.querySelectorAll('[class*="StyledCarDirectionsSummaryItem"],button,[role=button]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || '').trim().replace(/\\s+/g, ' ');
          return { text, visible: rect.width > 0 && rect.height > 0, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        })
        .filter((item) =>
          item.visible &&
          item.x >= 60 &&
          item.x < 470 &&
          item.w >= 320 &&
          item.h >= 90 &&
          item.h <= 240 &&
          item.text.includes('실시간 추천')
        )
        .sort((a, b) => (a.y - b.y) || (b.h - a.h));
      return candidates[0]?.text || '';
    })()
  `, true);
  const summaryText = String(result.result.result.value || "");
  if (summaryText) return summaryText;

  const bodyText = await evaluate(client, "document.body.innerText", true);
  return String(bodyText.result.result.value || "");
}

async function highlightOilPriceRow(client, targetDate) {
  const result = await evaluate(client, `
    (() => {
      const targetDate = ${JSON.stringify(targetDate)};
      const normalizeDate = (value) => {
        const numbers = String(value || '').match(/\\d+/g) || [];
        if (numbers.length < 3) return '';
        const [year, month, day] = numbers.slice(-3);
        return [year.padStart(4, '0'), month.padStart(2, '0'), day.padStart(2, '0')].join('-');
      };
      const rows = [...document.querySelectorAll('.tbl_exchange.today tbody tr')];
      const row = rows.find((candidate) => {
        const dateCell = candidate.querySelector('td.date') || candidate.querySelector('td');
        return normalizeDate(dateCell?.innerText) === targetDate;
      });
      if (!row) return null;

      row.scrollIntoView({ block: 'center' });
      const cells = [...row.querySelectorAll('td')];
      const dateCell = cells[0];
      const priceCell = cells[1];
      for (const cell of [dateCell, priceCell]) {
        cell.style.outline = '5px solid #ff0000';
        cell.style.outlineOffset = '-5px';
        cell.style.position = 'relative';
        cell.style.zIndex = '2';
        cell.style.backgroundColor = '#ffffff';
      }

      return {
        dateText: (dateCell.innerText || '').trim(),
        priceText: (priceCell.innerText || '').trim()
      };
    })()
  `, true);
  return result.result.result.value || null;
}

async function readOilPricePageDates(client, fallbackYear) {
  const result = await evaluate(client, `
    (() => {
      const fallbackYear = ${JSON.stringify(fallbackYear)};
      return [...document.querySelectorAll('.tbl_exchange.today tbody tr')]
        .map((row) => (row.querySelector('td.date') || row.querySelector('td'))?.innerText || '')
        .map((value) => {
          const numbers = String(value).match(/\\d+/g) || [];
          const parts = numbers.length >= 3 ? numbers.slice(-3) : (numbers.length === 2 ? [fallbackYear, ...numbers] : []);
          if (parts.length !== 3) return '';
          const [year, month, day] = parts;
          return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
        })
        .filter(Boolean);
    })()
  `, true);
  return result.result.result.value || [];
}

async function getOilProofClip(client) {
  const result = await evaluate(client, `
    (() => {
      const section = document.querySelector('.section_exchange2');
      const table = document.querySelector('.tbl_exchange.today');
      const highlighted = [...document.querySelectorAll('.tbl_exchange.today tbody tr')]
        .find((row) => row.querySelector('td')?.style.outline);
      if (!section || !table || !highlighted) {
        return { x: 0, y: 0, width: 225, height: 360, scale: 1 };
      }

      const sectionRect = section.getBoundingClientRect();
      const priceRect = highlighted.querySelectorAll('td')[1].getBoundingClientRect();
      const rowRect = highlighted.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(sectionRect.left)),
        y: Math.max(0, Math.floor(sectionRect.top)),
        width: Math.ceil(priceRect.right - sectionRect.left + 8),
        height: Math.ceil(rowRect.bottom - sectionRect.top + 8),
        scale: 1
      };
    })()
  `, true);
  return result.result.result.value || { x: 0, y: 0, width: 225, height: 360, scale: 1 };
}

async function pressEnter(client) {
  await key(client, "Enter", 13);
}

async function key(client, keyName, keyCode, modifiers = 0) {
  await client.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: keyName,
    code: keyName,
    windowsVirtualKeyCode: keyCode,
    modifiers
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: keyName,
    code: keyName,
    windowsVirtualKeyCode: keyCode,
    modifiers
  });
}

async function click(client, x, y) {
  await client.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await client.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1
  });
}

async function waitFor(client, expression, timeoutMs, label = "화면") {
  const ok = await waitUntil(async () => {
    const result = await evaluate(client, `Boolean(${expression})`, true).catch(() => null);
    return Boolean(result?.result?.result?.value);
  }, timeoutMs);
  if (!ok) {
    throw new Error(`${label} 대기 시간이 초과되었습니다.`);
  }
}

async function evaluate(client, expression, returnByValue = false) {
  return client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue
  });
}

async function bringPageToFront(client) {
  await client.call("Page.bringToFront").catch(() => {});
}

async function waitUntil(check, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return true;
    }
    await delay(500);
  }
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(socket, targetId = "") {
    this.socket = socket;
    this.targetId = targetId;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.events = new Map();
  }

  static connect(url, targetId = "") {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const client = new CdpClient(socket, targetId);
      socket.addEventListener("open", () => resolve(client), { once: true });
      socket.addEventListener("message", (event) => client.handleMessage(event.data));
      socket.addEventListener("error", () => reject(new Error("Chrome 디버깅 연결에 실패했습니다.")), { once: true });
    });
  }

  call(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const message = JSON.stringify({ id, method, params });
    this.socket.send(message);

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  handleMessage(data) {
    const payload = JSON.parse(String(data));
    if (payload.method) {
      const events = this.events.get(payload.method) || [];
      events.push(payload.params || {});
      this.events.set(payload.method, events.slice(-80));
    }
    if (payload.method && this.eventWaiters.has(payload.method)) {
      const waiters = this.eventWaiters.get(payload.method);
      this.eventWaiters.delete(payload.method);
      for (const waiter of waiters) waiter.resolve(payload.params || {});
    }
    if (!payload.id || !this.pending.has(payload.id)) {
      return;
    }
    const pending = this.pending.get(payload.id);
    this.pending.delete(payload.id);

    if (payload.error) {
      pending.reject(new Error(payload.error.message || "Chrome 명령 실패"));
      return;
    }
    pending.resolve(payload);
  }

  waitForEvent(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const waiters = this.eventWaiters.get(method) || [];
      const waiter = {
        resolve: (value) => {
          clearTimeout(waiter.timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          reject(error);
        },
        timer: null
      };
      waiter.timer = setTimeout(() => {
        const current = this.eventWaiters.get(method) || [];
        this.eventWaiters.set(method, current.filter((candidate) => candidate !== waiter));
        waiter.reject(new Error(`${method} 대기 시간이 초과되었습니다.`));
      }, timeoutMs);
      waiters.push(waiter);
      this.eventWaiters.set(method, waiters);
    });
  }

  recentEvents(method) {
    return this.events.get(method) || [];
  }

  close() {
    for (const pending of this.pending.values()) pending.reject(new Error("Chrome 연결이 종료되었습니다."));
    this.pending.clear();
    for (const waiters of this.eventWaiters.values()) {
      for (const waiter of waiters) waiter.reject(new Error("Chrome 연결이 종료되었습니다."));
    }
    this.eventWaiters.clear();
    this.events.clear();
    this.socket.close();
  }
}
