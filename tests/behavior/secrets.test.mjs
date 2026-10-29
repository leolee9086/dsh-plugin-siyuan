import test from "node:test";
import assert from "node:assert/strict";
import { SecretFilter } from "../../lib/secrets.js";

test("跨核心秘密、JSON文本、整段编码、WS二进制及错误被安全投影", () => {
  const filter = new SecretFilter(); const secrets = ['a-"private-secret', "other-core-secret"];
  secrets.forEach(value => filter.remember(value));
  for (const secret of secrets) {
    const encoded = Buffer.from("prefix " + secret + " suffix").toString("base64");
    for (const result of [filter.value({ value: secret }), filter.value({ text: JSON.stringify({ apiToken: secret }) }),
      filter.value({ encoding: "base64", body: encoded }), filter.value({ binary: true, encoding: "base64", data: encoded }),
      filter.error(new Error("failed " + secret)).message]) {
      const text = JSON.stringify(result); assert.equal(text.includes(secret), false); assert.equal(text.includes(encoded), false);
      assert.ok(text.includes("[redacted]"));
    }
    for (const value of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret),
      Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("base64url"),
      Buffer.from(`Token ${secret}`).toString("base64"), Buffer.from(secret).toString("hex"),
      Buffer.from(secret).toString("hex").toUpperCase()]) {
      assert.equal(filter.value({ arbitrary: value }).arbitrary, "[redacted]");
    }
    assert.deepEqual(filter.value({ headers: { Authorization: `Token ${secret}` }, nested: [secret] }),
      { headers: { Authorization: "Token [redacted]" }, nested: ["[redacted]"] });
  }
});

test("错误保留原始调用帧、错误码、原因链与聚合分支，并脱敏且不携带请求对象", () => {
  const filter = new SecretFilter();
  const secret = "diagnostic-private-credential";
  filter.remember(secret);
  const cause = Object.assign(new TypeError(`failed ${secret}`), { code: "ECONNRESET", request: { secret } });
  cause.stack = `TypeError: failed ${secret}\n    at originalCall (source.ts:12:7)`;
  const original = new AggregateError([cause], "operation failed", { cause });
  cause.cause = original;
  const projected = filter.error(original);
  assert.equal(projected.name, "AggregateError");
  assert.equal(projected.cause.name, "TypeError");
  assert.equal(projected.cause.code, "ECONNRESET");
  assert.equal(projected.cause.request, undefined);
  assert.equal(projected.cause.cause, projected);
  assert.equal(projected.errors[0], projected.cause);
  assert.match(projected.cause.stack, /originalCall \(source.ts:12:7\)/);
  const text = filter.errorText(projected);
  assert.match(text, /ECONNRESET/);
  assert.match(text, /Caused by:/);
  assert.match(text, /originalCall/);
  assert.match(text, /Aggregate:/);
  assert.ok(!text.includes(secret));
  assert.ok(text.includes("[redacted]"));
  assert.equal(filter.errorText(filter.error(projected)), text);
  assert.ok(cause.message.includes(secret));
});

test("跨 realm 错误与非 Error 抛出值保留诊断", () => {
  const filter = new SecretFilter();
  const projected = filter.error({ name: "TypeError", message: "missing index", stack: "at external.js:35:12", code: 42 });
  assert.equal(projected.name, "TypeError");
  assert.equal(projected.stack, "at external.js:35:12");
  assert.equal(projected.code, 42);
  assert.equal(filter.error("plain failure").message, "plain failure");
});

test("字段名不决定保密，所有原敏感词对应的业务类型及嵌套文本保持完整", () => {
  const filter = new SecretFilter(); filter.remember("fixture-registered-credential");
  const keys = ["token", "secret", "password", "authorization", "cookie", "credential", "authcode", "apiKey", "api_key",
    "access-key", "privateKey", "tokenCount", "passwordLength", "authorizationPolicy", "cookieEnabled", "secretary"];
  const values = [null, false, 42, "普通业务文字", [], [{ endpointKey: "endpoint", decision: "allow", outcome: "endpoint-allowed" }],
    { configured: true, writable: false, description: "凭据配置说明" }];
  for (const key of keys) for (const value of values) {
    const input = { [key]: value }; const before = structuredClone(input);
    assert.deepEqual(filter.value(input), input, key);
    assert.equal(filter.text(JSON.stringify(input)), JSON.stringify(input), key);
    assert.deepEqual(input, before);
  }
  const data = { type: "image", data: "普通业务数据", width: 100, nested: { type: "audio", duration: 20 },
    encoding: "base64", body: Buffer.from('{"tokenCount":42}').toString("base64") };
  assert.deepEqual(filter.value(data), data);
});

test("媒体省略只应用于 MCP 明确内容位置，业务数据与资源内容保留", () => {
  const filter = new SecretFilter(); filter.remember("fixture-mcp-credential");
  const media = { type: "image", mimeType: "image/png", data: "fixture-media-bytes" };
  const omitted = { type: "image", mimeType: "image/png", omitted: "媒体字节未投影到模型结果" };
  const response = { content: [media, { type: "text", text: "fixture-mcp-credential" }], structuredContent: media };
  const before = structuredClone(response);
  assert.deepEqual(filter.value(filter.mcp(response, "tools/call")), {
    content: [omitted, { type: "text", text: "[redacted]" }], structuredContent: media,
  });
  assert.deepEqual(response, before);
  assert.deepEqual(filter.mcp({ messages: [{ role: "user", content: media }] }, "prompts/get"),
    { messages: [{ role: "user", content: omitted }] });
  for (const method of ["tools/list", "resources/read", "custom"]) assert.deepEqual(filter.mcp(response, method), response);
  assert.deepEqual(filter.value({ content: [media] }), { content: [media] });
  assert.deepEqual(filter.mcp({ content: [{ type: "audio", duration: 10 }] }, "tools/call"),
    { content: [{ type: "audio", duration: 10 }] });
});
