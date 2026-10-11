/** 从真实 tarball 解压后加载入口、声明对应模块与生成契约，不安装到 DSH。 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { fixture } from "../tests/fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const archive = path.join(root, "releases", `${manifest.name}-${manifest.version}.tgz`);
assert.ok(existsSync(archive), "安装包不存在");
const listing = spawnSync("tar", ["-tf", archive], { encoding: "utf8" });
if (listing.error) throw listing.error;
assert.equal(listing.status, 0, listing.stderr);
const entries = listing.stdout.trim().split(/\r?\n/);
assert.ok(entries.every(entry => entry.startsWith("package/") && !entry.split("/").includes("..") && !entry.includes("\\")));
for (const file of ["package.json", "cordis.patch.yml", "README.md", "LICENSE", "lib/host.js", "lib/host.d.ts", "lib/connection.js", "lib/connection.d.ts", "lib/discovery.js", "lib/discovery.d.ts", "lib/generated/contract.json"]) {
  assert.ok(entries.includes(`package/${file}`), `安装包缺少 ${file}`);
}
assert.ok(!entries.some(entry => /(?:node_modules|tests|\.env|\.npmrc)/.test(entry)));
const directory = mkdtempSync(path.join(root, "releases", "verify-"));
const unpacked = spawnSync("tar", ["-xzf", archive, "-C", directory], { stdio: "inherit" });
if (unpacked.error) throw unpacked.error;
assert.equal(unpacked.status, 0);
const packageRoot = path.join(directory, "package");
const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const { createTools } = await import(pathToFileURL(path.join(packageRoot, pkg.main)));
const { SiYuanConnection } = await import(pathToFileURL(path.join(packageRoot, pkg.exports["./connection"].import)));
const server = await fixture();
const portFile = path.join(directory, "port.json");
writeFileSync(portFile, JSON.stringify({ [process.pid]: new URL(server.apiUrl).port }));
const connection = new SiYuanConnection({ portFile });
try {
  const tools = createTools(connection);
  assert.equal(tools.length, 5);
  assert.equal(connection.http.contract.endpoints.length, 697);
  assert.equal(connection.config.apiUrl, "auto");
  assert.equal((await connection.discovery.status()).instances[0].apiUrl, server.apiUrl);
  assert.match(readFileSync(path.join(packageRoot, "cordis.patch.yml"), "utf8"), /apiUrl: auto/);
  const result = await tools[0].execute({ action: "notebooks" });
  assert.equal(JSON.parse(result.summary).notebooks.length, 1);
  const discovered = await tools[4].execute({ channel: "contract", limit: 1 });
  assert.equal(JSON.parse(discovered.summary).total, 697);
  console.log(JSON.stringify({ archive, version: pkg.version, bytes: readFileSync(archive).length,
    sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    files: entries.length, tools: tools.map(tool => tool.name), endpoints: connection.http.contract.endpoints.length,
    loadedFrom: packageRoot, smoke: "passed" }, null, 2));
} finally { await connection.dispose(); await server.close(); }
