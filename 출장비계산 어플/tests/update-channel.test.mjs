import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  compareVersions,
  sha256Hex,
  updateManifestPayload,
  validateUpdateManifest
} from "../src/shared/update-channel.js";

test("compareVersions compares semantic versions", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

test("update manifest requires matching hash and Ed25519 signature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const installerBuffer = Buffer.from("installer fixture");
  const manifest = {
    version: "1.1.0",
    installerFile: "BusinessTripProof-1.1.0.exe",
    sha256: sha256Hex(installerBuffer),
    publishedAt: "2026-06-23T00:00:00.000Z"
  };
  manifest.signature = sign(null, Buffer.from(updateManifestPayload(manifest)), privateKey).toString("base64");

  assert.deepEqual(validateUpdateManifest(manifest, { currentVersion: "1.0.0", installerBuffer, publicKey }), {
    ok: true,
    reason: "verified"
  });
  assert.equal(validateUpdateManifest(manifest, {
    currentVersion: "1.0.0",
    installerBuffer: Buffer.from("tampered"),
    publicKey
  }).reason, "hash-mismatch");
});
