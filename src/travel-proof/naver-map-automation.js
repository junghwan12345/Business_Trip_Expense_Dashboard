import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  classifyCoupangReceipt,
  coupangOrderDateCandidates,
  parseCoupangReceiptText,
  receiptFileBaseName
} from "./coupang-proof.js";
import { extractRouteDistanceKm, parseFuelPriceWon } from "./travel-proof.js";

const DEBUG_PORT = 9222;
const COUPANG_ORDER_LIST_URL = "https://mc.coupang.com/ssr/desktop/order/list";
const COUPANG_LOGIN_WAIT_MS = 5 * 60 * 1000;
const COUPANG_ORDER_SEARCH_PAGES = 12;
const COUPANG_ORDER_SEARCH_SCROLLS = 14;
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

export async function captureNaverRoute(job, options = {}) {
  const endpoint = await ensureChrome(options);
  const tab = await createTab(endpoint);
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

    const text = await evaluate(client, "document.body.innerText", true);
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
      distanceKm: extractRouteDistanceKm(text.result.result.value),
      summaryText: String(text.result.result.value || "").slice(0, 2000)
    };
  } finally {
    await client.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.id}`).catch(() => {});
  }
}

export async function captureOilPriceProof(dateKey, options = {}) {
  const endpoint = await ensureChrome(options);
  const tab = await createTab(endpoint);
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, tab.id);
  const targetDate = String(dateKey || "").replaceAll("-", ".");

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");

    for (let page = 1; page <= 80; page += 1) {
      await navigate(client, `https://finance.naver.com/marketindex/oilDailyQuote.naver?marketindexCd=OIL_GSL&page=${page}`);
      await waitFor(client, "document.querySelector('.tbl_exchange.today tbody tr')", 15000);

      const highlighted = await highlightOilPriceRow(client, targetDate);
      if (!highlighted) {
        continue;
      }

      await delay(400);
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
        page
      };
    }

    throw new Error(`해당 날짜의 휘발유 유가를 찾을 수 없습니다: ${dateKey}`);
  } finally {
    await client.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.id}`).catch(() => {});
  }
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
    await navigate(client, COUPANG_ORDER_LIST_URL);
    await waitForCoupangOrderList(client);

    for (const dateKey of dateKeys) {
      const capturedForDate = await captureCoupangDateReceipts(client, dateKey).catch((error) => {
        failures.push({ dateKey, message: error.message });
        return [];
      });
      results.push(...capturedForDate);
      await navigate(client, COUPANG_ORDER_LIST_URL);
      await waitForCoupangOrderList(client);
    }

    return { results, failures };
  } finally {
    await client.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.id}`).catch(() => {});
  }
}

async function captureCoupangDateReceipts(client, dateKey) {
  const candidates = coupangOrderDateCandidates(dateKey);
  const orderCount = await countCoupangOrdersForDateWithScroll(client, candidates);
  if (!orderCount) {
    throw new Error("해당 날짜 주문을 찾지 못했습니다.");
  }

  const captures = [];
  for (let index = 0; index < orderCount; index += 1) {
    const opened = await clickCoupangOrderDetailForDate(client, candidates, index);
    if (!opened) {
      throw new Error("주문 상세보기 버튼을 찾지 못했습니다.");
    }

    const receiptButton = await waitUntil(async () => clickCoupangReceiptButton(client), 15000);
    if (!receiptButton) {
      throw new Error("거래명세서 버튼을 찾지 못했습니다.");
    }
    await delay(2500);

    const targets = await listChromeTargets();
    const popupTarget = targets.find((target) =>
      target.type === "page" &&
      target.webSocketDebuggerUrl &&
      target.id !== client.targetId &&
      /coupang|receipt|order|about:blank/i.test(`${target.url} ${target.title}`)
    );
    const receiptClient = popupTarget
      ? await CdpClient.connect(popupTarget.webSocketDebuggerUrl, popupTarget.id)
      : client;

    try {
      await receiptClient.call("Page.enable");
      await receiptClient.call("Runtime.enable");
      await waitFor(receiptClient, "document.body.innerText.includes('거래명세표')", 15000);
      await delay(800);
      const textResult = await evaluate(receiptClient, "document.body.innerText", true);
      const receipt = parseCoupangReceiptText(textResult.result.result.value);
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

async function ensureChrome(options) {
  const endpoint = `http://127.0.0.1:${DEBUG_PORT}`;
  if (await canReachChrome(endpoint)) {
    return endpoint;
  }

  const chromePath = options.chromePath || CHROME_PATHS.find((candidate) => existsSync(candidate));
  if (!chromePath) {
    throw new Error("Chrome or Edge executable was not found.");
  }
  const profileDir = resolve(options.profileDir || join(process.cwd(), "chrome-travel-proof-profile"));
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

async function listChromeTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  if (!response.ok) {
    return [];
  }
  return response.json();
}

async function navigate(client, url) {
  await client.call("Page.navigate", { url });
  await delay(7000);
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
      await click(client, hit.x + hit.w / 2, hit.y + hit.h / 2);
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
      const headerHit = uniqueHeaderHits[orderIndex] || uniqueHeaderHits[0];
      if (headerHit) {
        headerHit.link.element.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = headerHit.link.element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      }

      const blocks = visibleItems
        .filter((item) =>
          item.rect.width > 250 &&
          item.rect.height > 40 &&
          matchesDate(item.text) &&
          item.text.includes('주문 상세보기')
        )
        .sort((left, right) => (left.rect.y - right.rect.y) || (left.rect.x - right.rect.x));
      const block = blocks[orderIndex] || blocks[0];
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
      const rect = hit.element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    })()
  `, true);
  return result.result.result.value || null;
}

async function clickCoupangReceiptButton(client) {
  const result = await evaluate(client, `
    (() => {
      const hit = [...document.querySelectorAll('a,button,[role=button],input[type=button],input[type=submit]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.value || element.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
          return { element, rect, text };
        })
        .find((item) => item.rect.width > 0 && item.rect.height > 0 && item.text.includes('거래명세서'));
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

async function getCoupangReceiptClip(client) {
  const result = await evaluate(client, `
    (() => {
      const bodyRect = document.body.getBoundingClientRect();
      const title = [...document.querySelectorAll('body *')]
        .find((element) => (element.innerText || '').trim().includes('거래명세표'));
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

async function highlightOilPriceRow(client, targetDate) {
  const result = await evaluate(client, `
    (() => {
      const targetDate = ${JSON.stringify(targetDate)};
      const rows = [...document.querySelectorAll('.tbl_exchange.today tbody tr')];
      const row = rows.find((candidate) => {
        const dateCell = candidate.querySelector('td.date');
        const dateText = (dateCell?.innerText || '').trim().replace(/\\s+/g, '');
        return dateText === targetDate;
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

async function waitFor(client, expression, timeoutMs) {
  const ok = await waitUntil(async () => {
    const result = await evaluate(client, `Boolean(${expression})`, true).catch(() => null);
    return Boolean(result?.result?.result?.value);
  }, timeoutMs);
  if (!ok) {
    throw new Error("Timed out waiting for Naver Map.");
  }
}

async function evaluate(client, expression, returnByValue = false) {
  return client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue
  });
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

  close() {
    this.socket.close();
  }
}
