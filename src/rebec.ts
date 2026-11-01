/**
 * 转换能力来自对接包 `dsh-session-sy`：二进制、加载逻辑和日志格式都在那边，
 * 插件只把会话头和事件搬过去。
 */
import { sessionFromParts, sessionToSy } from "dsh-session-sy";
import type { SessionParts } from "./session-import.js";

export interface RebecAddon {
  /** 会话头与事件 → .sy 文档 JSON 文本。 */
  render(parts: SessionParts, spin: boolean, assets: string | undefined): string;
}

/** 会话头来自持久化读句柄，按契约就是对象；不是对象说明前提被破坏了。 */
function asHeader(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("会话头不是对象");
  return value as Record<string, unknown>;
}

const addon: RebecAddon = {
  render: (parts, spin, assets) => sessionToSy(sessionFromParts(asHeader(parts.header), parts.events), spin, assets),
};

export function rebec(): RebecAddon {
  return addon;
}
