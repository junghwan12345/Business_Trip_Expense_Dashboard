export const PROOF_FOLDERS = {
  route: "거리캡처",
  oil: "유가캡처",
  extra: "추가증빙",
  ppt: "PPT"
};

export const EXTRA_PROOF_FOLDER_ALIASES = ["추가증빙", "추가증빙자료"];

export function proofSubfolder(type) {
  if (!PROOF_FOLDERS[type]) {
    throw new Error(`알 수 없는 증빙 폴더 종류입니다: ${type}`);
  }
  return PROOF_FOLDERS[type];
}

export function parseProofDateFromFileName(fileName, monthKey = "") {
  const name = String(fileName || "");
  const koreanExplicit = name.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (koreanExplicit) {
    return normalizedProofDate(koreanExplicit[1], koreanExplicit[2], koreanExplicit[3]);
  }

  const explicit = name.match(/(20\d{2})[-.](\d{1,2})[-.](\d{1,2})/);
  if (explicit) {
    return normalizedProofDate(explicit[1], explicit[2], explicit[3]);
  }

  const shortYear = name.match(/(^|[^0-9])(\d{2})[-.](\d{1,2})[-.](\d{1,2})([^0-9]|$)/);
  if (shortYear) {
    const year = `20${shortYear[2]}`;
    return normalizedProofDate(year, shortYear[3], shortYear[4]);
  }

  const koreanMonthOnly = name.match(/(^|[^0-9])(\d{1,2})\s*월\s*(\d{1,2})\s*일([^0-9]|$)/);
  if (koreanMonthOnly && /^\d{4}-\d{2}$/.test(monthKey)) {
    return normalizedProofDate(monthKey.slice(0, 4), koreanMonthOnly[2], koreanMonthOnly[3]);
  }

  const monthOnly = name.match(/(^|[^0-9])(\d{1,2})[-.](\d{1,2})([^0-9]|$)/);
  if (monthOnly && /^\d{4}-\d{2}$/.test(monthKey)) {
    return normalizedProofDate(monthKey.slice(0, 4), monthOnly[2], monthOnly[3]);
  }

  return "";
}

function normalizedProofDate(year, month, day) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);
  if (
    !Number.isInteger(parsedYear) ||
    !Number.isInteger(parsedMonth) ||
    !Number.isInteger(parsedDay) ||
    parsedMonth < 1 ||
    parsedMonth > 12 ||
    parsedDay < 1 ||
    parsedDay > 31
  ) {
    return "";
  }

  const date = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay));
  if (
    date.getUTCFullYear() !== parsedYear ||
    date.getUTCMonth() !== parsedMonth - 1 ||
    date.getUTCDate() !== parsedDay
  ) {
    return "";
  }

  return `${parsedYear}-${String(parsedMonth).padStart(2, "0")}-${String(parsedDay).padStart(2, "0")}`;
}

export function titleForProofDate(dateKey) {
  const match = String(dateKey || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) {
    return String(dateKey || "");
  }
  return `${Number(match[1])}/${Number(match[2])}`;
}

export function pptFileBaseName(monthKey) {
  return `${monthKey}-지출결의서-증빙자료.pptx`;
}

export function selectedMonthKey(year, month) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (!Number.isInteger(parsedYear) || !Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    return "";
  }
  return `${parsedYear}-${String(parsedMonth).padStart(2, "0")}`;
}

export function selectedProofMonthDirectoryMode(selectedFolderName, monthKey) {
  return String(selectedFolderName || "") === monthKey ? "selected" : "child";
}

export function proofMonthDirectoryPath({ selectedFolderName, entryNames = [], monthKey }) {
  const names = new Set((entryNames || []).map((name) => String(name)));
  if (String(selectedFolderName || "") === monthKey) {
    return [];
  }
  if (
    names.has(PROOF_FOLDERS.route) ||
    names.has(PROOF_FOLDERS.oil) ||
    EXTRA_PROOF_FOLDER_ALIASES.some((folderName) => names.has(folderName))
  ) {
    return [];
  }
  if ((entryNames || []).some((name) => parseProofDateFromFileName(name, monthKey).startsWith(`${monthKey}-`))) {
    return [];
  }
  if (names.has(monthKey)) {
    return [monthKey];
  }
  if (names.has("travel-proof-output")) {
    return ["travel-proof-output", monthKey];
  }
  return null;
}

export function proofTypeFromFileName(fileName, fallback = "extra") {
  const name = String(fileName || "").toLowerCase();
  if (name.includes("oil") || name.includes("유가")) {
    return "oil";
  }
  if (name.includes("route") || name.includes("map") || name.includes("naver") || name.includes("거리")) {
    return "route";
  }
  return ["route", "oil", "extra"].includes(fallback) ? fallback : "extra";
}

export function groupProofImagesByDate(images, monthKey = "") {
  const groups = new Map();

  for (const image of images || []) {
    const dateKey = image.dateKey || parseProofDateFromFileName(image.name, monthKey);
    if (!dateKey) {
      continue;
    }
    if (/^\d{4}-\d{2}$/.test(monthKey) && !dateKey.startsWith(`${monthKey}-`)) {
      continue;
    }
    if (!groups.has(dateKey)) {
      groups.set(dateKey, { dateKey, route: [], oil: [], extra: [], welfare: [], supply: [], review: [] });
    }
    const bucket = groups.get(dateKey);
    const type = ["route", "oil", "extra", "welfare", "supply", "review"].includes(image.type) ? image.type : "extra";
    bucket[type].push({ ...image, dateKey, type });
  }

  return [...groups.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}
