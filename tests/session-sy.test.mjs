import test from "node:test";
import assert from "node:assert/strict";
import { sessionFromJsonl, sessionToSy, version } from "dsh-session-sy";

test("对接包能加载原生扩展并完成文本转换", () => {
  assert.match(version(), /^\d+\.\d+\.\d+/);
  const text = [
    JSON.stringify({ type: "session", id: "session-1", createdAt: 1, isSeeded: false }),
    JSON.stringify({ type: "user/message", seq: 0, data: { content: [{ type: "text", text: "你好" }] } }),
  ].join("\n") + "\n";
  const session = JSON.parse(sessionFromJsonl(text));
  assert.equal(session.header.id, "session-1");
  assert.equal(session.events.length, 1);
  const document = JSON.parse(sessionToSy(sessionFromJsonl(text)));
  assert.equal(document.Type, "NodeDocument");
});
