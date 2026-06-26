import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  isLikelyGoogleDrivePath,
  isPathWithin,
  monthFolderPaths,
  normalizePersonalSettings,
  resolvePersonalDataRoot,
  resolvePersonalOutputRoot
} from "../src/shared/personal-storage.js";

test("personal data root uses LocalAppData on Windows", () => {
  assert.equal(
    resolvePersonalDataRoot({ env: { LOCALAPPDATA: "C:\\Users\\kim\\AppData\\Local" }, platform: "win32" }),
    "C:\\Users\\kim\\AppData\\Local\\BusinessTripProof"
  );
});

test("personal output root adds the app folder only once", () => {
  assert.equal(resolvePersonalOutputRoot("G:\\내 드라이브"), "G:\\내 드라이브\\출장비증빙");
  assert.equal(resolvePersonalOutputRoot("G:\\내 드라이브\\출장비증빙"), "G:\\내 드라이브\\출장비증빙");
});

test("personal settings require a selected drive before onboarding completes", () => {
  assert.equal(normalizePersonalSettings({ onboardingComplete: true }).onboardingComplete, false);
  assert.equal(normalizePersonalSettings({ driveRoot: "G:\\내 드라이브", onboardingComplete: true }).onboardingComplete, true);
});

test("month folder list includes capture, excel, and PPT destinations", () => {
  const paths = monthFolderPaths("G:\\내 드라이브\\출장비증빙", "2026-06");
  assert.ok(paths.includes(join("G:\\내 드라이브\\출장비증빙", "2026-06", "엑셀자료")));
  assert.ok(paths.includes(join("G:\\내 드라이브\\출장비증빙", "2026-06", "PPT")));
});

test("Google Drive hints and safe child paths are recognized", () => {
  assert.equal(isLikelyGoogleDrivePath("G:\\내 드라이브"), true);
  assert.equal(isLikelyGoogleDrivePath("D:\\영수증"), false);
  assert.equal(isPathWithin("C:\\Users\\kim\\AppData\\Local\\BusinessTripProof", "C:\\Users\\kim\\AppData\\Local\\BusinessTripProof\\pending"), true);
  assert.equal(isPathWithin("C:\\Users\\kim\\AppData\\Local\\BusinessTripProof", "C:\\Windows"), false);
});
