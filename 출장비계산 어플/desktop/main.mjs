import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateUpdateManifest } from "../src/shared/update-channel.js";

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
  await checkForUpdates();
  updateTimer = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
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
  // 사용자가 설치 파일을 직접 더블클릭하는 것과 동일하게 실행합니다.
  // oneClick 설치본이 실행 중인 앱을 스스로 닫고 설치한 뒤 자동으로 다시 시작합니다.
  shell.openPath(installer).catch(() => {}).finally(() => {
    setTimeout(() => app.exit(0), 1000);
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
  mainWindow.once("ready-to-show", async () => {
    mainWindow.show();
    const healthDirectory = join(appDataRoot, "health");
    await mkdir(healthDirectory, { recursive: true });
    await writeFile(join(healthDirectory, `${app.getVersion()}.healthy`), new Date().toISOString(), "utf8");
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

async function checkForUpdates() {
  try {
    const settings = await readOptionalJson(join(appDataRoot, "personal-settings.json"));
    const updateRoot = String(settings.updateRoot || "").trim();
    let updateSource = await readGithubUpdateSource(DEFAULT_UPDATE_MANIFEST_URL)
      .catch((githubError) => {
        if (!updateRoot) throw githubError;
        return readFolderUpdateSource(updateRoot);
      });
    if (updateSource.waiting) return setUpdateStatus(updateSource.state, updateSource.message);

    const { manifest, installerBuffer } = updateSource;
    const publicKey = await readUpdatePublicKey();
    const validation = validateUpdateManifest(manifest, {
      currentVersion: app.getVersion(),
      installerBuffer,
      publicKey
    });
    if (validation.reason === "not-newer") return setUpdateStatus("current", "최신 버전입니다.");
    if (!validation.ok) return setUpdateStatus("rejected", `업데이트 검증 실패: ${validation.reason}`);

    const updateDirectory = join(appDataRoot, "updates", manifest.version);
    await mkdir(updateDirectory, { recursive: true });
    pendingInstaller = join(updateDirectory, manifest.installerFile);
    pendingVersion = manifest.version;
    await writeFile(pendingInstaller, installerBuffer);
    await writeFile(join(appDataRoot, "update-state.json"), JSON.stringify({
      version: manifest.version,
      installer: pendingInstaller,
      verifiedAt: new Date().toISOString()
    }, null, 2));
    return setUpdateStatus("ready", `${manifest.version} 다운로드 완료. 앱을 완전히 종료하면 업데이트가 설치됩니다.`, manifest);
  } catch (error) {
    return setUpdateStatus("error", `업데이트 확인 실패: ${error.message}`);
  }
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
    installerBuffer: await readFile(installerSource)
  };
}

async function readGithubUpdateSource(manifestUrl) {
  const manifest = await fetchJson(manifestUrl);
  const installerUrl = manifest.installerUrl || new URL(manifest.installerFile || "", manifestUrl).toString();
  return {
    manifest,
    installerBuffer: await fetchBuffer(installerUrl)
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
