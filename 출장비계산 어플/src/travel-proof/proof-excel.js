// 지출결의서 증빙 시트의 블록 분류와 제목을 생성합니다.
import {
  groupProofImagesByDate,
  parseProofDateFromFileName,
  titleForProofDate
} from "./proof-ppt.js";

const BLOCK_ORDER = ["field", "extra", "welfare", "supply", "other", "review"];
const EXPENSE_LABELS = {
  welfare: "조활비",
  supply: "소모품비",
  other: "기타"
};

export function buildExcelProofBlocks({
  monthKey,
  images = [],
  generalTravelRows = [],
  fieldVisitRows = [],
  corporateCardRows = []
} = {}) {
  const normalizedMonthKey = String(monthKey || "").trim();
  const { matchedImages, unmatchedImages } = normalizeProofImages(images, normalizedMonthKey);
  const grouped = groupProofImagesByDate(matchedImages, normalizedMonthKey);
  const blocks = [];

  for (const group of grouped) {
    const fieldImages = [...(group.route || []), ...(group.oil || []), ...(group.toll || [])];
    if (fieldImages.length) {
      const rows = rowsForDate(fieldVisitRows, group.dateKey);
      blocks.push(proofBlock("field", group.dateKey, fieldImages, rows, fieldTitle(group.dateKey, rows)));
    }

    if ((group.extra || []).length) {
      const rows = rowsForDate(generalTravelRows, group.dateKey);
      blocks.push(proofBlock("extra", group.dateKey, group.extra, rows, generalTravelTitle(group.dateKey, rows)));
    }

    for (const kind of ["welfare", "supply", "other"]) {
      if (!(group[kind] || []).length) {
        continue;
      }
      const rows = rowsForExpenseKind(corporateCardRows, group.dateKey, kind);
      blocks.push(proofBlock(kind, group.dateKey, group[kind], rows, expenseTitle(group.dateKey, kind, rows)));
    }

    if ((group.review || []).length) {
      blocks.push(proofBlock(
        "review",
        group.dateKey,
        group.review,
        [],
        `${titleForProofDate(group.dateKey)} 확인필요 증빙`,
        true
      ));
    }
  }

  blocks.sort((left, right) =>
    left.dateKey.localeCompare(right.dateKey) ||
    BLOCK_ORDER.indexOf(left.kind) - BLOCK_ORDER.indexOf(right.kind)
  );

  return { blocks, unmatchedImages };
}

function normalizeProofImages(images, monthKey) {
  const matchedImages = [];
  const unmatchedImages = [];

  for (const image of images || []) {
    const explicitDate = String(image?.dateKey || "").trim();
    const parsedDate = explicitDate || parseProofDateFromFileName(image?.name, monthKey);
    const isReviewDate = parsedDate === `${monthKey}-확인필요`;
    const isSelectedDate = /^\d{4}-\d{2}-\d{2}$/.test(parsedDate) && parsedDate.startsWith(`${monthKey}-`);
    if (!isReviewDate && !isSelectedDate) {
      unmatchedImages.push({
        type: image?.type || "extra",
        name: String(image?.name || ""),
        reason: parsedDate ? "selected-month-mismatch" : "file-name-date-not-found"
      });
      continue;
    }
    matchedImages.push({ ...image, dateKey: parsedDate });
  }

  return { matchedImages, unmatchedImages };
}

function proofBlock(kind, dateKey, images, rows, title, forceReview = false) {
  return {
    kind,
    dateKey,
    title,
    images: images.map((image) => ({
      type: image.type,
      name: image.name,
      path: image.path,
      dataUri: image.dataUri
    })),
    matchedExpenseCount: rows.length,
    needsReview: forceReview || rows.length === 0
  };
}

function rowsForDate(rows, dateKey) {
  return (rows || []).filter((row) => String(row?.dateKey || "").trim() === dateKey);
}

function rowsForExpenseKind(rows, dateKey, kind) {
  return rowsForDate(rows, dateKey).filter((row) => matchesExpenseKind(row?.item, kind));
}

function matchesExpenseKind(item, kind) {
  const text = String(item || "").replace(/\s+/g, "");
  if (kind === "welfare") {
    return text.includes("조직활동") || text.includes("조활");
  }
  if (kind === "supply") {
    return text.includes("소모품");
  }
  return kind === "other" && text.includes("기타");
}

function fieldTitle(dateKey, rows) {
  const location = firstUsefulText(rows, ["summary", "place"]);
  return location
    ? `${titleForProofDate(dateKey)} 현장지원방문_${location}`
    : `${titleForProofDate(dateKey)} 현장지원`;
}

function generalTravelTitle(dateKey, rows) {
  const items = uniqueValues(rows.map((row) => row?.item));
  const label = items.length === 1 ? items[0] : "일반출장";
  return titleWithAmount(dateKey, label, rows);
}

function expenseTitle(dateKey, kind, rows) {
  return titleWithAmount(dateKey, EXPENSE_LABELS[kind], rows);
}

function titleWithAmount(dateKey, label, rows) {
  const amountWon = rows.reduce((sum, row) => sum + Math.max(0, Number(row?.amountWon) || 0), 0);
  return amountWon
    ? `${titleForProofDate(dateKey)} ${label} ${amountWon.toLocaleString("ko-KR")}원`
    : `${titleForProofDate(dateKey)} ${label}`;
}

function firstUsefulText(rows, keys) {
  for (const row of rows) {
    for (const key of keys) {
      const value = cleanTitleText(row?.[key]);
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function uniqueValues(values) {
  return [...new Set(values.map(cleanTitleText).filter(Boolean))];
}

function cleanTitleText(value) {
  return String(value || "")
    .replace(/\s*\/\s*/g, "·")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}
