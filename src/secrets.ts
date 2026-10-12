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
  value(value: unknown): any {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map(item => this.value(item));
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (["image", "audio"].includes(String(record.type))) {
      // 无法从媒体字节证明其中不含凭据，宿主工具只保留媒体说明，不让模型读取其编码或 OCR。
      return { type: record.type, mimeType: record.mimeType, omitted: "媒体字节未投影到模型结果" };
    }
    if (record.encoding === "base64") {
      const key = typeof record.body === "string" ? "body" : typeof record.data === "string" ? "data" : null;
      if (key) {
        const raw = Buffer.from(record[key] as string, "base64").toString("utf8");
        if (this.text(raw) !== raw) {
          return { ...this.value({ ...record, [key]: null }), [key]: "[redacted]", encoding: "utf8", redacted: true };
        }
      }
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [this.text(key),
      /(?:token|secret|password|authorization|cookie|credential|authcode|api[-_]?key|access[-_]?key|private[-_]?key)/i.test(key)
        // credential 的配置状态是安全的人工元信息；不得用同名对象发布原值。
        ? key === "credential" && item && typeof item === "object"
          ? { configured: (item as any).configured === true, writable: (item as any).writable === true }
          : "[redacted]"
        : this.value(item)]));
  }
  error(error: unknown): Error {
    // 不转发 cause/stack/第三方响应对象，它们可能含连接配置、请求头或凭据。
    return new Error(this.text(error instanceof Error ? error.message : String(error)));
  }
}
