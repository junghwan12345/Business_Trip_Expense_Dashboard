import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  classifyCoupangReceipt,
  coupangOrderDateCandidates,
  extractCoupangOrdersFromData,
  extractCoupangOrdersFromHtml,
  parseCoupangReceiptText,
  receiptFileBaseName
} from "./coupang-proof.js";
import {
  naverPayHistoryPageUrl,
  naverPayListDateKey,
  naverPayReceiptUrl,
  parseNaverPayReceiptText
} from "./naver-pay-proof.js";
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
const HIPASS_LOGIN_WAIT_MS = 3 * 60 * 1000;
const COUPANG_LOGIN_WAIT_MS = 5 * 60 * 1000;
const COUPANG_ORDER_SEARCH_PAGES = 12;
const NAVER_PAY_LOGIN_WAIT_MS = 5 * 60 * 1000;
const NAVER_PAY_SEARCH_PAGES = 10;
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

// 네이버페이 쇼핑 결제내역에서 날짜에 해당하는 주문을 찾아 영수증 화면을 캡처합니다.
export async function captureNaverPayReceipts({ dateKeys = [] } = {}, options = {}) {
  const endpoint = await ensureChrome(options);
  const tab = await createTab(endpoint);
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, tab.id);
  const results = [];
  const failures = [];

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await navigate(client, naverPayHistoryPageUrl(1));
    await waitForNaverPayHistory(client);

    const wanted = new Set(dateKeys);
    const orders = await collectNaverPayOrders(client, wanted);

    for (const dateKey of dateKeys) {
      const matched = orders.filter((order) => order.dateKey === dateKey);
      if (!matched.length) {
        failures.push({ dateKey, message: `${dateKey} 네이버페이 쇼핑 주문을 찾지 못했습니다.` });
        continue;
      }
      for (const order of matched) {
        try {
          results.push(await captureNaverPayReceipt(endpoint, order, dateKey));
        } catch (error) {
          failures.push({ dateKey, message: `${dateKey} 영수증 캡처 실패: ${error.message}` });
        }
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

async function waitForNaverPayHistory(client) {
  const ok = await waitUntil(async () => {
    const result = await evaluate(client, `
      (() => {
        const text = document.body?.innerText || '';
        const isLogin = location.href.includes('nidlogin') || location.href.includes('nid.naver.com');
        const hasList = location.href.includes('pay.naver.com') &&
          (text.includes('결제일시') || text.includes('결제 내역이 없') || text.includes('내역이 없습니다'));
        return !isLogin && hasList;
      })()
    `, true).catch(() => null);
    return Boolean(result?.result?.result?.value);
  }, NAVER_PAY_LOGIN_WAIT_MS);

  if (!ok) {
    throw new Error("네이버 로그인 완료를 확인하지 못했습니다. 열린 자동화 Chrome에서 로그인 후 네이버페이 결제내역이 보일 때까지 기다려 주세요.");
  }
}

// 필요한 날짜가 모두 나올 때까지 목록 페이지를 넘기며 주문을 모읍니다.
async function collectNaverPayOrders(client, wantedDateKeys) {
  const collected = new Map();
  for (let page = 1; page <= NAVER_PAY_SEARCH_PAGES; page += 1) {
    if (page > 1) {
      await navigate(client, naverPayHistoryPageUrl(page));
      await waitForNaverPayHistory(client);
    }
    const pageOrders = await readNaverPayOrdersOnPage(client);
    if (!pageOrders.length) break;

    for (const order of pageOrders) {
      const dateKey = naverPayListDateKey(order.dateText, { orderNo: order.orderNo });
      if (!order.orderNo || !dateKey) continue;
      if (!collected.has(order.orderNo)) {
        collected.set(order.orderNo, { ...order, dateKey });
      }
    }

    // 목록은 최신순이므로, 찾는 날짜보다 오래된 주문까지 왔으면 더 볼 필요가 없습니다.
    const oldestWanted = [...wantedDateKeys].sort()[0];
    const oldestOnPage = pageOrders
      .map((order) => naverPayListDateKey(order.dateText, { orderNo: order.orderNo }))
      .filter(Boolean)
      .sort()[0];
    if (oldestWanted && oldestOnPage && oldestOnPage < oldestWanted) break;
  }
  return [...collected.values()];
}

async function readNaverPayOrdersOnPage(client) {
  const result = await evaluate(client, `
    (() => {
      const items = [...document.querySelectorAll('li')].filter((li) => (li.innerText || '').includes('결제일시'));
      return items.map((li) => {
        const detail = [...li.querySelectorAll('a')].find((el) => (el.textContent || '').trim() === '주문 상세 보기');
        const href = detail ? detail.getAttribute('href') || '' : '';
        const orderNo = (href.match(/order\\/status\\/(\\d+)/) || [])[1] || '';
        const text = (li.innerText || '').replace(/\\n+/g, ' ');
        const dateText = (text.match(/(\\d{1,2})\\s*\\.\\s*(\\d{1,2})\\s*\\.\\s*(\\d{1,2}):(\\d{2})/) || [])[0] || '';
        const amountText = (text.match(/([\\d,]+)\\s*원/) || [])[0] || '';
        const title = (li.innerText || '').split('\\n').map((line) => line.trim())
          .filter((line) => line && !['자세히 보기', '주문 상세 보기', '더보기', '결제일시'].includes(line))
          .find((line) => !/^[\\d,]+원$/.test(line) && !/결제완료|구매확정완료|취소|반품|^총$|^\\d+$|^건$/.test(line)) || '';
        return { orderNo, dateText, amountText, title };
      }).filter((order) => order.orderNo);
    })()
  `, true);
  return result?.result?.result?.value || [];
}

// 영수증마다 새 탭을 열어 캡처합니다. (같은 탭에서 반복 캡처하면 응답이 멈추는 문제가 있었습니다)
async function captureNaverPayReceipt(endpoint, order, requestedDateKey) {
  const receiptUrl = naverPayReceiptUrl(order.orderNo);
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(receiptUrl)}`, { method: "PUT" });
  if (!response.ok) throw new Error("영수증 창을 열지 못했습니다.");
  const receiptTab = await response.json();
  const receiptClient = await CdpClient.connect(receiptTab.webSocketDebuggerUrl, receiptTab.id);

  try {
    await receiptClient.call("Page.enable");
    const loaded = await waitUntil(async () => {
      const check = await evaluate(receiptClient, `(document.body?.innerText || '').includes('주문번호')`, true).catch(() => null);
      return Boolean(check?.result?.result?.value);
    }, 30000);
    if (!loaded) throw new Error("영수증 화면을 읽지 못했습니다.");

    const textResult = await evaluate(receiptClient, `document.body.innerText`, true);
    const receiptText = textResult?.result?.result?.value || "";
    const parsed = parseNaverPayReceiptText(receiptText);
    const dateKey = order.dateKey || parsed.dateKey || requestedDateKey;
    const amountWon = parseWonText(order.amountText) || parsed.amountWon;
    const items = parsed.items.length ? parsed.items : [order.title].filter(Boolean);
    const classification = classifyCoupangReceipt(items);
    const clip = await getNaverPayReceiptClip(receiptClient);
    const screenshot = await receiptClient.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip
    });

    return {
      dateKey,
      requestedDateKey,
      orderId: order.orderNo,
      amountWon,
      items,
      category: classification.category,
      categoryLabel: classification.label,
      reasons: classification.reasons,
      fileName: `${receiptFileBaseName({ dateKey, amountWon, site: "네이버" })}.png`,
      imageBase64: screenshot.result.data,
      summaryText: parsed.rawText.slice(0, 2000)
    };
  } finally {
    await receiptClient.close();
    await fetch(`${endpoint}/json/close/${receiptTab.id}`).catch(() => {});
  }
}

// 하단 안내문과 좌우 여백을 제외하고 영수증 내용만 잘라냅니다.
async function getNaverPayReceiptClip(client) {
  const result = await evaluate(client, `
    (() => {
      const all = [...document.querySelectorAll('*')];
      const leaf = (el) => el.children.length === 0 && (el.textContent || '').trim();
      const guide = all.find((el) => leaf(el) === '현금영수증 안내');
      const lastLine = all.find((el) => el.children.length === 0 && (el.textContent || '').includes('신용카드 매출전표는'));
      let bottom = document.documentElement.scrollHeight;
      if (guide) bottom = Math.round(guide.getBoundingClientRect().top + window.scrollY) - 12;
      else if (lastLine) bottom = Math.round(lastLine.getBoundingClientRect().bottom + window.scrollY) + 16;

      let minLeft = Infinity, maxRight = -Infinity, minTop = Infinity;
      for (const el of all) {
        if (!leaf(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        const top = rect.top + window.scrollY;
        if (top >= bottom) continue;
        minLeft = Math.min(minLeft, rect.left + window.scrollX);
        maxRight = Math.max(maxRight, rect.right + window.scrollX);
        minTop = Math.min(minTop, top);
      }
      if (!Number.isFinite(minLeft)) return null;
      const pad = 16;
      const x = Math.max(0, Math.floor(minLeft - pad));
      const y = Math.max(0, Math.floor(minTop - pad));
      return {
        x, y,
        width: Math.min(document.documentElement.scrollWidth - x, Math.ceil(maxRight - minLeft + pad * 2)),
        height: Math.max(300, Math.ceil(bottom - y)),
        scale: 1
      };
    })()
  `, true);
  return result?.result?.result?.value || { x: 0, y: 0, width: 760, height: 1200, scale: 1 };
}

function parseWonText(value) {
  return Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
}

export async function captureHipassTollReceipt(dateKey, options = {}) {
  const endpoint = await ensureChrome(options);
  const tab = await acquireAutomationTab(endpoint, "hipass", false);
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, tab.id);

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await navigate(client, HIPASS_LOGIN_URL);
    await bringPageToFront(client);
    await closeHipassPagePopups(client);
    await openHipassUsagePage(client);
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
      return await captureHipassReceiptResult(receiptClient, dateKey, bodyText);
    } finally {
      if (popupTarget) {
        await receiptClient.close();
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${popupTarget.id}`).catch(() => {});
      }
    }
  } finally {
    await client.close();
    await releaseAutomationTab(tab, "hipass", false);
  }
}

export async function captureHipassTollReceipts(dateKeys = [], options = {}) {
  const uniqueDateKeys = [...new Set(dateKeys.map((dateKey) => String(dateKey || "").trim()).filter(Boolean))].sort();
  if (!uniqueDateKeys.length) return { results: [] };

  const endpoint = await ensureChrome(options);
  const tab = await acquireAutomationTab(endpoint, "hipass", false);
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, tab.id);

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await navigate(client, HIPASS_LOGIN_URL);
    await bringPageToFront(client);
    await closeHipassPagePopups(client);
    await openHipassUsagePage(client);
    await waitForHipassLogin(client);
    await openHipassUsagePage(client);

    await queryHipassUsageRange(client, uniqueDateKeys[0], uniqueDateKeys.at(-1), { openReceipt: false });
    const usageTargets = await readHipassUsageTargets(client, uniqueDateKeys, { excludeFromHour: 21 });
    const results = [];

    for (const dateKey of uniqueDateKeys) {
      const targets = usageTargets.filter((target) =>
        target.dateKey === dateKey && !target.excluded && Number(target.amountWon) > 0
      );
      if (!targets.length) {
        const excludedCount = usageTargets.filter((target) => target.dateKey === dateKey && target.excluded).length;
        results.push({
          dateKey,
          fileName: `toll-${dateKey}.png`,
          amountWon: 0,
          count: 0,
          excludedCount,
          noToll: true,
          summaryText: excludedCount ? "21시 이후 통행료는 제외되었습니다." : ""
        });
        continue;
      }

      const popupTarget = await printSelectedHipassUsageRows(client, targets);
      if (!popupTarget) {
        results.push({
          dateKey,
          fileName: `toll-${dateKey}.png`,
          amountWon: 0,
          count: 0,
          noToll: true,
          summaryText: "선택된 통행료 영수증 출력 팝업을 찾지 못했습니다."
        });
        continue;
      }

      const receiptClient = await CdpClient.connect(popupTarget.webSocketDebuggerUrl, popupTarget.id);
      try {
        await receiptClient.call("Page.enable");
        await receiptClient.call("Runtime.enable");
        await delay(1000);
        const textResult = await evaluate(receiptClient, "document.body.innerText", true);
        const bodyText = String(textResult.result.result.value || "");
        results.push(await captureHipassReceiptResult(receiptClient, dateKey, bodyText));
      } finally {
        await receiptClient.close();
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${popupTarget.id}`).catch(() => {});
        await delay(500);
      }
    }

    return { results };
  } finally {
    await client.close();
    await releaseAutomationTab(tab, "hipass", false);
  }
}

async function captureHipassReceiptResult(receiptClient, dateKey, bodyText) {
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
    if (receiptData.excludedCount > 0 || bodyText.includes(dateKey.replace(/-/g, "년").slice(0, 5))) {
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
    return {
      dateKey,
      fileName: `toll-${dateKey}.png`,
      amountWon: 0,
      count: 0,
      noToll: true,
      summaryText: bodyText.slice(0, 2000)
    };
  }

  await filterHipassReceiptPage(receiptClient, dateKey, { excludeFromHour: 21 });
  const clip = await getHipassReceiptClip(receiptClient);
  const screenshot = await receiptClient.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    clip: { ...clip, scale: 2 }
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
}

// 캡처가 끝나면 자동화용 Chrome 창을 함께 닫습니다.
export async function closeAutomationBrowser() {
  reusableTabIds.clear();
  oilCaptureCache.clear();
  const endpoint = `http://127.0.0.1:${DEBUG_PORT}`;
  const version = await fetch(`${endpoint}/json/version`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if (!version?.webSocketDebuggerUrl) {
    return { closed: false, reason: "not-running" };
  }
  try {
    const browserClient = await CdpClient.connect(version.webSocketDebuggerUrl, "browser");
    try {
      // 브라우저가 닫히면 응답이 오지 않을 수 있으므로 짧게 기다린 뒤 넘어갑니다.
      await Promise.race([
        browserClient.call("Browser.close", {}).catch(() => {}),
        delay(1500)
      ]);
    } finally {
      try { browserClient.close(); } catch {}
    }
    // 종료에는 잠깐 시간이 걸리므로 실제로 내려갔는지 잠시 확인합니다.
    const closed = await waitUntil(async () => !(await canReachChrome(endpoint)), 5000);
    return { closed: Boolean(closed) };
  } catch (error) {
    return { closed: false, reason: error.message };
  }
}

export async function resetAutomationState() {
  const targetIds = [...new Set(reusableTabIds.values())];
  reusableTabIds.clear();
  oilCaptureCache.clear();
  await Promise.all(targetIds.map((targetId) =>
    fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${targetId}`).catch(() => {})
  ));
  return { closedTabs: targetIds.length };
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
  let initialState = await readHipassLoginState(client);
  if (!initialState.hasLoginForm && !initialState.hasLoginPage && !initialState.hasLoginButton) {
    await closeHipassPagePopups(client);
    initialState = await readHipassLoginState(client);
  }
  if (initialState.loggedIn) {
    return;
  }
  await bringPageToFront(client);
  const loggedIn = await waitUntil(async () => (await readHipassLoginState(client)).loggedIn, HIPASS_LOGIN_WAIT_MS);
  if (!loggedIn) {
    throw new Error("통행료 홈페이지 로그인이 확인되지 않았습니다. 3분 안에 로그인되지 않아 중단했습니다. 로그인 후 다시 시도해 주세요.");
  }
  await closeHipassPagePopups(client);
}

async function openHipassUsagePage(client) {
  const loginState = await readHipassLoginState(client);
  if (loginState.hasLoginForm || loginState.hasLoginPage) {
    await bringPageToFront(client);
    return;
  }
  await closeHipassPagePopups(client);
  const hrefResult = await evaluate(client, "location.href", true).catch(() => null);
  const href = String(hrefResult?.result?.result?.value || "");
  if (!href.includes("/usepculr/InitUsePculrTabSearch.do")) {
    const clicked = await clickHipassUsageLookupFromMain(client).catch(() => false);
    if (clicked) {
      await waitFor(
        client,
        `(() => {
          const visible = (element) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          };
          const loginControl = document.querySelector('input[type=password], #per_user_id, #per_user_pw');
          const loginButton = [...document.querySelectorAll('a,button,input[type=button],input[type=submit],[role=button]')]
            .some((element) => {
              if (!visible(element)) return false;
              const text = (element.innerText || element.value || element.title || element.getAttribute('aria-label') || '').replace(/\\s+/g, '');
              return /로그인|개인로그인|법인로그인|login/i.test(text);
            });
          return location.href.includes('/usepculr/InitUsePculrTabSearch.do') ||
            location.href.toLowerCase().includes('login') ||
            document.querySelector('#sDate, #eDate, #sDate_view, #eDate_view, #lookupBtn') ||
            loginControl ||
            loginButton ||
            typeof window.fn_search_usepculr === 'function';
        })()`,
        20000,
        "하이패스 사용내역 조회 화면"
      );
      const clickedState = await readHipassLoginState(client);
      if (clickedState.hasLoginForm || clickedState.hasLoginPage || clickedState.hasLoginButton) {
        await bringPageToFront(client);
        return;
      }
    } else {
      await navigate(client, HIPASS_USAGE_URL);
      await bringPageToFront(client);
      await waitForHipassLogin(client);
    }
  }
  const nextLoginState = await readHipassLoginState(client);
  if (nextLoginState.hasLoginForm || nextLoginState.hasLoginPage || nextLoginState.hasLoginButton) {
    await bringPageToFront(client);
    return;
  }
  await closeHipassPagePopups(client);
  if (!(await isHipassUsageSearchPage(client))) {
    await navigate(client, HIPASS_USAGE_URL);
    await bringPageToFront(client);
    await waitForHipassLogin(client);
  }
  await ensureHipassUsagePageReady(client);
}

async function closeHipassPagePopups(client) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await evaluate(client, `
      (() => {
        const visible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        };
        const normalize = (value) => String(value || '').replace(/\\s+/g, '').toLowerCase();
        const closeWords = ['닫기', '확인', '오늘하루보지않기', '오늘하루열지않음', '창닫기', 'close'];
        const hasLoginControl = (element) => Boolean(element?.querySelector?.('input[type=password], #per_user_id, #per_user_pw, input[name=per_user_id], input[name=user_id]'));
        const candidates = [...document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button],.btn_close,.close')]
          .map((element) => ({
            element,
            text: normalize(element.innerText || element.value || element.title || element.getAttribute('aria-label') || element.className || ''),
            rect: element.getBoundingClientRect()
          }))
          .filter((item) => visible(item.element) && closeWords.some((word) => item.text.includes(normalize(word))))
          .sort((left, right) => right.rect.y - left.rect.y || right.rect.x - left.rect.x);
        const hit = candidates[0];
        if (hit) {
          hit.element.click();
          return true;
        }
        const overlays = [...document.querySelectorAll('[class*=popup], [id*=popup], [class*=layer], [id*=layer], .modal')]
          .filter((element) => visible(element) && !hasLoginControl(element));
        for (const overlay of overlays) {
          overlay.style.display = 'none';
          overlay.setAttribute('aria-hidden', 'true');
        }
        return overlays.length > 0;
      })()
    `, true).catch(() => null);
    if (!result?.result?.result?.value) return;
    await delay(400);
  }
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
      const candidates = [...document.querySelectorAll('a,button,input[type=button],input[type=submit],[role=button],[onclick]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.value || element.title || element.getAttribute('aria-label') || element.alt || '').trim().replace(/\\s+/g, ' ');
          const href = element.href || element.getAttribute('href') || '';
          const onclick = element.getAttribute('onclick') || '';
          const parentText = (element.closest('a,button,li,div')?.innerText || '').trim().replace(/\\s+/g, ' ');
          return { element, rect, text, compact: normalize(text + ' ' + parentText), href, onclick };
        })
        .filter((item) =>
          visible(item.element) &&
          (
            labels.some((label) => item.compact.includes(label)) ||
            item.href.includes('/usepculr/InitUsePculrTabSearch.do') ||
            item.href.includes('/usepculr/InitUsePculrCalSearch.do') ||
            item.onclick.includes('InitUsePculrTabSearch') ||
            item.onclick.includes('InitUsePculrCalSearch') ||
            item.onclick.includes('usepculr')
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

async function isHipassUsageSearchPage(client) {
  const result = await evaluate(client, `
    (() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const hasKnownDateInput = ['sDate', 'eDate', 'sDate_view', 'eDate_view']
        .some((id) => visible(document.getElementById(id)));
      const hasLookupButton = visible(document.querySelector('#lookupBtn, #lookupBtn a'));
      const hasSearchFunction = typeof window.fn_search_usepculr === 'function';
      const hasVisibleDateInput = [...document.querySelectorAll('input')].some((input) => {
        if (!visible(input)) return false;
        const type = String(input.type || '').toLowerCase();
        if (['hidden', 'button', 'submit', 'checkbox', 'radio'].includes(type)) return false;
        const name = [input.name, input.id, input.title, input.placeholder, input.getAttribute('aria-label')]
          .filter(Boolean)
          .join(' ');
        return /date|dt|일자|날짜|기간|시작|종료|from|to/i.test(name);
      });
      return Boolean(hasKnownDateInput || hasLookupButton || hasSearchFunction || hasVisibleDateInput);
    })()
  `, true).catch(() => null);
  return Boolean(result?.result?.result?.value);
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

async function queryHipassUsageRange(client, startDateKey, endDateKey, options = {}) {
  await ensureHipassUsagePageReady(client);
  if (await isHipassReceiptPrintPage(client)) {
    return null;
  }
  const tableViewClicked = await clickHipassText(
    client,
    ["표로 보기", "표로보기", "탭 보기", "표보기"],
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
  await setHipassDateRangeInputs(client, startDateKey, endDateKey);
  const clicked = await submitHipassUsageSearch(client) ||
    await clickHipassText(client, ["조회", "검색"], { minY: 450, preferBottom: true });
  if (!clicked) {
    throw new Error("하이패스 사용내역 조회 버튼을 찾지 못했습니다.");
  }
  await delay(1800);
  if (options.openReceipt === false) {
    return null;
  }
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

async function readHipassUsageTargets(client, dateKeys = [], options = {}) {
  const excludeFromHour = Number.isFinite(Number(options.excludeFromHour))
    ? Number(options.excludeFromHour)
    : 21;
  const result = await evaluate(client, `
    (() => {
      const dateKeys = new Set(${JSON.stringify(dateKeys)});
      const excludeFromHour = ${JSON.stringify(excludeFromHour)};
      const normalizeDate = (year, month, day) =>
        [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
      const parseDate = (text) => {
        const value = String(text || '');
        const full = value.match(/(20\\d{2})\\D+(\\d{1,2})\\D+(\\d{1,2})/);
        if (full) return normalizeDate(full[1], full[2], full[3]);
        const short = value.match(/(?:^|\\D)(\\d{2})[.\\/-](\\d{1,2})[.\\/-](\\d{1,2})(?:\\D|$)/);
        if (short) return normalizeDate('20' + short[1], short[2], short[3]);
        return '';
      };
      const parseHour = (text) => {
        const match = String(text || '').match(/(?:^|\\D)(\\d{1,2})\\s*[:시]\\s*(\\d{1,2})?/);
        return match ? Number(match[1]) : -1;
      };
      const parseAmount = (text) => {
        const amounts = [...String(text || '').matchAll(/(\\d{1,3}(?:,\\d{3})+|\\d{4,})\\s*원?/g)]
          .map((match) => Number(String(match[1]).replace(/[^0-9]/g, '')))
          .filter((value) => value > 0);
        return amounts.length ? amounts[amounts.length - 1] : 0;
      };
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const documents = [{ doc: document, frameIndex: 0 }];
      [...document.querySelectorAll('iframe')].forEach((frame, index) => {
        try {
          if (frame.contentDocument) documents.push({ doc: frame.contentDocument, frameIndex: index + 1 });
        } catch (_) {}
      });
      const rows = documents.flatMap(({ doc, frameIndex }) =>
        [...doc.querySelectorAll('tr')]
          .filter((row) => visible(row) && row.querySelector('input[type=checkbox], input[type=radio]'))
          .map((row) => ({ row, frameIndex }))
      );
      const targets = [];
      rows.forEach(({ row, frameIndex }, index) => {
        const text = (row.innerText || row.textContent || '').replace(/\\s+/g, ' ').trim();
        const dateKey = parseDate(text);
        if (!dateKey || !dateKeys.has(dateKey)) return;
        const hour = parseHour(text);
        const amountWon = parseAmount(text);
        const input = row.querySelector('input[type=checkbox], input[type=radio]');
        const targetId = 'travel-proof-hipass-row-' + index;
        row.dataset.travelProofHipassRow = targetId;
        input.dataset.travelProofHipassRowInput = targetId;
        targets.push({
          id: targetId,
          frameIndex,
          dateKey,
          hour,
          amountWon,
          excluded: hour >= excludeFromHour,
          text
        });
      });
      return targets;
    })()
  `, true);
  return result.result.result.value || [];
}

async function printSelectedHipassUsageRows(client, targets = []) {
  if (!targets.length) return null;
  const targetsBeforeReceipt = await listChromeTargets();
  const targetIdsBeforeReceipt = new Set(targetsBeforeReceipt.map((target) => target.id));
  const selected = await evaluate(client, `
    (() => {
      const ids = new Set(${JSON.stringify(targets.map((target) => target.id))});
      const documents = [{ doc: document }];
      [...document.querySelectorAll('iframe')].forEach((frame) => {
        try {
          if (frame.contentDocument) documents.push({ doc: frame.contentDocument });
        } catch (_) {}
      });
      const inputs = documents.flatMap(({ doc }) => [...doc.querySelectorAll('input[type=checkbox], input[type=radio]')]);
      for (const input of inputs) {
        if (input.checked) {
          input.checked = false;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      let count = 0;
      for (const input of inputs) {
        const row = input.closest('tr');
        const id = input.dataset.travelProofHipassRowInput || row?.dataset.travelProofHipassRow;
        if (!ids.has(id)) continue;
        input.scrollIntoView({ block: 'center', inline: 'center' });
        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        count += 1;
      }
      return count;
    })()
  `, true).catch(() => null);
  if (!selected?.result?.result?.value) return null;
  const receiptClicked = await submitHipassSelectedReceiptPrint(client) || await submitHipassReceiptPrint(client);
  if (!receiptClicked) return null;
  const popupTarget = await waitForHipassReceiptPopupTarget(client.targetId, targetIdsBeforeReceipt);
  await delay(1200);
  return popupTarget;
}

async function submitHipassSelectedReceiptPrint(client) {
  const result = await evaluate(client, `
    (() => {
      const callSelected = (win) => {
        if (win && typeof win.fn_print_receipt_html === 'function') {
          win.fn_print_receipt_html('0');
          return true;
        }
        return false;
      };
      const frames = [...document.querySelectorAll('iframe')];
      for (const frame of frames) {
        try {
          if (callSelected(frame.contentWindow)) return true;
        } catch (_) {}
      }
      return callSelected(window);
    })()
  `, true).catch(() => null);
  return Boolean(result?.result?.result?.value);
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
      const compactText = text.replace(/\\s+/g, '');
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
      const hasUsagePage = location.href.includes('/usepculr/InitUsePculrTabSearch.do') ||
        Boolean(document.querySelector('#sDate, #eDate, #sDate_view, #eDate_view, #lookupBtn')) ||
        typeof window.fn_search_usepculr === 'function' ||
        [...document.querySelectorAll('input')].some((input) => {
          if (!visible(input)) return false;
          const name = [input.name, input.id, input.title, input.placeholder, input.getAttribute('aria-label')]
            .filter(Boolean)
            .join(' ');
          return /date|dt|일자|날짜|기간|시작|종료|from|to/i.test(name);
        });
      const hasLoginPage = location.href.toLowerCase().includes('login') ||
        Boolean(userId || password) ||
        (hasVisibleLogin && (compactText.includes('아이디') || compactText.includes('비밀번호') || compactText.includes('본인인증') || compactText.includes('개인회원')));
      return {
        loggedIn: (hasVisibleLogout || hasUsagePage) && !password && !userId,
        hasLoginForm: Boolean(userId || password),
        hasLoginPage,
        hasLoginButton: hasVisibleLogin
      };
    })()
  `, true).catch(() => null);
  return result?.result?.result?.value || { loggedIn: false, hasLoginForm: false, hasLoginPage: false, hasLoginButton: false };
}

async function ensureHipassUsagePageReady(client) {
  await closeHipassPagePopups(client);
  const state = await readHipassLoginState(client);
  if (!state.loggedIn && (state.hasLoginForm || state.hasLoginButton)) {
    await bringPageToFront(client);
    throw new Error("로그인 필요: 열린 하이패스 창에서 직접 로그인한 뒤 캡처를 다시 실행해 주세요.");
  }

  const ready = await waitUntil(async () => {
    return isHipassUsageSearchPage(client);
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

async function setHipassDateRangeInputs(client, startDateKey, endDateKey) {
  const result = await evaluate(client, `
    (() => {
      const startDateKey = ${JSON.stringify(startDateKey)};
      const endDateKey = ${JSON.stringify(endDateKey)};
      const startCompact = startDateKey.replace(/-/g, '');
      const endCompact = endDateKey.replace(/-/g, '');
      const setValue = (input, value) => {
        if (!input) return false;
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      let count = 0;
      count += setValue(document.getElementById('sDate'), startCompact) ? 1 : 0;
      count += setValue(document.getElementById('eDate'), endCompact) ? 1 : 0;
      count += setValue(document.getElementById('sDate_view'), startDateKey) ? 1 : 0;
      count += setValue(document.getElementById('eDate_view'), endDateKey) ? 1 : 0;
      if (count < 2) {
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
          return /date|dt|일자|날짜|기간|시작|종료|from|to|month|조회년월|ym/i.test(name) ||
            /\\d{4}[-.]?\\d{2}([-./]?\\d{2})?/.test(input.value || '');
        });
        const targets = dateInputs.length >= 2 ? dateInputs.slice(0, 2) : inputs.slice(0, 2);
        const values = [startDateKey, endDateKey];
        targets.forEach((input, index) => {
          const value = input.maxLength === 8 || /^\\d{8}$/.test(input.value || '') ? values[index].replace(/-/g, '') : values[index];
          if (setValue(input, value)) count += 1;
        });
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
      return { count };
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
      document.documentElement.style.background = '#ffffff';
      document.body.style.background = '#ffffff';
      document.getElementById('travel-proof-hipass-capture-root')?.remove();
      const targetDate = ${JSON.stringify(dateKey)};
      const excludeFromHour = ${JSON.stringify(excludeFromHour)};
      [...document.querySelectorAll('[data-travel-proof-hipass-keep]')].forEach((element) => {
        element.style.display = '';
        element.style.visibility = 'visible';
        delete element.dataset.travelProofHipassKeep;
      });
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
      const receiptElements = [...document.querySelectorAll('td, table')]
        .filter((element) => visible(element) && isReceiptText(element.innerText));
      const matchingTables = receiptElements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { table: element, rect, issuedAt: receiptTime(element.innerText || '') };
        })
        .filter((item) => item.issuedAt)
        .sort((left, right) =>
          (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height)
        );
      const containers = [];
      for (const item of matchingTables) {
        if (!containers.some((table) => item.table.contains(table) || table.contains(item.table))) {
          containers.push(item.table);
        }
      }
      let kept = 0;
      let hidden = 0;
      const keptTables = [];
      for (const table of containers) {
        const text = table.innerText || '';
        const issuedAt = receiptTime(text);
        const keep = issuedAt && issuedAt.dateKey === targetDate && issuedAt.hour < excludeFromHour;
        if (keep) {
          kept += 1;
          keptTables.push(table);
          table.dataset.travelProofHipassKeep = '1';
          table.style.display = '';
          table.style.visibility = 'visible';
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
      const keptElements = [...document.querySelectorAll('[data-travel-proof-hipass-keep="1"]')];
      const bodyRect = document.body.getBoundingClientRect();
      const candidates = [...document.querySelectorAll('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || '').replace(/\\s+/g, ' ');
          return { element, rect, text };
        })
        .filter((item) =>
          item.rect.width > 80 &&
          item.rect.height > 80 &&
          getComputedStyle(item.element).display !== 'none' &&
          getComputedStyle(item.element).visibility !== 'hidden' &&
          item.element.dataset.travelProofHipassKeep === '1'
        )
        .sort((left, right) => (left.rect.top - right.rect.top) || (left.rect.left - right.rect.left));
      const rect = candidates.length
        ? candidates.reduce((merged, item) => ({
            left: Math.min(merged.left, item.rect.left),
            top: Math.min(merged.top, item.rect.top),
            right: Math.max(merged.right, item.rect.right),
            bottom: Math.max(merged.bottom, item.rect.bottom)
          }), {
            left: candidates[0].rect.left,
            top: candidates[0].rect.top,
            right: candidates[0].rect.right,
            bottom: candidates[0].rect.bottom
          })
        : bodyRect;
      const paddingX = 12;
      const paddingTop = 56;
      const paddingBottom = 20;
      const x = Math.max(0, Math.floor(rect.left - paddingX));
      const y = Math.max(0, Math.floor(rect.top - paddingTop));
      const right = Math.min(document.documentElement.scrollWidth, Math.ceil(rect.right + paddingX));
      const bottom = Math.min(document.documentElement.scrollHeight, Math.ceil(rect.bottom + paddingBottom));
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
    windowsHide: false
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
      const values = { jsonTexts: [], html: document.documentElement.outerHTML || '' };
      const nextData = document.getElementById('__NEXT_DATA__')?.textContent || '';
      if (nextData) values.jsonTexts.push(nextData);
      for (const script of document.querySelectorAll('script[type="application/json"], script:not([src])')) {
        const text = (script.textContent || '').trim();
        if (text && (text.includes('orderId') || text.includes('orderedAt'))) {
          values.jsonTexts.push(text);
        }
      }
      values.jsonTexts = [...new Set(values.jsonTexts)].slice(0, 20);
      return values;
    })()
  `, true).catch(() => null);
  const payload = result?.result?.result?.value || {};
  return [
    ...extractCoupangOrdersFromJsonTexts(payload.jsonTexts || []),
    ...extractCoupangOrdersFromHtml(payload.html || "")
  ];
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
  await delay(1200);
  if (orderId) {
    return true;
  }
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
