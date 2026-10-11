/** 工具边界的 JSON Schema 校验与文本输出；不依赖 DSH 实现包。 */
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
export function toolDef(name, description, parameters, run) {
    const validate = ajv.compile(parameters);
    return {
        name, description, parameters,
        output: {
            schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
            render: (_args, result) => [{ type: "text", text: result.summary }],
        },
        presentCall: (args) => ({ card: "generic", title: name, kind: "other", rawInput: args }),
        async execute(args, exec) {
            if (!validate(args))
                throw new Error(`${name} 参数不合法：${ajv.errorsText(validate.errors)}`);
            exec?.signal?.throwIfAborted();
            return { summary: dump(await run(args, exec?.signal)) };
        },
    };
}
