import { createHash, verify } from "node:crypto";

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function updateManifestPayload(manifest) {
  return [
    String(manifest.version || ""),
    String(manifest.installerFile || ""),
    String(manifest.sha256 || "").toLowerCase(),
    String(manifest.publishedAt || "")
  ].join("\n");
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function validateUpdateManifest(manifest, { currentVersion, installerBuffer, publicKey }) {
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest?.version || ""))) {
    return { ok: false, reason: "invalid-version" };
  }
  if (!/^[^\\/]+\.exe$/i.test(String(manifest.installerFile || ""))) {
    return { ok: false, reason: "invalid-installer" };
  }
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    return { ok: false, reason: "not-newer" };
  }
  const actualHash = sha256Hex(installerBuffer);
  if (actualHash !== String(manifest.sha256 || "").toLowerCase()) {
    return { ok: false, reason: "hash-mismatch" };
  }
  if (!publicKey || !manifest.signature) {
    return { ok: false, reason: "signature-missing" };
  }
  const signature = Buffer.from(String(manifest.signature), "base64");
  const valid = verify(null, Buffer.from(updateManifestPayload(manifest)), publicKey, signature);
  return valid ? { ok: true, reason: "verified" } : { ok: false, reason: "signature-invalid" };
}

function parseVersion(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : [0, 0, 0];
}
