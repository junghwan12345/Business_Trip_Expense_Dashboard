const REQUIRED_HEADERS = ["POS명", "POS주소", "날짜", "시간"];
const HEADER_ALIASES = {
  대리점명: ["대리점명", "대리점", "대리점명칭"],
  POS코드: ["POS코드", "POS 코드", "POS_CODE", "POS No", "POSNO", "코드", "매장코드", "점포코드"],
  POS명: ["POS명", "POS 명", "POS명칭", "POS", "매장명", "점포명", "가맹점명", "상호", "상호명", "방문처", "방문지"],
  유형요약: ["유형요약", "유형 요약", "유형", "구분"],
  POS주소: ["POS주소", "POS 주소", "주소", "매장주소", "점포주소", "방문주소", "주소지", "소재지"],
  날짜: ["날짜", "일자", "방문일자", "방문일", "방문예정일", "출장일자", "출장일", "활동일자", "활동일", "처리일자"],
  시간: ["시간", "시간대", "방문시간", "방문 시간", "출장시간", "오전오후", "AMPM", "오전/오후"]
};
const NORMALIZED_HEADER_ALIASES = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([canonical, aliases]) => [
    canonical,
    new Set(aliases.map(normalizeHeader))
  ])
);
const TIME_ORDER = { 오전: 0, 오후: 1 };
export const FIELD_VISIT_EXPENSE_ITEMS = [
  "숙박비",
  "항공권·철도승차권",
  "대중교통",
  "유류대",
  "통행료(법인카드)",
  "통행료(개인카드)",
  "주차비",
  "일비",
  "활동비",
  "기타"
];

const FIELD_VISIT_EXCEL_COLUMN_SPANS = [1, 2, 2, 1, 1, 1];

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

  const headerMatch = findTravelProofHeader(lines);
  const headerIndexes = headerMatch.headerIndexes;
  const missing = REQUIRED_HEADERS.filter((header) => headerIndexes[header] === undefined);
  if (missing.length) {
    throw new Error(`필수 열이 없습니다: ${missing.join(", ")}. 엑셀에서 복사한 열 제목 또는 데이터 형식을 확인해 주세요.`);
  }

  return lines.slice(headerMatch.lineIndex + 1).map((line, offset) => {
    const cells = splitRow(line);
    const value = (header) => (cells[headerIndexes[header]] || "").trim();

    return {
      sourceRowNumber: headerMatch.lineIndex + offset + 2,
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

  const normalizedStart = String(start || "").trim();
  const normalizedDestination = String(destination || "").trim();
  if (!dateKey) {
    throw new Error("출장 날짜가 필요합니다.");
  }
  if (!normalizedStart || !normalizedDestination) {
    throw new Error("출발지와 도착지를 모두 입력해 주세요.");
  }

  const label = names.length ? names.join(" ") : `직행-${normalizedDestination}`;
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
    start: normalizedStart,
    destination: normalizedDestination,
    manual: true,
    sourceRows: (names.length ? names : [normalizedDestination])
      .map((name) => ({ dealerName: name, manual: true })),
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
  const recommendedRoute = text.match(/실시간\s*추천[\s\S]{0,300}/i)?.[0] || text;
  const kilometerMatch = recommendedRoute.match(/(\d[\d,]*(?:\.\d+)?)\s*km/i);
  if (kilometerMatch) {
    return Number(kilometerMatch[1].replaceAll(",", ""));
  }

  const meterMatch = recommendedRoute.match(/(\d[\d,]*)\s*m(?:\s|$)/i);
  return meterMatch ? Number(meterMatch[1].replaceAll(",", "")) / 1000 : 0;
}

export function parseFuelPriceWon(value) {
  const normalized = String(value || "").replace(/,/g, "").trim();
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

export function calculateFuelExpenseAmount(distanceKm, fuelPriceWon) {
  return Math.round((Number(distanceKm) / 8) * Number(fuelPriceWon));
}

export function calculateActivityExpenseAmount(distanceKm) {
  return Number(distanceKm) >= 100 ? 20000 : 5000;
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
      cells,
      columnSpans: FIELD_VISIT_EXCEL_COLUMN_SPANS,
      text: excelPasteLine(cells, FIELD_VISIT_EXCEL_COLUMN_SPANS)
    };
  });
}

export function buildActivityExpensePasteRows(entries) {
  return entries.map((entry) => {
    const distanceKm = Number(entry.distanceKm);
    const amount = calculateActivityExpenseAmount(distanceKm);
    const distanceText = formatDistanceForFormula(distanceKm);
    const summary = dealerSummary(entry.group);
    const cells = [
      entry.group.dateKey,
      "활동비",
      "",
      formatWon(amount),
      summary,
      ""
    ];

    return {
      key: `${proofGroupKey(entry.group)}:activity`,
      dateKey: entry.group.dateKey,
      amount,
      note: "",
      summary,
      cells,
      columnSpans: FIELD_VISIT_EXCEL_COLUMN_SPANS,
      text: excelPasteLine(cells, FIELD_VISIT_EXCEL_COLUMN_SPANS)
    };
  });
}

export function buildFieldVisitExpensePasteRows(entries) {
  return entries.flatMap((entry) => [
    ...buildFuelExpensePasteRows([entry]),
    ...buildActivityExpensePasteRows([entry])
  ]);
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

function excelPasteLine(values, columnSpans = []) {
  return values
    .flatMap((value, index) => {
      const span = Math.max(1, Math.trunc(Number(columnSpans[index]) || 1));
      return [value, ...Array(span - 1).fill("")];
    })
    .join("\t");
}

function normalizeHeader(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\s_.-]+/g, "")
    .trim()
    .toUpperCase();
}

function findTravelProofHeader(lines) {
  let bestMatch = { lineIndex: 0, headerIndexes: {}, score: 0 };
  for (let lineIndex = 0; lineIndex < Math.min(lines.length, 30); lineIndex += 1) {
    const headers = splitRow(lines[lineIndex]).map(normalizeHeader);
    const headerIndexes = resolveHeaderIndexes(headers);
    const score = Object.keys(headerIndexes).length;
    const hasRequiredHeaders = REQUIRED_HEADERS.every((header) => headerIndexes[header] !== undefined);
    if (hasRequiredHeaders) {
      return { lineIndex, headerIndexes };
    }
    if (score > bestMatch.score) {
      bestMatch = { lineIndex, headerIndexes, score };
    }
  }

  const inferredMatch = inferTravelProofColumns(lines);
  if (inferredMatch.score > bestMatch.score) {
    return inferredMatch;
  }

  return bestMatch;
}

function resolveHeaderIndexes(headers) {
  const headerIndexes = {};
  headers.forEach((header, index) => {
    for (const [canonical, aliases] of Object.entries(NORMALIZED_HEADER_ALIASES)) {
      if (headerIndexes[canonical] === undefined && aliases.has(header)) {
        headerIndexes[canonical] = index;
      }
    }
  });
  return headerIndexes;
}

function inferTravelProofColumns(lines) {
  const maxLines = Math.min(lines.length, 50);
  let bestMatch = { lineIndex: 0, headerIndexes: {}, score: 0 };

  for (let lineIndex = 0; lineIndex < maxLines; lineIndex += 1) {
    const windowRows = lines
      .slice(lineIndex, Math.min(lines.length, lineIndex + 8))
      .map(splitRow)
      .filter((cells) => cells.length >= 4);
    if (!windowRows.length) continue;

    const maxColumns = Math.max(...windowRows.map((cells) => cells.length));
    const columnScores = Array.from({ length: maxColumns }, (_, index) => scoreTravelProofColumn(windowRows, index));
    const headerIndexes = {};
    const usedColumns = new Set();

    for (const field of ["날짜", "시간", "POS코드", "POS주소", "POS명", "대리점명", "유형요약"]) {
      const candidate = columnScores
        .map((score, index) => ({ index, value: score[field] || 0 }))
        .filter((candidate) => candidate.value > 0 && !usedColumns.has(candidate.index))
        .sort((left, right) => right.value - left.value)[0];
      if (candidate) {
        headerIndexes[field] = candidate.index;
        usedColumns.add(candidate.index);
      }
    }

    if (headerIndexes.POS코드 !== undefined) {
      const afterCode = headerIndexes.POS코드 + 1;
      if (
        afterCode < maxColumns &&
        headerIndexes.날짜 !== afterCode &&
        headerIndexes.시간 !== afterCode &&
        headerIndexes.POS주소 !== afterCode
      ) {
        headerIndexes.POS명 = afterCode;
        usedColumns.add(afterCode);
      }

      const beforeCode = headerIndexes.POS코드 - 1;
      if (beforeCode >= 0) {
        headerIndexes.대리점명 = beforeCode;
        usedColumns.add(beforeCode);
      }
    }

    if (headerIndexes.POS주소 === undefined) {
      const candidate = columnScores
        .map((score, index) => ({ index, value: score.textLength || 0 }))
        .filter((candidate) => candidate.value > 0 && !usedColumns.has(candidate.index))
        .sort((left, right) => right.value - left.value)[0];
      if (candidate) {
        headerIndexes.POS주소 = candidate.index;
      }
    }

    const requiredScore = REQUIRED_HEADERS.filter((header) => headerIndexes[header] !== undefined).length;
    const dataScore = requiredScore * 3 + Object.keys(headerIndexes).length;
    if (dataScore > bestMatch.score) {
      bestMatch = { lineIndex: lineIndex - 1, headerIndexes, score: dataScore };
    }
    if (requiredScore === REQUIRED_HEADERS.length) {
      return bestMatch;
    }
  }

  return bestMatch;
}

function scoreTravelProofColumn(rows, columnIndex) {
  const score = {
    대리점명: 0,
    POS코드: 0,
    POS명: 0,
    유형요약: 0,
    POS주소: 0,
    날짜: 0,
    시간: 0,
    textLength: 0
  };

  for (const cells of rows) {
    const value = String(cells[columnIndex] || "").trim();
    if (!value) continue;
    score.textLength += Math.min(value.length, 40);
    if (/^P?\d{4,}$/i.test(value) || /^P\d+/i.test(value)) score.POS코드 += 4;
    if (parseDateKey(value, 2026)) score.날짜 += 5;
    if (normalizeTime(value) !== value || /^(오전|오후|AM|PM)$/i.test(value)) score.시간 += 5;
    if (/(시|군|구|동|로|길|읍|면|리|번지|\d)/.test(value) && value.length >= 6) score.POS주소 += 3;
    if (/(점|매장|센터|대리점|오페라|상가|병원|학교|마트|프라자|타워|역)/.test(value)) score.POS명 += 2;
    if (/(주식회사|\(주\)|대리점|지점|법인)/.test(value)) score.대리점명 += 2;
    if (/(위탁|일반|판매|방문|지원|직영)/.test(value)) score.유형요약 += 2;
  }

  return score;
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
