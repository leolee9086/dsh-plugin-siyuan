/** 先在固定 staging 目录构建并验证，成功后才替换发布目录。 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, renameSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const staging = path.join(root, ".build-lib");
const output = path.join(root, "lib");
// 固定目标均在仓库内；删除绝不接受命令行提供的路径。
for (const target of [staging, output]) {
  if (path.dirname(target) !== path.resolve(root)) throw new Error("构建目录不在项目内");
}
rmSync(staging, { recursive: true, force: true });
const compiler = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const result = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json", "--outDir", staging, "--declaration"], {
  cwd: root, stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(path.join(staging, "generated"), { recursive: true });
cpSync(path.join(root, "src/generated/contract.json"), path.join(staging, "generated/contract.json"));
const icon = readFileSync(path.join(root, "assets/icon.svg"));
const { createClientUI } = await import(new URL("../src/client-ui.js", import.meta.url));
const { createActivityNavigation } = await import(new URL("../src/client-navigation.js", import.meta.url));
cpSync(path.join(root, "src/client-ui.js"), path.join(staging, "client-ui.js"));
cpSync(path.join(root, "src/client-navigation.js"), path.join(staging, "client-navigation.js"));
const client = readFileSync(path.join(root, "src/client.js"), "utf8")
  .replace("__SIYUAN_ICON__", `data:image/svg+xml;base64,${icon.toString("base64")}`)
  .replace("__SIYUAN_UI_FACTORY__", () => `(${createClientUI.toString()})`)
  .replace("__SIYUAN_NAVIGATION_FACTORY__", () => `(${createActivityNavigation.toString()})`);
new Script(client, { filename: "client.js" });
writeFileSync(path.join(staging, "client.js"), client, "utf8");
const { SiYuanConnection } = await import(new URL("../.build-lib/connection.js", import.meta.url));
const { createTools } = await import(new URL("../.build-lib/host.js", import.meta.url));
const connection = new SiYuanConnection({});
try {
  if (createTools(connection).length !== 5) throw new Error("构建产物未提供五个工具");
  if (connection.http.contract.endpoints.length !== 697) throw new Error("构建产物缺少完整端点契约");
} finally { await connection.dispose(); }
rmSync(output, { recursive: true, force: true });
renameSync(staging, output);
console.log("Built lib: five tools, 697 contracts, managed host, client and declarations included.");
