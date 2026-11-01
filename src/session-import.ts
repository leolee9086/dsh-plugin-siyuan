/**
 * 会话导入思源：规范日志 → rebec 渲染 .sy → 打包 zip → `/api/import/importSY`。
 *
 * 导入目标不写在插件配置里，而是由思源里已有的笔记决定：优先用最新的
 * `custom-dsh-sessions` 文档（就落在它所在的笔记本和目录），没有就落到最新日记所在的笔记本和目录。
 * 这里只做编排与格式转换，不碰 Cordis 服务：内核调用、日志读取、渲染都通过参数传入。
 */
import { deflateRawSync } from "node:zlib";

/** 导入目标：笔记本与父路径都指向思源里已经存在的文档，spin 决定是否保留原始事件。 */
export interface ImportTarget {
  /** 目标笔记本 id。 */
  notebook: string;
  /** 目标父路径，以 / 开头。 */
  hpath: string;
  /** 是否把原始事件挂到 callout 上（可还原）。 */
  spin: boolean;
}

/** 标记「导入设置文档」的属性名；有它就按这篇文档的位置导入。 */
const SESSIONS_ATTR = "custom-dsh-sessions";
/** 设置文档上可选的父路径覆盖。 */
const HPATH_ATTR = "custom-dsh-import-hpath";
/** 设置文档上可选的 spin 开关。 */
const SPIN_ATTR = "custom-dsh-import-spin";

/** 一段会话：头与按序事件，都保持原始 JSON，不在插件里重塑。 */
export interface SessionParts {
  header: unknown;
  events: readonly unknown[];
}

/** 导入需要的全部外部能力：内核调用与上传由上层按核心注入，本模块不认识 Cordis。 */
export interface ImportPorts {
  /** 在已绑定的内核上执行一次调用，返回内核信封里的 data。 */
  call: (path: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
  /** 读会话的头与事件；会话不存在时抛错。 */
  readSession: (sessionId: string, signal?: AbortSignal) => Promise<SessionParts>;
  /** rebec：会话头与事件 → .sy 文档 JSON 文本。 */
  render: (parts: SessionParts, spin: boolean, assets: string | undefined) => string;
  /** 工作区资源目录（<workspaceDir>/data/assets）；取不到就不落图片。 */
  assetsDir: (signal?: AbortSignal) => Promise<string | undefined>;
  /** 把 zip 交给 `/api/import/importSY`。 */
  importZip: (input: { notebook: string; toPath: string; filename: string; bytes: Uint8Array }, signal?: AbortSignal) => Promise<void>;
}

export interface ImportRequest {
  sessionId: string;
  /** 会话标题，用作文档名。 */
  title: string;
  signal?: AbortSignal;
}

export interface ImportResult {
  docId: string;
  path: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}应为对象`);
  return value as Record<string, unknown>;
}

/** 文档标题里不能出现路径分隔符；换成全角斜杠，保持可读且不改层级。 */
export function safeTitle(title: string, fallback: string): string {
  const text = title.trim() === "" ? fallback : title;
  return text.replace(/[\\/:*?"<>|]/g, character => character === "/" ? "／" : "_").slice(0, 120);
}

/** 文档所在的目录；顶层文档的父路径是根。 */
export function parentPath(hpath: string): string {
  const cut = hpath.replace(/\/+$/, "").lastIndexOf("/");
  return cut <= 0 ? "/" : hpath.slice(0, cut);
}

/** 文档在思源里的完整路径。 */
export function documentPath(hpath: string, title: string): string {
  return `${hpath.replace(/\/+$/, "")}/${title}`;
}

/** 最新一篇带指定属性的文档；没有就返回 undefined，不猜默认位置。 */
async function latestDocument(ports: Pick<ImportPorts, "call">, attribute: string, signal?: AbortSignal) {
  const rows = await ports.call("/api/query/sql", {
    stmt: `SELECT id, box, hpath FROM blocks WHERE type = 'd' AND ial LIKE '%${attribute}%' ORDER BY created DESC LIMIT 1`,
  }, signal);
  if (!Array.isArray(rows)) throw new Error("文档查询应返回块数组");
  if (rows.length === 0) return undefined;
  const row = record(rows[0], "文档查询结果");
  if (typeof row.id !== "string" || typeof row.box !== "string" || typeof row.hpath !== "string") {
    throw new Error("文档查询结果缺少 id、box 或 hpath");
  }
  return { id: row.id, notebook: row.box, hpath: row.hpath };
}

/**
 * 决定这次导入落到哪里。
 *
 * 设置文档的位置就是目标位置，文档上的 `custom-dsh-import-hpath` 与 `custom-dsh-import-spin`
 * 可以覆盖父路径和 spin。没有设置文档时用最新日记所在的笔记本和目录，spin 默认关。
 */
export async function resolveTarget(ports: Pick<ImportPorts, "call">, signal?: AbortSignal): Promise<ImportTarget> {
  // 刚写下的设置文档要先过完事务和索引队列，才查得到。
  await ports.call("/api/sqlite/flushTransaction", {}, signal);
  const settings = await latestDocument(ports, SESSIONS_ATTR, signal);
  if (settings !== undefined) {
    const attrs = record(await ports.call("/api/attr/getBlockAttrs", { id: settings.id }, signal), "设置文档属性");
    const hpath = attrs[HPATH_ATTR];
    if (hpath !== undefined && (typeof hpath !== "string" || !hpath.startsWith("/"))) {
      throw new Error(`${HPATH_ATTR} 必须以 / 开头`);
    }
    const spin = attrs[SPIN_ATTR];
    if (spin !== undefined && spin !== "true" && spin !== "false") {
      throw new Error(`${SPIN_ATTR} 只能为 true 或 false`);
    }
    return {
      notebook: settings.notebook,
      hpath: typeof hpath === "string" ? hpath : parentPath(settings.hpath),
      spin: spin === "true",
    };
  }
  const daily = await latestDocument(ports, "custom-dailynote-", signal);
  if (daily === undefined) {
    throw new Error(`没有 ${SESSIONS_ATTR} 设置文档，也没有日记文档，无法确定导入目标`);
  }
  return { notebook: daily.notebook, hpath: parentPath(daily.hpath), spin: false };
}

/**
 * 父路径对应的文档文件路径。
 *
 * importSY 的 toPath 要的是父文档的文件路径（`/20261011135832-xxx.sy`），不是 hpath：
 * 传 hpath 时不报错也不建文档（本机 3.8.9 实测）。所以先按 hpath 找到父文档 id，再取它的 path。
 */
async function parentFile(ports: Pick<ImportPorts, "call">, notebook: string, hpath: string, signal?: AbortSignal) {
  if (hpath === "/") return "/";
  const ids = await ports.call("/api/filetree/getIDsByHPath", { notebook, path: hpath }, signal);
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(`父路径 ${hpath} 在思源里没有对应文档`);
  const parentId = ids[0];
  if (typeof parentId !== "string") throw new Error("父文档 id 不是字符串");
  const rows = await ports.call("/api/query/sql", { stmt: `SELECT path FROM blocks WHERE id = '${parentId}'` }, signal);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`父文档 ${parentId} 没有文件路径`);
  const parent = record(rows[0], "父文档行");
  if (typeof parent.path !== "string") throw new Error("父文档缺少文件路径");
  return parent.path;
}

/**
 * 用调用方给的会话标题当文档名。
 *
 * 思源拿 .sy 的 Properties.title 作为文档名，而 rebec 自己截的标题是正文里的一段，
 * 不是这轮会话在界面上的名字；解析一次改掉这个字段，比让两边的叫法分叉要好。
 */
function withTitle(sy: string, title: string): string {
  const document = record(JSON.parse(sy) as unknown, "渲染结果");
  const properties = record(document.Properties, "渲染结果的文档属性");
  properties.title = title;
  return JSON.stringify(document);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** 标准 CRC32（zip 头里用的那个）。 */
export function crc32(bytes: Uint8Array): number {
  let value = 0xFFFFFFFF;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 只放一个条目的 zip（deflate）。思源的 `importSY` 只认 zip，不认裸 .sy。
 * 自己写而不是引依赖：只需要「一个文件、一条记录」这一种形态。
 */
export function zipSingle(name: string, bytes: Uint8Array): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const payload = deflateRawSync(bytes);
  const checksum = crc32(bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034B50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014B50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + payload.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([local, nameBytes, payload, central, nameBytes, end]);
}

/**
 * 导入一篇会话。
 *
 * 先记下父路径下已有的文档，再导入，最后按 id 差集找出新文档——`importSY` 不返回文档 id，
 * 只能这样读回。找不到新文档就当失败，不静默返回成功。
 */
export async function importSession(ports: ImportPorts, request: ImportRequest): Promise<ImportResult> {
  const { sessionId, title, signal } = request;
  const target = await resolveTarget(ports, signal);
  const parts = await ports.readSession(sessionId, signal);
  const name = safeTitle(title, sessionId);
  const sy = ports.render(parts, target.spin, await ports.assetsDir(signal));
  const toPath = await parentFile(ports, target.notebook, target.hpath, signal);
  // zip 内的 .sy 必须放在一个目录里：放在压缩包根目录时内核直接判定「不是有效的 .sy.zip」（3.8.9 实测）。
  await ports.importZip({
    notebook: target.notebook,
    toPath,
    filename: `${name}.sy.zip`,
    bytes: zipSingle(`parts/${name}.sy`, Buffer.from(withTitle(sy, name), "utf8")),
  }, signal);
  // 导入不返回文档 id，但文档名就是 .sy 的标题，按完整路径能直接读回来。
  const path = documentPath(target.hpath, name);
  const ids = await ports.call("/api/filetree/getIDsByHPath", { notebook: target.notebook, path }, signal);
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(`导入完成，但在 ${path} 没有找到文档`);
  const docId = ids[0];
  if (typeof docId !== "string") throw new Error("文档 id 不是字符串");
  return { docId, path };
}
