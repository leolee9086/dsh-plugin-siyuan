import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { ManagementInput as input } from "../../lib/management-input.js";

test("管理变更要求同源 Origin 和 JSON，不依赖假鉴权上下文", () => {
  assert.equal(input.mutationAllowed(undefined, "127.0.0.1:19387"), false);
  assert.equal(input.mutationAllowed("http://other.invalid", "127.0.0.1:19387"), false);
  assert.equal(input.mutationAllowed("http://127.0.0.1:19387", "127.0.0.1:19387"), true);
  input.requireJson("application/json; charset=utf-8");
  for (const type of [undefined, "text/plain", "application/x-www-form-urlencoded"]) assert.throws(() => input.requireJson(type), /application\/json/);
});

test("JSON 字节流支持分块中文，拒绝无效对象且错误不反射请求", async () => {
  const raw = Buffer.from(JSON.stringify({ name: "本机", action: "saveKernel", token: "fixture-only-secret" }));
  const parsed = await input.body(Readable.from([raw.subarray(0, 10), raw.subarray(10)]));
  assert.equal(parsed.name, "本机"); assert.equal(parsed.action, "saveKernel");
  for (const value of ["{broken fixture-secret", "null", "[]", '"text"']) {
    await assert.rejects(input.body(Readable.from([Buffer.from(value)])), error => /JSON 对象/.test(error.message) && !error.message.includes("fixture-secret"));
  }
});

test("请求体按实际字节计数，64KiB 边界通过、超限拒绝", async () => {
  const boundary = Buffer.from(JSON.stringify({ x: "a".repeat(65528) })); assert.equal(boundary.length, 65536);
  assert.equal((await input.body(Readable.from([boundary]))).x.length, 65528);
  await assert.rejects(input.body(Readable.from([boundary, Buffer.from(" ")])), /64KiB/);
});

test("查询和分页参数校验独立于管理器，非法输入直接报错", () => {
  assert.deepEqual(input.query(new URLSearchParams()), { view: "state" });
  const parsed = input.query(new URLSearchParams("view=endpoints&kernelId=local&query=echo&offset=40&limit=20"));
  assert.equal(parsed.kernelId, "local"); assert.equal(parsed.filter.query, "echo"); assert.equal(parsed.filter.offset, 40); assert.equal(parsed.filter.limit, 20);
  for (const query of ["view=endpoints&kernelId=local&offset=NaN", "view=endpoints&kernelId=local&limit=-1", "view=activity&sessionId=s&offset=1.5", "view=endpoints", "view=unknown"]) {
    assert.throws(() => input.query(new URLSearchParams(query)));
  }
});
