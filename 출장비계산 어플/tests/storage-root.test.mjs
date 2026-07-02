import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  DEFAULT_PROOF_FOLDER_NAME,
  googleDriveBaseCandidates,
  resolveDefaultOutputRoot
} from "../src/shared/storage-root.js";

test("resolveDefaultOutputRoot prefers a detected Google Drive sync folder", () => {
  const homeDirectory = "C:\\Users\\tester";
  const driveRoot = join("G:\\", "내 드라이브");
  const result = resolveDefaultOutputRoot({
    appRoot: "C:\\app",
    homeDirectory,
    env: {},
    existsSync: (path) => path === driveRoot
  });

  assert.equal(result.storageType, "googleDrive");
  assert.equal(result.googleDriveDetected, true);
  assert.equal(result.outputRoot, join(driveRoot, DEFAULT_PROOF_FOLDER_NAME));
});

test("resolveDefaultOutputRoot falls back to the app output folder when Drive is missing", () => {
  const result = resolveDefaultOutputRoot({
    appRoot: "C:\\app",
    homeDirectory: "C:\\Users\\tester",
    env: {},
    existsSync: () => false
  });

  assert.equal(result.storageType, "localFallback");
  assert.equal(result.outputRoot, join("C:\\app", "travel-proof-output"));
});

test("googleDriveBaseCandidates allows explicit environment override candidates", () => {
  const candidates = googleDriveBaseCandidates({
    homeDirectory: "C:\\Users\\tester",
    env: { GOOGLE_DRIVE_ROOT: "D:\\Drive" }
  });

  assert.equal(candidates[0], "D:\\Drive");
});
