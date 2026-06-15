import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PROOF_FOLDER_NAME = "출장비증빙";

export function googleDriveBaseCandidates({ homeDirectory = homedir(), env = process.env } = {}) {
  const candidates = [];
  if (env.GOOGLE_DRIVE_ROOT) {
    candidates.push(env.GOOGLE_DRIVE_ROOT);
  }
  candidates.push(
    join("G:\\", "내 드라이브"),
    join("G:\\", "My Drive"),
    join(homeDirectory, "Google Drive", "내 드라이브"),
    join(homeDirectory, "Google Drive", "My Drive"),
    join(homeDirectory, "My Drive")
  );
  return [...new Set(candidates)];
}

export function resolveDefaultOutputRoot({
  appRoot,
  homeDirectory = homedir(),
  env = process.env,
  existsSync
}) {
  if (env.TRAVEL_PROOF_OUTPUT_ROOT) {
    return {
      outputRoot: env.TRAVEL_PROOF_OUTPUT_ROOT,
      storageType: "custom",
      googleDriveDetected: false
    };
  }

  for (const candidate of googleDriveBaseCandidates({ homeDirectory, env })) {
    if (existsSync(candidate)) {
      return {
        outputRoot: join(candidate, DEFAULT_PROOF_FOLDER_NAME),
        storageType: "googleDrive",
        googleDriveDetected: true
      };
    }
  }

  return {
    outputRoot: join(appRoot, "travel-proof-output"),
    storageType: "localFallback",
    googleDriveDetected: false
  };
}
