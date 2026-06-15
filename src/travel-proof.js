const REQUIRED_HEADERS = ["POS명", "POS주소", "날짜", "시간"];
const TIME_ORDER = { 오전: 0, 오후: 1 };

export function parseTravelProofTable(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error("열 제목과 데이터 행을 함께 붙여넣어 주세요.");
  }

  const headers = splitRow(lines[0]).map(normalizeHeader);
  const headerIndexes = Object.fromEntries(headers.map((header, index) => [header, index]));
  const missing = REQUIRED_HEADERS.filter((header) => headerIndexes[header] === undefined);
  if (missing.length) {
    throw new Error(`필수 열이 없습니다: ${missing.join(", ")}`);
  }

  return lines.slice(1).map((line, offset) => {
    const cells = splitRow(line);
    const value = (header) => (cells[headerIndexes[header]] || "").trim();

    return {
      sourceRowNumber: offset + 2,
      dealerName: value("대리점명"),
      posCode: value("POS코드"),
      posName: value("POS명"),
      typeSummary: value("유형요약"),
      posAddress: value("POS주소"),
      dateLabel: value("날짜"),
      timeOfDay: normalizeTime(value("시간"))
    };
  });
}

export function buildMonthlyProofGroups(rows, options) {
  const year = Number(options.year);
  const month = Number(options.month);
  const start = String(options.start || "").trim();
  const destination = String(options.destination || "").trim();
  const byDate = new Map();
  const errors = [];

  for (const row of rows) {
    const dateKey = parseDateKey(row.dateLabel, year, month);
    if (!dateKey) {
      errors.push({
        dateKey: "",
        row,
        message: `날짜를 읽을 수 없습니다: ${row.dateLabel}`
      });
      continue;
    }

    if (!["오전", "오후"].includes(row.timeOfDay)) {
      errors.push({
        dateKey,
        row,
        message: `시간은 오전 또는 오후여야 합니다: ${row.timeOfDay || row.timeLabel || ""}`
      });
      continue;
    }

    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey).push(row);
  }

  const valid = [];
  for (const [dateKey, dateRows] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const duplicateTime = findDuplicateTime(dateRows);
    if (duplicateTime) {
      errors.push({
        dateKey,
        rows: dateRows,
        message: `${dateKey}에 ${duplicateTime} 장소가 2개 이상 있습니다.`
      });
      continue;
    }

    const waypoints = dateRows
      .slice()
      .sort((left, right) => TIME_ORDER[left.timeOfDay] - TIME_ORDER[right.timeOfDay])
      .map((row) => ({
        ...row,
        searchName: buildPosSearchName(row.posName),
        fallbackAddress: row.posAddress
      }));

    valid.push({
      dateKey,
      monthKey: dateKey.slice(0, 7),
      fileBaseName: dateKey,
      start,
      destination,
      sourceRows: dateRows.slice(),
      waypoints
    });
  }

  return { valid, errors };
}

export function buildPosSearchName(posName) {
  const normalized = String(posName || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.startsWith("유플러스") ? normalized : `유플러스 ${normalized}`;
}

export function createManualProofGroup({ dateKey, start, destination, waypointNames }) {
  const names = (Array.isArray(waypointNames) ? waypointNames : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!dateKey || !names.length) {
    throw new Error("수동 경유지 날짜와 경유지 1개 이상이 필요합니다.");
  }

  const label = names.join(" ");
  const waypoints = names.map((name, index) => ({
    timeOfDay: index === 0 ? "수동1" : "수동2",
    dealerName: name,
    posName: name,
    posAddress: "",
    searchName: name,
    fallbackAddress: name,
    manual: true
  }));

  return {
    dateKey,
    monthKey: dateKey.slice(0, 7),
    fileBaseName: sanitizeFilePart(`${dateKey}-manual-${label}`),
    start: String(start || "").trim(),
    destination: String(destination || "").trim(),
    manual: true,
    sourceRows: names.map((name) => ({ dealerName: name, manual: true })),
    waypoints
  };
}

export function createCaptureJobs(groups, rootDirectory) {
  const normalizedRoot = String(rootDirectory || "").trim().replace(/[\\/]+$/, "");
  if (!normalizedRoot) {
    throw new Error("저장 폴더를 선택해 주세요.");
  }

  return groups.map((group) => {
    const outputFileName = `${sanitizeFilePart(group.fileBaseName)}.png`;
    const outputDirectory = `${normalizedRoot}\\${group.monthKey}`;

    return {
      id: group.dateKey,
      dateKey: group.dateKey,
      outputDirectory,
      outputFileName,
      route: {
        start: group.start,
        destination: group.destination,
        waypoints: group.waypoints.map((waypoint) => ({
          timeOfDay: waypoint.timeOfDay,
          posName: waypoint.posName,
          posAddress: waypoint.posAddress,
          searchName: waypoint.searchName,
          fallbackAddress: waypoint.fallbackAddress,
          dealerName: waypoint.dealerName,
          posCode: waypoint.posCode
        }))
      }
    };
  });
}

export function canRunCapture({ groupCount, running }) {
  return Number(groupCount) > 0 && !running;
}

export function canRetryFailedCapture({ failedCount, running }) {
  return Number(failedCount) > 0 && !running;
}

export function rememberFailedCapture(failedJobs, group, message) {
  const key = proofGroupKey(group);
  const nextJobs = Array.isArray(failedJobs)
    ? failedJobs.filter((entry) => entry.key !== key)
    : [];

  nextJobs.push({
    key,
    dateKey: group.dateKey,
    group,
    message: String(message || "")
  });

  return nextJobs;
}

export function removeFailedCapture(failedJobs, dateKey) {
  const key = proofGroupKey(dateKey);
  return Array.isArray(failedJobs)
    ? failedJobs.filter((entry) => entry.key !== key)
    : [];
}

export function extractRouteDistanceKm(summaryText) {
  const text = String(summaryText || "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*km/i);
  return match ? Number(match[1]) : 0;
}

export function parseFuelPriceWon(value) {
  const normalized = String(value || "").replace(/,/g, "").trim();
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

export function calculateFuelExpenseAmount(distanceKm, fuelPriceWon) {
  return Math.round((Number(distanceKm) / 8) * Number(fuelPriceWon));
}

export function buildFuelExpensePasteRows(entries) {
  return entries.map((entry) => {
    const distanceKm = Number(entry.distanceKm);
    const fuelPriceWon = Number(entry.fuelPriceWon);
    const amount = calculateFuelExpenseAmount(distanceKm, fuelPriceWon);
    const distanceText = formatDistanceForFormula(distanceKm);
    const note = `${distanceText}/8*${fuelPriceWon}`;
    const summary = dealerSummary(entry.group);
    const cells = [
      entry.group.dateKey,
      "유류대",
      "",
      formatWon(amount),
      summary,
      note
    ];

    return {
      key: proofGroupKey(entry.group),
      dateKey: entry.group.dateKey,
      amount,
      note,
      summary,
      text: cells.join("\t")
    };
  });
}

export function sanitizeFilePart(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function splitRow(line) {
  return String(line).split("\t");
}

function normalizeHeader(header) {
  return String(header || "").replace(/\s+/g, "").trim();
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (/오전|AM/i.test(text)) return "오전";
  if (/오후|PM/i.test(text)) return "오후";
  return text;
}

function parseDateKey(label, year) {
  const text = String(label || "").trim();
  const explicitYearMatch = text.match(/(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
  const monthDayMatch =
    explicitYearMatch ||
    text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/) ||
    text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);

  if (!monthDayMatch || !Number.isInteger(year)) {
    return "";
  }

  const resolvedYear = explicitYearMatch ? Number(explicitYearMatch[1]) : year;
  const month = Number(explicitYearMatch ? explicitYearMatch[2] : monthDayMatch[1]);
  const day = Number(explicitYearMatch ? explicitYearMatch[3] : monthDayMatch[2]);

  return `${resolvedYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function findDuplicateTime(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.timeOfDay)) {
      return row.timeOfDay;
    }
    seen.add(row.timeOfDay);
  }
  return "";
}

function dealerSummary(group) {
  const rows = Array.isArray(group.sourceRows) ? group.sourceRows : [];
  return rows
    .map((row) => String(row.dealerName || "").trim())
    .filter(Boolean)
    .join(" / ");
}

function proofGroupKey(groupOrDateKey) {
  if (groupOrDateKey && typeof groupOrDateKey === "object") {
    return String(groupOrDateKey.fileBaseName || groupOrDateKey.dateKey || "");
  }
  return String(groupOrDateKey || "");
}

function formatWon(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function formatDistanceForFormula(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "0";
  }
  return Number.isInteger(number) ? String(number) : String(number).replace(/\.0+$/, "");
}
