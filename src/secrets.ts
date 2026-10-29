/** 工具输出、管理结果与错误共用的凭据投影。这个对象从不提供读取秘密的方法。 */
export class SecretFilter {
  #values = new Set<string>();
  remember(secret: string) { if (secret) this.#values.add(secret); }
  private replaceKnown(value: string): string {
    let output = value;
    for (const secret of this.#values) {
      const forms = new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret),
        Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("base64url"),
        Buffer.from(`Token ${secret}`).toString("base64"), Buffer.from(secret).toString("hex"),
        Buffer.from(secret).toString("hex").toUpperCase()]);
      for (const form of [...forms].sort((a, b) => b.length - a.length)) output = output.split(form).join("[redacted]");
    }
    return output;
  }
  text(value: string): string {
    let output = this.replaceKnown(value);
    // 任意 JSON-RPC 文本字段也可能包裹一段编码后的响应；检查整段解码而非只替换编码 token。
    if (value.length >= 8 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      const raw = Buffer.from(value, "base64").toString("utf8");
      if (this.replaceKnown(raw) !== raw) return "[redacted]";
    }
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === "object") {
        const safe = this.value(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(safe)) output = JSON.stringify(safe);
      }
    } catch { /* 普通笔记文字不是 JSON，保持其形式。 */ }
    return output;
  }
  value(value: unknown): unknown {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map(item => this.value(item));
    if (!value || typeof value !== "object") return value;
    if ("encoding" in value && value.encoding === "base64") {
      const payload = "body" in value && typeof value.body === "string" ? { key: "body", text: value.body }
        : "data" in value && typeof value.data === "string" ? { key: "data", text: value.data } : undefined;
      if (payload) {
        const raw = Buffer.from(payload.text, "base64").toString("utf8");
        if (this.text(raw) !== raw) {
          return { ...this.projectRecord({ ...value, [payload.key]: null }),
            [payload.key]: "[redacted]", encoding: "utf8", redacted: true };
        }
      }
    }
    return this.projectRecord(value);
  }
  private projectRecord(value: object): Record<string, unknown> {
    // 凭据由 remember 登记实际值；字段名也用于审批、计数和笔记内容，不能据此删除业务数据。
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [this.text(key), this.value(item)]));
  }
  /** 仅在 MCP 协议定义的内容位置省略媒体，structuredContent 和资源数据仍按业务值处理。 */
  mcp(value: unknown, method: string): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    const content = (item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const block = item as Record<string, unknown>;
      if ((block.type === "image" || block.type === "audio") && typeof block.data === "string") {
        return { type: block.type, mimeType: block.mimeType, omitted: "媒体字节未投影到模型结果" };
      }
      return item;
    };
    if (method === "tools/call" && Array.isArray(record.content)) {
      return { ...record, content: record.content.map(content) };
    }
    if (method === "prompts/get" && Array.isArray(record.messages)) {
      return { ...record, messages: record.messages.map((message: unknown) => {
        if (!message || typeof message !== "object" || Array.isArray(message) || !("content" in message)) return message;
        return { ...message, content: content(message.content) };
      }) };
    }
    return value;
  }
  error(error: unknown): Error {
    const seen = new Map<object, Error>();
    const project = (input: unknown): Error => {
      if (!input || typeof input !== "object") return new Error(this.text(String(input)));
      const previous = seen.get(input);
      if (previous) return previous;
      // 只复制诊断字段；请求、响应和连接对象不属于错误的输出契约。
      const result = new Error(this.text("message" in input ? String(input.message) : String(input)));
      seen.set(input, result);
      if ("name" in input && typeof input.name === "string") result.name = this.text(input.name);
      if ("stack" in input && typeof input.stack === "string") result.stack = this.text(input.stack);
      if ("code" in input && (typeof input.code === "string" || typeof input.code === "number")) {
        Object.defineProperty(result, "code", { value: this.value(input.code), enumerable: true });
      }
      if ("cause" in input) result.cause = project(input.cause);
      if ("errors" in input && Array.isArray(input.errors)) {
        Object.defineProperty(result, "errors", { value: input.errors.map(project), enumerable: true });
      }
      return result;
    };
    return project(error);
  }
  /** 活动记录和 HTTP 错误以文本落盘，显式展开原因链才能跨过 JSON 的 Error 字段省略。 */
  errorText(error: unknown): string {
    const seen = new Set<Error>();
    const render = (item: Error): string => {
      if (seen.has(item)) return "[重复错误引用]";
      seen.add(item);
      const code = "code" in item ? ` [code=${String(item.code)}]` : "";
      const parts = [`${item.name}: ${item.message}${code}`];
      if (item.stack) parts.push(item.stack);
      if (item.cause instanceof Error) parts.push(`Caused by: ${render(item.cause)}`);
      if ("errors" in item && Array.isArray(item.errors)) {
        for (const child of item.errors) if (child instanceof Error) parts.push(`Aggregate: ${render(child)}`);
      }
      return parts.join("\n");
    };
    return render(this.error(error));
  }
}
