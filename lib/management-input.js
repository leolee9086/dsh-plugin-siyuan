/** 人工管理请求的数据边界。输入为普通值或字节流，不访问宿主上下文。 */
function required(value) {
    if (typeof value !== "string" || !value || value.length > 4096)
        throw new Error("缺少有效标识");
    return value;
}
function page(params, key, fallback) {
    const raw = params.get(key);
    const value = raw === null ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error("分页参数无效");
    return value;
}
function query(params) {
    switch (params.get("view") ?? "state") {
        case "state": return { view: "state" };
        case "endpoints": return { view: "endpoints", kernelId: required(params.get("kernelId")), filter: {
                query: params.get("query") ?? "", protocol: params.get("protocol") ?? "",
                method: params.get("method") ?? "", decision: params.get("decision") ?? "",
                offset: page(params, "offset", 0), limit: page(params, "limit", 40),
            } };
        case "activity": return { view: "activity", sessionId: required(params.get("sessionId")), offset: page(params, "offset", 0) };
        default: throw new Error("未知管理视图");
    }
}
function mutationAllowed(origin, host) {
    return !!origin && new URL(origin).host === host;
}
function requireJson(contentType) {
    if (!contentType?.startsWith("application/json"))
        throw new Error("需要 application/json");
}
async function body(chunks) {
    const buffers = [];
    let size = 0;
    for await (const chunk of chunks) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > 65536)
            throw new Error("管理请求超过64KiB");
        buffers.push(buffer);
    }
    let value;
    try {
        value = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    }
    catch {
        throw new Error("管理请求必须为 JSON 对象");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("管理请求必须为 JSON 对象");
    return value;
}
export const ManagementInput = Object.freeze({ required, query, mutationAllowed, requireJson, body });
