/** 目录树导入的纯规划函数：路径映射、祖先补齐与新建/覆盖/跳过决策。 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ancestorsOf, checkRelative, docHPath, docTitle, markdownFiles, planImport,
} from "../lib/doc-import.js";

test("标题取文件名并去掉 markdown 扩展名", () => {
  assert.equal(docTitle("agent-experience.md"), "agent-experience");
  assert.equal(docTitle("nested/host-plugin.markdown"), "host-plugin");
  assert.equal(docTitle("cordis.patch.yml.md"), "cordis.patch.yml");
});

test("hpath 保留目录层级并去掉多余的斜杠", () => {
  assert.equal(docHPath("/个人笔记/技能迁移", "agent-experience.md"),
    "/个人笔记/技能迁移/agent-experience");
  assert.equal(docHPath("/个人笔记/技能迁移/", "references/host-plugin.md"),
    "/个人笔记/技能迁移/references/host-plugin");
  assert.equal(docHPath("/个人笔记", "deep/pkg.md"), "/个人笔记/deep/pkg");
});

test("祖先从根到自身逐层给出", () => {
  assert.deepEqual(ancestorsOf("/个人笔记/技能迁移/创造模式"),
    ["/个人笔记", "/个人笔记/技能迁移", "/个人笔记/技能迁移/创造模式"]);
  assert.deepEqual(ancestorsOf("/单独一层"), ["/单独一层"]);
});

test("越界与非 markdown 相对路径直接报错", () => {
  assert.throws(() => checkRelative("../外泄.md"), /越出 sourceDir/);
  assert.throws(() => checkRelative("a/../../b.md"), /越出 sourceDir/);
  assert.throws(() => checkRelative("/abs.md"), /越出 sourceDir/);
  assert.throws(() => checkRelative("notes.txt"), /不是 markdown 文件/);
  assert.equal(checkRelative("a\\b.md"), "a/b.md");
});

test("已有文档按模式决定覆盖还是跳过", () => {
  const existing = new Map([["/目标/agent-experience", "20260101000000-aaaaaaa"]]);
  const create = planImport(["agent-experience.md", "new.md"], "/目标", existing, "create");
  assert.deepEqual(create.map(step => step.kind), ["skip", "create"]);
  assert.equal(create[0].docId, "20260101000000-aaaaaaa");
  const replace = planImport(["agent-experience.md"], "/目标", existing, "replace");
  assert.deepEqual(replace.map(step => step.kind), ["update"]);
});

test("目录逆归只收 markdown 且按名称排序", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-import-"));
  try {
    await mkdir(path.join(root, "references"), { recursive: true });
    await writeFile(path.join(root, "b.md"), "# b");
    await writeFile(path.join(root, "a.md"), "# a");
    await writeFile(path.join(root, "skip.txt"), "x");
    await writeFile(path.join(root, "references", "host-plugin.md"), "# h");
    assert.deepEqual(await markdownFiles(root), ["a.md", "b.md", "references/host-plugin.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
