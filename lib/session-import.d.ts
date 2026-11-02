/** 导入目标：笔记本与父路径都指向思源里已经存在的文档，spin 决定是否保留原始事件。 */
export interface ImportTarget {
    /** 目标笔记本 id。 */
    notebook: string;
    /** 目标父路径，以 / 开头。 */
    hpath: string;
    /** 是否把原始事件挂到 callout 上（可还原）。 */
    spin: boolean;
}
/** 一段会话：头与按序事件，都保持原始 JSON，不在插件里重塑。 */
export interface SessionParts {
    header: unknown;
    events: readonly unknown[];
}
/** 导入需要的全部外部能力：内核调用与上传由上层按核心注入，本模块不认识 Cordis。 */
export interface ImportPorts {
    /** 在已绑定的内核上执行一次调用，返回内核信封里的 data。 */
    call: (path: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
    /** 读会话的头与事件；大会话按事件区间分成多段，会话不存在时抛错。 */
    readSession: (sessionId: string, signal?: AbortSignal) => Promise<SessionParts[]>;
    /** rebec：会话头与事件 → .sy 文档 JSON 文本。 */
    render: (parts: SessionParts, spin: boolean, assets: string | undefined) => string;
    /** 工作区资源目录（<workspaceDir>/data/assets）；取不到就不落图片。 */
    assetsDir: (signal?: AbortSignal) => Promise<string | undefined>;
    /** 把 zip 交给 `/api/import/importSY`。 */
    importZip: (input: {
        notebook: string;
        toPath: string;
        filename: string;
        bytes: Uint8Array;
    }, signal?: AbortSignal) => Promise<void>;
}
export interface ImportRequest {
    sessionId: string;
    /** 会话标题，用作文档名。 */
    title: string;
    signal?: AbortSignal;
}
/** 导入出来的一篇文档。 */
export interface ImportDocument {
    docId: string;
    path: string;
}
/** 一次导入的产物：会话太长时会拆成多篇，一篇对应一段事件。 */
export interface ImportResult {
    documents: ImportDocument[];
}
/** 文档标题里不能出现路径分隔符；换成全角斜杠，保持可读且不改层级。 */
export declare function safeTitle(title: string, fallback: string): string;
/** 文档所在的目录；顶层文档的父路径是根。 */
export declare function parentPath(hpath: string): string;
/** 文档在思源里的完整路径。 */
export declare function documentPath(hpath: string, title: string): string;
/**
 * 决定这次导入落到哪里。
 *
 * 设置文档的位置就是目标位置，文档上的 `custom-dsh-import-hpath` 与 `custom-dsh-import-spin`
 * 可以覆盖父路径和 spin。没有设置文档时用最新日记所在的笔记本和目录，spin 默认关。
 */
export declare function resolveTarget(ports: Pick<ImportPorts, "call">, signal?: AbortSignal): Promise<ImportTarget>;
/** 标准 CRC32（zip 头里用的那个）。 */
export declare function crc32(bytes: Uint8Array): number;
/**
 * 只放一个条目的 zip（deflate）。思源的 `importSY` 只认 zip，不认裸 .sy。
 * 自己写而不是引依赖：只需要「一个文件、一条记录」这一种形态。
 */
export declare function zipSingle(name: string, bytes: Uint8Array): Buffer;
/**
 * 导入一段会话，必要时拆成多篇。
 *
 * 一个渲染成几百 MB 的会话没法当一条字符串处理（napi 转不了、V8 也存不下），
 * 所以按事件区间分出来的每一段各渲染一篇文档，标题带序号。
 * `importSY` 不返回文档 id，导入后按完整路径逐篇读回；任一篇读不回来就算失败。
 */
export declare function importSession(ports: ImportPorts, request: ImportRequest): Promise<ImportResult>;
