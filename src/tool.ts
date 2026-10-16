/** 工具 JSON 校验与文本输出；DSH 类型仅参与开发编译。 */
import Ajv from "ajv";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";

const ajv = new Ajv({ strict: false, allErrors: true });
export interface ToolArgs { [key: string]: unknown }
export type ToolExecution = Partial<Pick<ToolRunContext, "signal" | "callId" | "name" | "agent">> & {
  /** 领域调用可直接传会话 ID；Host 调用从真实 Agent 取得身份。 */
  sessionId?: string;
};
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
/** 常规工具与网关工具共用真实 DSH 输出声明。
 * 显式引用公共类型，让声明生成器保留包名，避免泄漏 pnpm 的内部解析路径。 */
export const summaryOutput: ToolDefinition["output"] = {
  schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
  render: (_args, result) => {
    if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.summary !== "string") {
      throw new Error("思源工具输出缺少 summary");
    }
    return [{ type: "text", text: result.summary }];
  },
};

export function toolDef(name: string, description: string, parameters: Record<string, unknown>,
  run: (args: ToolArgs, signal?: AbortSignal, exec?: ToolExecution) => Promise<unknown>) {
  const validate = ajv.compile<ToolArgs>(parameters);
  return {
    name, description, parameters,
    output: summaryOutput,
    presentCall: (args: unknown) => ({ card: "generic", title: name, kind: "other", rawInput: args }),
    async execute(args: unknown, exec?: ToolExecution): Promise<{ summary: string }> {
      if (!validate(args)) throw new Error(`${name} 参数不合法：${ajv.errorsText(validate.errors)}`);
      exec?.signal?.throwIfAborted();
      return { summary: dump(await run(args, exec?.signal, exec)) };
    },
  } satisfies ToolDefinition;
}
