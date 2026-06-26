const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");

const [, , optionsPath] = process.argv;
const options = JSON.parse(readFileSync(optionsPath, "utf8"));

main().catch(() => process.exit(1));

async function main() {
  await waitForProcessExit(options.parentPid, 30000);
  const installed = await run(options.installer, ["/S"], 120000);
  if (!installed) return rollback();

  const launched = spawn(options.appExecutable, [], { detached: true, stdio: "ignore", windowsHide: true });
  launched.unref();
  const healthy = await waitForFile(options.healthFile, 60000);
  if (healthy) return process.exit(0);

  try { process.kill(launched.pid); } catch {}
  await rollback();
}

async function rollback() {
  if (options.previousInstaller && existsSync(options.previousInstaller)) {
    await run(options.previousInstaller, ["/S"], 120000);
    const restored = spawn(options.appExecutable, [], { detached: true, stdio: "ignore", windowsHide: true });
    restored.unref();
  }
  process.exit(1);
}

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(false);
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function waitForProcessExit(pid, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { process.kill(pid, 0); } catch { return; }
    await delay(250);
  }
}

async function waitForFile(path, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) return true;
    await delay(500);
  }
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
