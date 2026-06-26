import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateUpdateManifest } from "../src/shared/update-channel.js";

const APP_FOLDER = "BusinessTripProof";
const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));
const appDataRoot = join(app.getPath("localAppData"), APP_FOLDER);
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
  localServer = await startServer({ port: 0, host: "127.0.0.1" });
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
  updateStatus = { state: "installing", message: "앱 종료 후 업데이트를 설치합니다." };
  broadcastUpdateStatus();
  setTimeout(async () => {
    const healthFile = join(appDataRoot, "health", `${pendingVersion || "next"}.healthy`);
    await mkdir(join(appDataRoot, "health"), { recursive: true });
    await rm(healthFile, { force: true });
    const previousInstaller = join(
      appDataRoot,
      "updates",
      app.getVersion(),
      `BusinessTripProof-${app.getVersion()}-Setup.exe`
    );
    const helperOptions = join(appDataRoot, "update-helper-options.json");
    await writeFile(helperOptions, JSON.stringify({
      parentPid: process.pid,
      installer: pendingInstaller,
      previousInstaller: existsSync(previousInstaller) ? previousInstaller : "",
      appExecutable: process.execPath,
      healthFile
    }, null, 2));
    const child = spawn(process.execPath, [join(app.getAppPath(), "desktop", "update-helper.cjs"), helperOptions], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    });
    child.unref();
    app.exit(0);
  }, 250);
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
}

async function checkForUpdates() {
  try {
    const settings = await readJson(join(appDataRoot, "personal-settings.json"));
    const updateRoot = String(settings.updateRoot || "").trim();
    if (!updateRoot) return setUpdateStatus("disabled", "업데이트 공유 폴더가 설정되지 않았습니다.");
    const manifest = await readJson(join(updateRoot, "release-manifest.json"));
    const installerSource = join(updateRoot, manifest.installerFile || "");
    if (!existsSync(installerSource)) return setUpdateStatus("waiting-sync", "설치파일이 Drive에 동기화되기를 기다립니다.");

    const [installerBuffer, publicKey] = await Promise.all([
      readFile(installerSource),
      readUpdatePublicKey()
    ]);
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
    await copyFile(installerSource, pendingInstaller);
    await writeFile(join(appDataRoot, "update-state.json"), JSON.stringify({
      version: manifest.version,
      installer: pendingInstaller,
      verifiedAt: new Date().toISOString()
    }, null, 2));
    return setUpdateStatus("ready", `${manifest.version} 업데이트가 앱 종료 후 설치됩니다.`, manifest);
  } catch (error) {
    return setUpdateStatus("error", `업데이트 확인 실패: ${error.message}`);
  }
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
