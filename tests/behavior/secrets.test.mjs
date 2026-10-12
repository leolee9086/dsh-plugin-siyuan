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
    }
  }
  assert.equal(filter.value({ api: { token: "unknown-remote-token" } }).api.token, "[redacted]");
});
