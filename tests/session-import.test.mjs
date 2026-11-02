import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import {
  crc32, documentPath, importSession, parentPath, resolveTarget, safeTitle, zipSingle,
} from "../lib/session-import.js";

const NOTEBOOK = "20261010154846-7rpmemw";
const SETTINGS_DOC = { id: "20261101120000-bbbbbbb", box: NOTEBOOK, hpath: "/知识库/设置" };

/** 按路径分派的假内核；没写进表里的调用直接失败，免得漏掉的请求被静默吞掉。 */
function kernel(routes) {
  const calls = [];
  return {
    calls,
    call: async (path, payload) => {
      calls.push([path, payload]);
      // 索引刷新是统一前置动作，不参与各用例的路由表。
      if (path === "/api/sqlite/flushTransaction") return null;
      const handler = routes[path];
      if (handler === undefined) throw new Error(`未预期的调用 ${path}`);
      return handler(payload);
    },
  };
}

test("导入目标落在设置文档所在的笔记本和目录", async () => {
  const { call } = kernel({
    "/api/query/sql": () => [SETTINGS_DOC],
    "/api/attr/getBlockAttrs": () => ({ "custom-dsh-import-spin": "true" }),
  });
  assert.deepEqual(await resolveTarget({ call }), { notebook: NOTEBOOK, hpath: "/知识库", spin: true });
});

test("设置文档上的父路径覆盖它自己的目录", async () => {
  const { call } = kernel({
    "/api/query/sql": () => [SETTINGS_DOC],
    "/api/attr/getBlockAttrs": () => ({ "custom-dsh-import-hpath": "/收件箱" }),
  });
  assert.deepEqual(await resolveTarget({ call }), { notebook: NOTEBOOK, hpath: "/收件箱", spin: false });
});

test("设置文档上的属性不合法就报错，不给默认值", async () => {
  const invalid = async attrs => {
    const { call } = kernel({ "/api/query/sql": () => [SETTINGS_DOC], "/api/attr/getBlockAttrs": () => attrs });
    await assert.rejects(resolveTarget({ call }), /custom-dsh-import-hpath|spin/);
  };
  await invalid({ "custom-dsh-import-hpath": "收件箱" });
  await invalid({ "custom-dsh-import-hpath": "/收件箱", "custom-dsh-import-spin": "yes" });
});

test("没有设置文档时落到最新日记所在的笔记本和目录", async () => {
  const { call } = kernel({
    "/api/query/sql": payload => {
      if (payload.stmt.includes("custom-dsh-sessions")) return [];
      if (payload.stmt.includes("custom-dailynote-")) return [{ id: "20261101000000-ccccccc", box: NOTEBOOK, hpath: "/日记/2026/11/2026-11-01" }];
      throw new Error("查询条件不认识");
    },
  });
  assert.deepEqual(await resolveTarget({ call }), { notebook: NOTEBOOK, hpath: "/日记/2026/11", spin: false });
});

test("既没有设置文档也没有日记就报错", async () => {
  const { call } = kernel({ "/api/query/sql": () => [] });
  await assert.rejects(resolveTarget({ call }), /无法确定导入目标/);
});

test("文档标题不制造层级，空标题退回会话 id", () => {
  assert.equal(safeTitle("归档并导入/思源", "session-1"), "归档并导入／思源");
  assert.equal(safeTitle("   ", "session-1"), "session-1");
  assert.equal(safeTitle("a".repeat(200), "session-1").length, 120);
  assert.equal(documentPath("/收件箱/", "标题"), "/收件箱/标题");
});

test("父路径是文档所在的目录，顶层文档的父路径是根", () => {
  assert.equal(parentPath("/知识库/设置"), "/知识库");
  assert.equal(parentPath("/设置"), "/");
  assert.equal(parentPath("/设置/"), "/");
});

test("zip 里只有一个 deflate 条目，能原样解回", () => {
  const name = "会话.sy";
  const body = Buffer.from('{"Type":"NodeDocument"}', "utf8");
  const zip = zipSingle(name, body);
  assert.equal(zip.readUInt32LE(0), 0x04034B50);
  assert.equal(zip.readUInt16LE(8), 8, "压缩方法为 deflate");
  assert.equal(zip.readUInt32LE(14), crc32(body));
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const payloadLength = zip.readUInt32LE(18);
  assert.equal(zip.subarray(30, 30 + nameLength).toString("utf8"), name);
  const start = 30 + nameLength + extraLength;
  assert.deepEqual(inflateRawSync(zip.subarray(start, start + payloadLength)), body);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054B50, "中央目录结束记录");
  assert.equal(zip.readUInt16LE(zip.length - 12), 1, "只记录一个条目");
  assert.equal(crc32(Buffer.from("123456789")), 0xCBF43926);
});

test("导入按目标落盘，并用文档差集读回新文档", async () => {
  const seen = [];
  const { call, calls } = kernel({
    "/api/query/sql": payload => {
      if (payload.stmt.includes("custom-dsh-sessions")) return [SETTINGS_DOC];
      if (payload.stmt.startsWith("SELECT path")) return [{ path: "/parent/设置.sy" }];
      throw new Error(`未预期的查询 ${payload.stmt}`);
    },
    "/api/attr/getBlockAttrs": () => ({}),
    "/api/filetree/getIDsByHPath": payload => {
      if (payload.path === "/知识库") return ["20261010154846-parent1"];
      if (payload.path === "/知识库/一次会话") return ["20261101120000-abcdefg"];
      return [];
    },
  });
  const ports = {
    call,
    readSession: async () => [{ header: { id: "session-1" }, events: [] }],
    render: (parts, spin, assets) => {
      seen.push("render");
      assert.equal(parts.header.id, "session-1");
      assert.equal(spin, false);
      assert.equal(assets, "D:/202610/data/assets");
      // 渲染器给的标题不是界面上的名字，导入必须用调用方传进来的那个。
      return JSON.stringify({ Type: "NodeDocument", Properties: { title: "渲染器截的标题" }, Children: [] });
    },
    assetsDir: async () => "D:/202610/data/assets",
    importZip: async input => {
      seen.push("import");
      calls.push(["import", input.notebook, input.toPath, input.filename]);
    },
  };
  const result = await importSession(ports, { sessionId: "session-1", title: "一次会话" });
  assert.deepEqual(result, { documents: [{ docId: "20261101120000-abcdefg", path: "/知识库/一次会话" }] });
  assert.deepEqual(calls.find(item => item[0] === "import"), ["import", NOTEBOOK, "/parent/设置.sy", "一次会话.sy.zip"]);
});

test("导入后没有新文档算失败，不静默当成功", async () => {
  const { call } = kernel({
    "/api/query/sql": payload => (payload.stmt.includes("custom-dsh-sessions")
      ? [SETTINGS_DOC] : [{ path: "/parent/设置.sy" }]),
    "/api/attr/getBlockAttrs": () => ({}),
    "/api/filetree/getIDsByHPath": payload => (payload.path === "/知识库" ? ["20261010154846-parent1"] : []),
  });
  await assert.rejects(importSession({
    call,
    readSession: async () => [{ header: {}, events: [] }],
    render: () => JSON.stringify({ Type: "NodeDocument", Properties: { title: "t" }, Children: [] }),
    assetsDir: async () => undefined,
    importZip: async () => {},
  }, { sessionId: "session-2", title: "t" }), /没有找到文档/);
});

test("会话太长时按事件分段，每段一篇文档", async () => {
  const { call, calls } = kernel({
    "/api/query/sql": payload => (payload.stmt.includes("custom-dsh-sessions")
      ? [SETTINGS_DOC] : [{ path: "/parent/设置.sy" }]),
    "/api/attr/getBlockAttrs": () => ({}),
    "/api/filetree/getIDsByHPath": payload => {
      if (payload.path === "/知识库") return ["20261010154846-parent1"];
      if (payload.path.startsWith("/知识库/一次会话")) return ["20261101120000-abcdefg"];
      return [];
    },
  });
  const result = await importSession({
    call,
    readSession: async () => [
      { header: {}, events: [] },
      { header: {}, events: [] },
      { header: {}, events: [] },
    ],
    render: () => JSON.stringify({ Type: "NodeDocument", Properties: { title: "x" }, Children: [] }),
    assetsDir: async () => undefined,
    importZip: async input => { calls.push(["import", input.filename]); },
  }, { sessionId: "session-4", title: "一次会话" });
  assert.equal(result.documents.length, 3);
  // 文档名里不能出现「/」：zip 条目名会把它当目录分隔符。
  assert.deepEqual(calls.filter(item => item[0] === "import").map(item => item[1]),
    ["一次会话（1）.sy.zip", "一次会话（2）.sy.zip", "一次会话（3）.sy.zip"]);
});

test("会话读不出来时直接失败", async () => {
  const { call } = kernel({
    "/api/query/sql": () => [SETTINGS_DOC],
    "/api/attr/getBlockAttrs": () => ({}),
  });
  await assert.rejects(importSession({
    call,
    readSession: async () => { throw new Error("会话不存在"); },
    render: () => JSON.stringify({ Type: "NodeDocument", Properties: { title: "t" }, Children: [] }),
    assetsDir: async () => undefined,
    importZip: async () => {},
  }, { sessionId: "session-3", title: "t" }), /会话不存在/);
});
