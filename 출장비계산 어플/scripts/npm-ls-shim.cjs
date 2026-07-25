// package-lock 기반으로 electron-builder에 npm 의존성 트리를 제공하는 빌드용 shim
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const command = process.argv[2] || "";
if (!["ls", "list", "la", "ll"].includes(command)) {
  process.exit(0);
}

const lock = JSON.parse(readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8"));
const packages = lock.packages || {};
const rootPackage = packages[""] || {};

function buildDependencyNode(name, seen = new Set()) {
  const packageInfo = packages[`node_modules/${name}`];
  if (!packageInfo) {
    return { missing: true };
  }

  const node = {
    version: packageInfo.version || "",
    resolved: packageInfo.resolved || "",
    dependencies: {}
  };

  const childDependencies = {
    ...(packageInfo.dependencies || {}),
    ...(packageInfo.optionalDependencies || {})
  };

  for (const childName of Object.keys(childDependencies)) {
    if (seen.has(childName)) continue;
    node.dependencies[childName] = buildDependencyNode(childName, new Set([...seen, childName]));
  }

  if (!Object.keys(node.dependencies).length) {
    delete node.dependencies;
  }
  return node;
}

const dependencies = {};
for (const name of Object.keys(rootPackage.dependencies || {})) {
  dependencies[name] = buildDependencyNode(name, new Set([name]));
}

process.stdout.write(JSON.stringify({
  name: rootPackage.name || lock.name || "app",
  version: rootPackage.version || lock.version || "0.0.0",
  dependencies
}, null, 2));
