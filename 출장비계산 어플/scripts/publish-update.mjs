import { sign } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { sha256Hex, updateManifestPayload } from "../src/shared/update-channel.js";

const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
const version = String(args.version || packageJson.version || "");
const configuredUpdateRoot = String(args["update-root"] || process.env.TRAVEL_PROOF_UPDATE_ROOT || "").trim();
const updateRoot = configuredUpdateRoot ? resolve(configuredUpdateRoot) : "";
const installerUrl = String(
  args["installer-url"]
  || process.env.TRAVEL_PROOF_UPDATE_INSTALLER_URL
  || `https://github.com/junghwan12345/Business_Trip_Expense_Dashboard/releases/latest/download/BusinessTripProof-${version}-Setup.exe`
).trim();
const privateKeyPath = resolve(String(args.key || process.env.TRAVEL_PROOF_UPDATE_PRIVATE_KEY || join("private", "update-private-key.pem")));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("--version에 x.y.z 버전을 입력해 주세요.");
if (!existsSync(privateKeyPath)) throw new Error("업데이트 개인키가 없습니다. npm run update:keys를 먼저 실행하세요.");

const installer = await findInstaller(join(process.cwd(), "dist"), version);
const installerBuffer = await readFile(installer);
const installerFile = basename(installer);
const manifest = {
  version,
  installerFile,
  installerUrl,
  sha256: sha256Hex(installerBuffer),
  publishedAt: new Date().toISOString(),
  releaseNotes: String(args.notes || "")
};
const privateKey = await readFile(privateKeyPath, "utf8");
manifest.signature = sign(null, Buffer.from(updateManifestPayload(manifest)), privateKey).toString("base64");

if (updateRoot) {
  await mkdir(updateRoot, { recursive: true });
  const temporaryInstaller = join(updateRoot, `${installerFile}.syncing`);
  await copyFile(installer, temporaryInstaller);
  await rename(temporaryInstaller, join(updateRoot, installerFile));
  const temporaryManifest = join(updateRoot, "release-manifest.json.syncing");
  await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporaryManifest, join(updateRoot, "release-manifest.json"));
  console.log(`${version} 업데이트를 공유 폴더에 게시했습니다: ${updateRoot}`);
} else {
  const manifestPath = join(process.cwd(), "dist", "release-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`${version} GitHub Release용 manifest를 만들었습니다: ${manifestPath}`);
  console.log(`GitHub Release v${version}에 다음 두 파일을 업로드하세요:`);
  console.log(`- ${installer}`);
  console.log(`- ${manifestPath}`);
}

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
