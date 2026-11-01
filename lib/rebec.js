/**
 * 转换能力来自对接包 `dsh-session-sy`：二进制、加载逻辑和日志格式都在那边，
 * 插件只把会话头和事件搬过去。
 */
import { sessionFromParts, sessionToSy } from "dsh-session-sy";
/** 会话头来自持久化读句柄，按契约就是对象；不是对象说明前提被破坏了。 */
function asHeader(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("会话头不是对象");
    return value;
}
const addon = {
    render: (parts, spin, assets) => sessionToSy(sessionFromParts(asHeader(parts.header), parts.events), spin, assets),
};
export function rebec() {
    return addon;
}
