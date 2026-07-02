import { sign } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { sha256Hex, updateManifestPayload } from "../src/shared/update-channel.js";

const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
const version = String(args.version || packageJson.version || "");
const updateRoot = resolve(String(args["update-root"] || process.env.TRAVEL_PROOF_UPDATE_ROOT || ""));
const privateKeyPath = resolve(String(args.key || process.env.TRAVEL_PROOF_UPDATE_PRIVATE_KEY || join("private", "update-private-key.pem")));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("--version에 x.y.z 버전을 입력해 주세요.");
if (!String(args["update-root"] || process.env.TRAVEL_PROOF_UPDATE_ROOT || "").trim()) throw new Error("--update-root에 공유 Drive 업데이트 폴더를 입력해 주세요.");
if (!existsSync(privateKeyPath)) throw new Error("업데이트 개인키가 없습니다. npm run update:keys를 먼저 실행하세요.");

const installer = await findInstaller(join(process.cwd(), "dist"), version);
const installerBuffer = await readFile(installer);
const installerFile = basename(installer);
const manifest = {
  version,
  installerFile,
  sha256: sha256Hex(installerBuffer),
  publishedAt: new Date().toISOString(),
  releaseNotes: String(args.notes || "")
};
const privateKey = await readFile(privateKeyPath, "utf8");
manifest.signature = sign(null, Buffer.from(updateManifestPayload(manifest)), privateKey).toString("base64");

await mkdir(updateRoot, { recursive: true });
const temporaryInstaller = join(updateRoot, `${installerFile}.syncing`);
await copyFile(installer, temporaryInstaller);
await rename(temporaryInstaller, join(updateRoot, installerFile));
const temporaryManifest = join(updateRoot, "release-manifest.json.syncing");
await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2), "utf8");
await rename(temporaryManifest, join(updateRoot, "release-manifest.json"));
console.log(`${version} 업데이트를 게시했습니다: ${updateRoot}`);

async function findInstaller(directory, targetVersion) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory);
  const match = entries.find((name) => name.endsWith(".exe") && name.includes(targetVersion));
  if (!match) throw new Error(`dist 폴더에서 ${targetVersion} 설치파일을 찾을 수 없습니다.`);
  return join(directory, match);
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index].replace(/^--/, "");
    if (values[index].startsWith("--")) result[key] = values[index + 1] || true;
  }
  return result;
}
