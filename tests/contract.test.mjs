import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { loadContract, ContractError } from "../lib/contract.js";
import { HttpConnection } from "../lib/http.js";
import { normalizeConfig } from "../lib/api.js";

// 编译全部实际契约，能发现引用悬空、未知 format、Schema 不兼容等真实问题。
test("全部697条请求契约可编译，发现接口返回的引用闭包可独立消费", async () => {
  const contract = loadContract();
  assert.equal(contract.endpoints.length, 697);
  for (const spec of contract.endpoints) {
    try { contract.check(spec, {}); }
    catch (error) { assert.ok(error instanceof ContractError, `${spec.path}: ${error.stack}`); }
    const ajv = new Ajv2020({ strict: false });
    ajv.addFormat("binary", true);
    ajv.compile(contract.requestSchema(spec));
  }
});

test("路由器覆盖每个实际方法、动态参数、HEAD和Gin通配符", async () => {
  const connection = new HttpConnection(normalizeConfig({}));
  try {
    for (const expected of connection.contract.endpoints) {
      const path = expected.path.replace(/:[A-Za-z0-9_]+/g, "sample").replace(/\*[A-Za-z0-9_]+/g, "a/b");
      const actual = await connection.describe(expected.method, path);
      assert.equal(actual.spec?.path, expected.path, `${expected.method} ${path}`);
      assert.equal(actual.spec.method, expected.method);
    }
    const match = await connection.describe("POST", "/api/plugin/rpc/my-plugin");
    assert.equal(match.params.name, "my-plugin");
    assert.equal((await connection.describe("POST", "/future/new-endpoint")).spec, undefined);
  } finally { connection.dispose(); }
});

test("配置拒绝错误值，凭据不放进地址", () => {
  for (const config of [{ apiUrl: "ftp://localhost" }, { apiUrl: "http://name:secret@localhost" },
    { timeoutMs: 0 }, { timeoutMs: 1.5 }, { token: 42 }, { token: "x\ny" }]) {
    assert.throws(() => normalizeConfig(config));
  }
});
