import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const privateDirectory = join(root, "private");
const publicDirectory = join(root, "build");
const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

await Promise.all([
  mkdir(privateDirectory, { recursive: true }),
  mkdir(publicDirectory, { recursive: true })
]);
await Promise.all([
  writeFile(join(privateDirectory, "update-private-key.pem"), privateKey, { encoding: "utf8", mode: 0o600 }),
  writeFile(join(publicDirectory, "update-public-key.pem"), publicKey, "utf8")
]);
console.log("업데이트 서명키를 생성했습니다. private 폴더는 공유하거나 커밋하지 마세요.");
