/** Markdown 目录树导入：纯规划与内核调用分开，规划部分不碰网络。 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolArgs } from "./tool.js";
import { toolDef, requiredText, requiredId } from "./tool.js";

export type ImportMode = "create" | "replace";

export interface ImportEntry {
  /** 相对 sourceDir 的 POSIX 路径 */
  rel: string;
  title: string;
  hpath: string;
}

export interface ImportPlan {
  kind: "create" | "update" | "skip";
  entry: ImportEntry;
  docId?: string;
}

/** 文档标题取文件名去掉扩展名；嵌套层级由目录给出。 */
export function docTitle(rel: string): string {
  return path.posix.basename(rel).replace(/\.(md|markdown)$/i, "");
}

/** 目标前缀加相对路径拼成文档 hpath；空段与 "." 段不进入路径。 */
export function docHPath(targetPath: string, rel: string): string {
  const base = targetPath.replace(/^\/+|\/+$/g, "");
  const dir = path.posix.dirname(rel);
  const parts = [base, dir === "." ? "" : dir, docTitle(rel)].filter(Boolean);
  return "/" + parts.join("/");
}

/** hpath 的逐级祖先，从根到最深，含自身。 */
export function ancestorsOf(hpath: string): string[] {
  const segments = hpath.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  return segments.map((_, index) => "/" + segments.slice(0, index + 1).join("/"));
}

/** 相对路径必须是 sourceDir 内的 markdown 文件，越界路径直接报错。 */
export function checkRelative(rel: string): string {
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`相对路径越出 sourceDir：${rel}`);
  }
  if (!/\.(md|markdown)$/i.test(normalized)) throw new Error(`不是 markdown 文件：${rel}`);
  return normalized;
}

/** 按现有文档决定每个文件是新建、覆盖还是跳过。 */
export function planImport(relatives: readonly string[], targetPath: string,
  existing: ReadonlyMap<string, string>, mode: ImportMode): ImportPlan[] {
  return relatives.map(raw => {
    const rel = checkRelative(raw);
    const entry = { rel, title: docTitle(rel), hpath: docHPath(targetPath, rel) };
    const docId = existing.get(entry.hpath);
    if (docId === undefined) return { kind: "create", entry };
    return mode === "replace" ? { kind: "update", entry, docId } : { kind: "skip", entry, docId };
  });
}

/** 逆归收集 markdown 文件，返回排序后的相对路径。 */
export async function markdownFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    signal?.throwIfAborted();
    const entries = await readdir(path.join(root, dir), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(rel, rel);
      else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) found.push(rel);
    }
  };
  await walk("", "");
  return found;
}

/** 只读接口的体积边界：单篇超过 4 MiB 的笔记不当作可导文本。 */
const MAX_BYTES = 4 * 1024 * 1024;

type Kernel = (endpoint: string, payload: ToolArgs, signal?: AbortSignal) => Promise<unknown>;

async function existingIds(kernel: Kernel, notebook: string, hpaths: readonly string[], signal?: AbortSignal) {
  const map = new Map<string, string>();
  for (const hpath of hpaths) {
    const ids = await kernel("/api/filetree/getIDsByHPath", { notebook, path: hpath }, signal);
    if (!Array.isArray(ids)) throw new Error("getIDsByHPath 响应应为数组");
    if (ids.length > 0) map.set(hpath, String(ids[0]));
  }
  return map;
}

/** 自动导入工具：把一个 markdown 目录树写成思源文档树，重复执行不重建已存在的文档。 */
export function docImportTool(kernel: Kernel) {
  return toolDef("siyuan_import",
    "批量导入：把本机 markdown 目录树写成思源文档树。目录层级映射为文档层级，文件名（去掉 .md）为标题；目标前缀会逐层补建。mode=create 只建缺失的文档，mode=replace 用文件内容整篇替换同名文档。",
    { type: "object", additionalProperties: false, required: ["action", "notebook", "sourceDir", "targetPath"], properties: {
      action: { type: "string", enum: ["tree"] },
      notebook: { type: "string", pattern: "^\\d{14}-[0-9a-z]{7}$" },
      sourceDir: { type: "string" },
      targetPath: { type: "string", pattern: "^/" },
      mode: { type: "string", enum: ["create", "replace"] },
    } },
    async (args: ToolArgs, signal?: AbortSignal) => {
      const notebook = requiredId(args, "notebook");
      const sourceDir = requiredText(args, "sourceDir");
      const targetPath = requiredText(args, "targetPath");
      const mode: ImportMode = args.mode === "replace" ? "replace" : "create";
      if (!path.isAbsolute(sourceDir)) throw new Error("sourceDir 必须是绝对路径");

      const relatives = await markdownFiles(sourceDir, signal);
      if (relatives.length === 0) throw new Error(`${sourceDir} 下没有 markdown 文件`);

      // 先补齐目标前缀的每一层：中途缺一级就建一篇同名的空文档。
      const created: string[] = [];
      const prefixes = ancestorsOf(targetPath);
      for (const hpath of prefixes) {
        signal?.throwIfAborted();
        const ids = await kernel("/api/filetree/getIDsByHPath", { notebook, path: hpath }, signal);
        if (!Array.isArray(ids)) throw new Error("getIDsByHPath 响应应为数组");
        if (ids.length > 0) continue;
        await kernel("/api/filetree/createDocWithMd", { notebook, path: hpath, markdown: "" }, signal);
        created.push(hpath);
      }

      const entries = relatives.map(checkRelative);
      const existing = await existingIds(kernel, notebook, entries.map(rel => docHPath(targetPath, rel)), signal);
      const plan = planImport(entries, targetPath, existing, mode);

      const updated: string[] = [];
      const skipped: string[] = [];
      for (const step of plan) {
        signal?.throwIfAborted();
        const absolute = path.join(sourceDir, ...step.entry.rel.split("/"));
        if (step.kind === "skip") { skipped.push(step.entry.hpath); continue; }
        const bytes = await readFile(absolute, { signal });
        if (bytes.byteLength > MAX_BYTES) throw new Error(`${step.entry.rel} 超过 4 MiB，不当作可导入文本`);
        const markdown = bytes.toString("utf8");
        if (step.kind === "create") {
          await kernel("/api/filetree/createDocWithMd", { notebook, path: step.entry.hpath, markdown }, signal);
          created.push(step.entry.hpath);
          continue;
        }
        await kernel("/api/block/updateBlock", { id: step.docId, dataType: "markdown", data: markdown }, signal);
        updated.push(step.entry.hpath);
      }
      return { files: relatives.length, mode, targetPath, created, updated, skipped };
    });
}
