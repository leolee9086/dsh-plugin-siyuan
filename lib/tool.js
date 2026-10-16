/** 工具 JSON 校验与文本输出；DSH 类型仅参与开发编译。 */
import Ajv from "ajv";
const ajv = new Ajv({ strict: false, allErrors: true });
export function requiredText(args, key, allowEmpty = false) {
    const value = args[key];
    if (typeof value !== "string" || (!allowEmpty && !value.trim()))
        throw new Error(`${key} 必须为${allowEmpty ? "" : "非空"}字符串`);
    return value;
}
export function optionalText(args, key) {
    return args[key] === undefined ? undefined : requiredText(args, key, true);
}
export const ID = /^\d{14}-[0-9a-z]{7}$/;
export function requiredId(args, key) {
    const value = requiredText(args, key);
    if (!ID.test(value))
        throw new Error(`${key} 不是合法思源 ID`);
    return value;
}
export function contentType(args) {
    const value = args.dataType ?? "markdown";
    if (value !== "markdown" && value !== "dom")
        throw new Error("dataType 必须为 markdown 或 dom");
    return value;
}
export function dump(value) {
    if (value === undefined)
        throw new Error("操作未返回结果");
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
/** 常规工具与网关工具共用真实 DSH 输出声明。
 * 显式引用公共类型，让声明生成器保留包名，避免泄漏 pnpm 的内部解析路径。 */
export const summaryOutput = {
    schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
    render: (_args, result) => {
        if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.summary !== "string") {
            throw new Error("思源工具输出缺少 summary");
        }
        return [{ type: "text", text: result.summary }];
    },
};
export function toolDef(name, description, parameters, run) {
    const validate = ajv.compile(parameters);
    return {
        name, description, parameters,
        output: summaryOutput,
        presentCall: (args) => ({ card: "generic", title: name, kind: "other", rawInput: args }),
        async execute(args, exec) {
            if (!validate(args))
                throw new Error(`${name} 参数不合法：${ajv.errorsText(validate.errors)}`);
            exec?.signal?.throwIfAborted();
            return { summary: dump(await run(args, exec?.signal, exec)) };
        },
    };
}
