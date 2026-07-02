import { homedir } from "node:os";
import { basename, join, normalize, resolve } from "node:path";

export const APP_DATA_FOLDER_NAME = "BusinessTripProof";
export const PERSONAL_OUTPUT_FOLDER_NAME = "출장비증빙";
export const PERSONAL_MONTH_FOLDERS = [
  "거리캡처",
  "유가캡처",
  "추가증빙",
  "조활비",
  "소모품비",
  "기타",
  "확인필요",
  "엑셀자료",
  "PPT"
];

export function resolvePersonalDataRoot({ env = process.env, homeDirectory = homedir(), platform = process.platform } = {}) {
  if (env.TRAVEL_PROOF_DATA_ROOT) return resolve(env.TRAVEL_PROOF_DATA_ROOT);
  if (platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, APP_DATA_FOLDER_NAME);
  return join(homeDirectory, `.${APP_DATA_FOLDER_NAME}`);
}

export function resolvePersonalOutputRoot(driveRoot) {
  const selected = resolve(String(driveRoot || "").trim());
  return basename(selected).toLocaleLowerCase("ko-KR") === PERSONAL_OUTPUT_FOLDER_NAME.toLocaleLowerCase("ko-KR")
    ? selected
    : join(selected, PERSONAL_OUTPUT_FOLDER_NAME);
}

export function normalizePersonalSettings(value = {}) {
  const driveRoot = String(value.driveRoot || "").trim();
  const outputRoot = driveRoot ? resolvePersonalOutputRoot(driveRoot) : "";
  return {
    version: 1,
    onboardingComplete: Boolean(value.onboardingComplete && driveRoot),
    driveRoot,
    outputRoot,
    updateRoot: String(value.updateRoot || "").trim(),
    updatedAt: String(value.updatedAt || "")
  };
}

export function monthFolderPaths(outputRoot, monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) return [];
  return PERSONAL_MONTH_FOLDERS.map((folder) => join(outputRoot, monthKey, folder));
}

export function isLikelyGoogleDrivePath(pathValue) {
  const value = normalize(String(pathValue || "")).toLocaleLowerCase("ko-KR");
  return /google\s*drive|내 드라이브|my drive|공유 드라이브|shared drives/.test(value) || /^[a-z]:\\(?:내 드라이브|my drive)/i.test(value);
}

export function isPathWithin(parent, candidate) {
  const root = `${resolve(parent)}\\`.toLocaleLowerCase("ko-KR");
  const target = `${resolve(candidate)}\\`.toLocaleLowerCase("ko-KR");
  return target.startsWith(root);
}
