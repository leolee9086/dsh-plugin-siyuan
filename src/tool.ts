/** 工具边界的 JSON Schema 校验与文本输出；不依赖 DSH 实现包。 */
import Ajv from "ajv";

const ajv = new Ajv({ strict: false, allErrors: true });
export interface ToolArgs { [key: string]: unknown }
export function requiredText(args: ToolArgs, key: string, allowEmpty = false): string {
  const value = args[key];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`${key} 必须为${allowEmpty ? "" : "非空"}字符串`);
  return value;
}
export function optionalText(args: ToolArgs, key: string): string | undefined {
  return args[key] === undefined ? undefined : requiredText(args, key, true);
}
export const ID = /^\d{14}-[0-9a-z]{7}$/;
export function requiredId(args: ToolArgs, key: string): string {
  const value = requiredText(args, key);
  if (!ID.test(value)) throw new Error(`${key} 不是合法思源 ID`);
  return value;
}
export function contentType(args: ToolArgs): string {
  const value = args.dataType ?? "markdown";
  if (value !== "markdown" && value !== "dom") throw new Error("dataType 必须为 markdown 或 dom");
  return value;
}
export function dump(value: unknown): string {
  if (value === undefined) throw new Error("操作未返回结果");
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
export function toolDef(name: string, description: string, parameters: Record<string, unknown>,
  run: (args: ToolArgs, signal?: AbortSignal) => Promise<unknown>) {
  const validate = ajv.compile(parameters);
  return {
    name, description, parameters,
    output: {
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
      render: (_args: unknown, result: { summary: string }) => [{ type: "text", text: result.summary }],
    },
    presentCall: (args: unknown) => ({ card: "generic", title: name, kind: "other", rawInput: args }),
    async execute(args: ToolArgs, exec?: { signal?: AbortSignal }): Promise<{ summary: string }> {
      if (!validate(args)) throw new Error(`${name} 参数不合法：${ajv.errorsText(validate.errors)}`);
      exec?.signal?.throwIfAborted();
      return { summary: dump(await run(args, exec?.signal)) };
    },
  };
}
