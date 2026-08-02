import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, sha256Hex, validateUpdateManifest } from "../src/shared/update-channel.js";

const APP_FOLDER = "BusinessTripProof";
const DESKTOP_SERVER_PORT = Number(process.env.TRAVEL_PROOF_DESKTOP_PORT || 41731);
const DEFAULT_UPDATE_MANIFEST_URL = process.env.TRAVEL_PROOF_UPDATE_MANIFEST_URL
  || "https://github.com/junghwan12345/Business_Trip_Expense_Dashboard/releases/latest/download/release-manifest.json";
const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));
const appIconPath = resolveAppIconPath();
const appDataRoot = join(resolveLocalAppData(), APP_FOLDER);
app.setPath("userData", appDataRoot);
process.env.TRAVEL_PROOF_DATA_ROOT = appDataRoot;
process.env.TRAVEL_PROOF_CHROME_PROFILE = join(appDataRoot, "chrome-profile");
process.env.TRAVEL_PROOF_APP_ROOT = app.getAppPath();

let mainWindow = null;
let localServer = null;
let updateTimer = null;
let installingUpdate = false;
let updateStatus = { state: "idle", message: "업데이트 확인 전" };
let pendingInstaller = "";
let pendingVersion = "";

function resolveLocalAppData() {
  try {
    return app.getPath("localAppData");
  } catch {}
  if (process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA;
  return join(homedir(), "AppData", "Local");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  await mkdir(appDataRoot, { recursive: true });
  const { startServer } = await import("../server.mjs");
  localServer = await startDesktopServer(startServer);
  createWindow(localServer.port);
  registerDesktopIpc();
  await cleanupOldUpdateFiles();
  await checkForUpdates();
  updateTimer = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}).catch((error) => {
  // 시작에 실패하면 창도 뜨지 않고 조용히 멈추므로, 원인을 반드시 표시합니다.
  dialog.showErrorBox("실행 실패", `앱을 시작하지 못했습니다.\n\n${error?.message || error}`);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!pendingInstaller || installingUpdate || !app.isPackaged) return;
  event.preventDefault();
  installingUpdate = true;
  updateStatus = { state: "installing", message: "업데이트를 설치하고 있습니다. 잠시 후 자동으로 다시 시작됩니다." };
  broadcastUpdateStatus();
  const installer = pendingInstaller;
  // 설치가 끝나면 앱이 자동으로 다시 켜지도록 보조 감시를 띄웁니다.
  // (설치본이 스스로 재실행하는 경우에는 중복 실행하지 않고 그대로 종료됩니다.)
  scheduleRelaunchAfterUpdate().catch(() => {});
  // 사용자가 설치 파일을 직접 더블클릭하는 것과 동일하게 실행합니다.
  shell.openPath(installer)
    .then((failureMessage) => {
      if (failureMessage) throw new Error(failureMessage);
      setTimeout(() => app.exit(0), 1000);
    })
    .catch((error) => {
      // 설치 실행이 실패하면 조용히 종료하지 않고 원인과 설치파일 위치를 알려 줍니다.
      installingUpdate = false;
      setUpdateStatus("error", `업데이트 설치를 시작하지 못했습니다: ${error.message}`);
      dialog.showErrorBox(
        "업데이트 설치 실패",
        `자동 설치를 시작하지 못했습니다.\n\n${error.message}\n\n탐색기에서 아래 설치 파일을 직접 실행해 주세요.\n${installer}`
      );
      shell.showItemInFolder(installer);
      app.exit(1);
    });
});

app.on("will-quit", () => {
  if (updateTimer) clearInterval(updateTimer);
  localServer?.server?.close();
});

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    icon: appIconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/travel-proof.html`);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
}

function registerDesktopIpc() {
  ipcMain.handle("desktop:select-directory", async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: String(options.title || "폴더 선택"),
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? "" : result.filePaths[0] || "";
  });
  ipcMain.handle("desktop:app-info", () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    dataRoot: appDataRoot
  }));
  ipcMain.handle("desktop:focus-window", () => {
    // 캡처가 끝나 Chrome이 닫힌 뒤 앱 창을 앞으로 가져옵니다.
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  });
  ipcMain.handle("desktop:update-status", () => updateStatus);
  ipcMain.handle("desktop:check-updates", checkForUpdates);
  ipcMain.handle("desktop:install-update", () => {
    if (!pendingInstaller) return setUpdateStatus("idle", "설치할 업데이트가 없습니다.");
    app.quit();
    return setUpdateStatus("installing", "앱을 종료하고 업데이트를 설치합니다.");
  });
}

async function startDesktopServer(startServer) {
  // localStorage(설정·거리유류대·통행료 계산값)는 origin(포트)별로 저장됩니다.
  // 업데이트 재실행 순간 이전 버전이 아직 포트를 놓지 않아 무작위 포트로 바뀌면
  // 저장값이 사라진 것처럼 보이므로, 같은 포트가 풀릴 때까지 잠깐 기다렸다 재시도합니다.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await startServer({ port: DESKTOP_SERVER_PORT, host: "127.0.0.1" });
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  // 최후에도 안 되면 무작위 포트 대신 고정 대체 포트를 사용해 origin을 최대한 안정적으로 유지합니다.
  return startServer({ port: DESKTOP_SERVER_PORT + 1, host: "127.0.0.1" });
}

function resolveAppIconPath() {
  const candidates = [
    join(process.resourcesPath || "", "app-icon.ico"),
    fileURLToPath(new URL("../build/app-icon.ico", import.meta.url))
  ];
  return candidates.find((candidate) => existsSync(candidate)) || undefined;
}

// 업데이트 설치가 끝난 뒤 앱을 다시 켜 주는 보조 스크립트를 띄웁니다.
// 설치 프로그램이 사라질 때까지 기다렸다가, 앱이 켜져 있지 않을 때만 실행합니다.
async function scheduleRelaunchAfterUpdate() {
  const scriptPath = join(appDataRoot, "relaunch-after-update.ps1");
  const script = [
    "$ErrorActionPreference = \"SilentlyContinue\"",
    `$appPath = '${process.execPath.replace(/'/g, "''")}'`,
    "$appName = [IO.Path]::GetFileNameWithoutExtension($appPath)",
    "$deadline = (Get-Date).AddMinutes(5)",
    "Start-Sleep -Seconds 5",
    "while ((Get-Date) -lt $deadline) {",
    "  if (-not (Get-Process -Name 'BusinessTripProof-*-Setup' -ErrorAction SilentlyContinue)) { break }",
    "  Start-Sleep -Seconds 2",
    "}",
    "Start-Sleep -Seconds 4",
    "if (-not (Get-Process -Name $appName -ErrorAction SilentlyContinue)) {",
    "  if (Test-Path -LiteralPath $appPath) { Start-Process -FilePath $appPath }",
    "}",
    ""
  ].join("\r\n");
  // PowerShell 5.1이 한글 경로를 올바로 읽도록 BOM을 포함해 저장합니다.
  await writeFile(scriptPath, `﻿${script}`, "utf8");
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath
  ], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

// 설치가 끝난 뒤 남는 예전 버전 설치파일(각 100MB 이상)을 정리합니다.
// 현재 실행 중인 버전의 설치파일은 되돌릴 때 쓸 수 있으므로 남겨 둡니다.
async function cleanupOldUpdateFiles() {
  const updatesRoot = join(appDataRoot, "updates");
  try {
    const entries = await readdir(updatesRoot, { withFileTypes: true });
    const currentVersion = app.getVersion();
    const removable = entries.filter((entry) => entry.isDirectory() && entry.name !== currentVersion);
    await Promise.all(removable.map((entry) =>
      rm(join(updatesRoot, entry.name), { recursive: true, force: true }).catch(() => {})
    ));
    return { removed: removable.map((entry) => entry.name) };
  } catch {
    return { removed: [] };
  }
}

async function checkForUpdates() {
  try {
    const settings = await readOptionalJson(join(appDataRoot, "personal-settings.json"));
    const updateRoot = String(settings.updateRoot || "").trim();
    const updateSource = await readGithubUpdateSource(DEFAULT_UPDATE_MANIFEST_URL)
      .catch((githubError) => {
        if (!updateRoot) throw githubError;
        return readFolderUpdateSource(updateRoot);
      });
    if (updateSource.waiting) return setUpdateStatus(updateSource.state, updateSource.message);

    const { manifest, loadInstaller } = updateSource;
    // 설치파일은 100MB가 넘으므로 버전이 실제로 더 최신일 때만 내려받습니다.
    // (예전에는 확인할 때마다 전체를 내려받아 6시간마다 불필요한 트래픽이 발생했습니다.)
    if (compareVersions(String(manifest.version || ""), app.getVersion()) <= 0) {
      return setUpdateStatus("current", "최신 버전입니다.");
    }

    // 서명을 확인하기 전이므로, 경로를 만들기 전에 파일명 형식부터 검사합니다.
    const installerFile = String(manifest.installerFile || "");
    if (!/^[^\\/]+\.exe$/i.test(installerFile)) {
      return setUpdateStatus("rejected", "업데이트 검증 실패: invalid-installer");
    }
    const updateDirectory = join(appDataRoot, "updates", manifest.version);
    const installerPath = join(updateDirectory, installerFile);
    const installerBuffer = await loadCachedInstaller(installerPath, manifest) || await loadInstaller();

    const publicKey = await readUpdatePublicKey();
    const validation = validateUpdateManifest(manifest, {
      currentVersion: app.getVersion(),
      installerBuffer,
      publicKey
    });
    if (validation.reason === "not-newer") return setUpdateStatus("current", "최신 버전입니다.");
    if (!validation.ok) return setUpdateStatus("rejected", `업데이트 검증 실패: ${validation.reason}`);

    await mkdir(updateDirectory, { recursive: true });
    pendingInstaller = installerPath;
    pendingVersion = manifest.version;
    await writeFile(pendingInstaller, installerBuffer);
    await writeFile(join(appDataRoot, "update-state.json"), JSON.stringify({
      version: manifest.version,
      installer: pendingInstaller,
      previousVersion: app.getVersion(),
      previousInstaller: previousInstallerPath(),
      verifiedAt: new Date().toISOString()
    }, null, 2));
    return setUpdateStatus("ready", `${manifest.version} 다운로드 완료. 앱을 완전히 종료하면 업데이트가 설치됩니다.`, manifest);
  } catch (error) {
    return setUpdateStatus("error", `업데이트 확인 실패: ${error.message}`);
  }
}

// 같은 버전 설치파일을 이미 받아 두었고 해시가 일치하면 다시 내려받지 않습니다.
async function loadCachedInstaller(installerPath, manifest) {
  if (!existsSync(installerPath)) return null;
  try {
    const cached = await readFile(installerPath);
    return sha256Hex(cached) === String(manifest.sha256 || "").toLowerCase() ? cached : null;
  } catch {
    return null;
  }
}

// 설치 시 NSIS가 각 버전의 설치파일을 보관하므로, 되돌릴 때 쓸 현재 버전 설치파일 경로를 남겨 둡니다.
function previousInstallerPath() {
  const path = join(appDataRoot, "updates", app.getVersion(), `BusinessTripProof-${app.getVersion()}-Setup.exe`);
  return existsSync(path) ? path : "";
}

async function readFolderUpdateSource(updateRoot) {
  const manifest = await readJson(join(updateRoot, "release-manifest.json"));
  const installerSource = join(updateRoot, manifest.installerFile || "");
  if (!existsSync(installerSource)) {
    return {
      waiting: true,
      state: "waiting-sync",
      message: "설치파일이 Drive에 동기화되기를 기다립니다."
    };
  }
  return {
    manifest,
    loadInstaller: () => readFile(installerSource)
  };
}

async function readGithubUpdateSource(manifestUrl) {
  const manifest = await fetchJson(manifestUrl);
  const installerUrl = manifest.installerUrl || new URL(manifest.installerFile || "", manifestUrl).toString();
  return {
    manifest,
    loadInstaller: () => fetchBuffer(installerUrl)
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error(`업데이트 정보를 읽지 못했습니다. (${response.status})`);
  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`업데이트 설치파일을 내려받지 못했습니다. (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function readUpdatePublicKey() {
  const candidates = [
    process.env.TRAVEL_PROOF_UPDATE_PUBLIC_KEY,
    join(process.resourcesPath, "update-public-key.pem"),
    join(app.getAppPath(), "build", "update-public-key.pem")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {}
  }
  return "";
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch {
    return {};
  }
}

function setUpdateStatus(state, message, manifest = null) {
  updateStatus = { state, message, manifest, checkedAt: new Date().toISOString() };
  broadcastUpdateStatus();
  return updateStatus;
}

function broadcastUpdateStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:update-status-changed", updateStatus);
  }
}
