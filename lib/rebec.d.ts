import type { SessionParts } from "./session-import.js";
export interface RebecAddon {
    /** 会话头与事件 → .sy 文档 JSON 文本。 */
    render(parts: SessionParts, spin: boolean, assets: string | undefined): string;
}
export declare function rebec(): RebecAddon;
