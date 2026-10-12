/** 界面领域入口：组件以明确 props 渲染，网络操作由客户端适配器注入。 */
export function createClientUI(React, { get, post, icon }) {
  const h = React.createElement;
  const labels = { ask: "每次询问，完全权限下拒绝（默认）", "ask-full-access": "每次询问，完全权限下授权", deny: "拒绝", allow: "允许" };
  const states = { checking: "检查中", "awaiting-approval": "等待批准", running: "执行中", succeeded: "成功",
    failed: "失败", partial: "部分失败", denied: "拒绝", uncertain: "结果不确定", sent: "已发送" };
  const approvalLabels = { "endpoint-allowed": "端点允许 · 自动通过", "endpoint-denied": "端点配置 · 拒绝", pending: "待评估询问策略",
    "full-access-denied": "完全权限 · 按端点配置自动拒绝", "full-access-allowed": "完全权限 · 按端点配置自动通过",
    "allowed-once": "宿主批准", "policy-never": "宿主 never 策略 · 自动拒绝", rejected: "宿主拒绝", cancelled: "审批取消", unavailable: "审批不可用" };
  function Icon({ size = 18 }) { return h("img", { src: icon, width: size, height: size, alt: "", "aria-hidden": true }); }
  function button(text, onClick, props = {}) { return h("button", { type: "button", onClick, ...props }, text); }
  function select(value, onChange, options, label, props = {}) {
    return h("select", { value, onChange: event => onChange(event.target.value), "aria-label": label, ...props },
      options.map(([key, text]) => h("option", { key, value: key }, text)));
  }
  function endpointName(item) { return `${item.method} ${item.path} ${item.detail}`.trim(); }
  const emptyForm = () => ({ name: "", apiUrl: "auto", timeoutMs: 15000, enabled: true });
  function KernelForm({ kernel, onSaved, busy, perform }) {
    const [form, setForm] = React.useState(() => kernel ? { ...kernel } : emptyForm());
    const token = React.useRef(null);
    const [clearToken, setClearToken] = React.useState(false);
    React.useEffect(() => {
      setForm(kernel ? { ...kernel } : emptyForm());
      setClearToken(false); if (token.current) token.current.value = "";
      // 刷新不覆盖正在编辑的输入，仅切换编辑对象时重置。
    }, [kernel?.id]);
    function field(key, label, type = "text", placeholder = "") {
      return h("label", { className: "sy-field" }, h("span", null, label), h("input", { type, value: form[key] ?? "",
        placeholder, onChange: event => setForm(previous => ({ ...previous, [key]: type === "number" ? Number(event.target.value) : event.target.value })) }));
    }
    function save(event) {
      event.preventDefault(); if (busy) return;
      const secret = clearToken ? "" : token.current?.value ?? "";
      if (token.current) token.current.value = "";
      perform(async () => {
        await post({ action: "saveKernel", id: kernel?.id, name: form.name, apiUrl: form.apiUrl, timeoutMs: form.timeoutMs,
          portFile: form.portFile, kernelPid: form.kernelPid, enabled: form.enabled, token: secret, clearToken });
        setClearToken(false); setForm(emptyForm()); onSaved();
      });
    }
    return h("form", { className: "sy-box sy-form", onSubmit: save, autoComplete: "off" },
      h("h3", null, kernel ? "编辑核心" : "添加核心"), field("name", "名称"), field("apiUrl", "内核地址", "text", "auto 或 https://..."),
      h("p", { className: "sy-note" }, "auto 发现本机思源；远程地址支持代理路径前缀。"),
      field("timeoutMs", "超时（毫秒）", "number"), field("kernelPid", "本机实例 PID（多实例时指定）", "number"),
      field("portFile", "端口登记文件（留空使用系统默认）"),
      h("label", { className: "sy-field" }, h("span", null, "API token"), h("input", { ref: token, type: "password", name: "siyuan-credential",
        autoComplete: "new-password", spellCheck: false, disabled: clearToken || busy || kernel?.credential.writable === false,
        placeholder: kernel?.credential.configured ? "已配置；留空保留，输入新值替换" : "未配置；可留空" })),
      h("label", null, h("input", { type: "checkbox", checked: clearToken, onChange: e => setClearToken(e.target.checked) }), "清除已保存的 token"),
      h("label", null, h("input", { type: "checkbox", checked: form.enabled, onChange: e => setForm({ ...form, enabled: e.target.checked }) }), "启用核心"),
      h("p", { className: "sy-note" }, "凭据保存到本机，不回显。改变地址、PID 或登记文件后，需要重新授权端点。"),
      h("button", { type: "submit", disabled: busy }, busy ? "保存中..." : "保存核心"));
  }
  function Declaration({ perform, onSaved }) {
    const [form, setForm] = React.useState({ protocol: "http", method: "POST", path: "", detail: "", description: "" });
    function input(key, title) { return h("label", { className: "sy-field" }, title, h("input", { value: form[key],
      onChange: e => setForm({ ...form, [key]: e.target.value }) })); }
    return h("details", { className: "sy-box" }, h("summary", null, "声明扩展端点"), h("form", { className: "sy-form", onSubmit: event => {
      event.preventDefault(); perform(async () => { await post({ action: "declare", ...form }); onSaved(); });
    } }, select(form.protocol, protocol => setForm({ ...form, protocol }), [["http", "HTTP"], ["mcp", "MCP"], ["plugin", "插件 RPC"], ["ws", "WS"]], "扩展端点协议"),
      input("method", "方法（HTTP 方法、MCP/RPC 方法、WS connect/send）"), input("path", "路径或插件名称"),
      input("detail", "具体 MCP 工具名或 WS cmd（适用时）"), input("description", "说明"), h("button", { type: "submit" }, "加入目录（不授予权限）")));
  }
  /** 展示组件与加载/异步状态控制分离；测试直接传入可见数据。 */
  function EndpointPanel({ state, kernelId, filter, catalog, pending, busy, perform, change, setKernelId, setFilter, setPending, reload }) {
    const kernel = state.kernels.find(k => k.id === kernelId);
    return h("section", null, h("div", { className: "sy-bar" }, select(kernelId, value => { setKernelId(value); change("offset", 0); }, state.kernels.map(k => [k.id, k.name]), "授权目标核心"),
      button("发现 MCP 工具", () => perform(async () => { const value = await post({ action: "discoverMcp", kernelId }); return `发现 ${value.mcpTools} 个 MCP 工具，未自动授予权限`; }), { disabled: busy || !kernelId })),
      h("p", { className: "sy-note" }, "默认每次询问、完全权限下拒绝；也可单独选择每次询问、完全权限下授权。允许权限覆盖该端点的全部可操作资源；文档和路径范围授权尚未加入。"),
      h("div", { className: "sy-filters" }, h("input", { type: "search", placeholder: "搜索路径、方法、工具名或说明", "aria-label": "搜索端点", value: filter.query, onChange: e => change("query", e.target.value) }),
        select(filter.protocol, value => change("protocol", value), [["", "全部协议"], ["http", "HTTP"], ["mcp", "MCP"], ["plugin", "插件 RPC"], ["ws", "WS"], ["connection", "连接状态"]], "过滤协议"),
        h("input", { placeholder: "方法（如 POST、tools/call）", "aria-label": "过滤方法", value: filter.method, onChange: e => change("method", e.target.value) }),
        select(filter.decision, value => change("decision", value), [["", "全部授权状态"], ...Object.entries(labels)], "过滤授权状态")),
      catalog ? h(React.Fragment, null, h("div", { className: "sy-bar" }, h("span", null, `${kernel?.name ?? ""} · 匹配 ${catalog.total} 个端点 · ${catalog.total ? catalog.offset + 1 : 0}–${Math.min(catalog.offset + catalog.limit, catalog.total)}`),
        button("上一页", () => setFilter({ ...filter, offset: Math.max(0, filter.offset - catalog.limit) }), { disabled: catalog.offset === 0 }),
        button("下一页", () => setFilter({ ...filter, offset: filter.offset + catalog.limit }), { disabled: catalog.offset + catalog.limit >= catalog.total })),
        h("div", { className: "sy-endpoints" }, catalog.items.map(item => h("article", { key: item.key, className: "sy-endpoint" },
          h("div", null, h("span", { className: "sy-tag" }, item.protocol.toUpperCase()), h("strong", { className: "sy-mono" }, endpointName(item)), h("p", { className: "sy-note" }, item.blocked || item.description)),
          h("div", null, select(item.decision, value => setPending({ kernelId, item, decision: value }), Object.entries(labels), `授权 ${endpointName(item)}`, { disabled: busy || !!item.blocked }),
            pending?.kernelId === kernelId && pending.item.key === item.key && h("div", { className: "sy-confirm" },
              h("p", null, `将「${kernel?.name}」的 ${endpointName(item)} 设为「${labels[pending.decision]}」？`),
              button("确认", () => perform(async () => { await post({ action: "grant", kernelId: pending.kernelId, endpointKey: item.key, decision: pending.decision }); setPending(null); }), { disabled: busy }),
              button("取消", () => setPending(null), { disabled: busy }))))))) : h("p", null, kernelId ? "正在查询端点..." : "请先添加核心"),
      h(Declaration, { perform, onSaved: reload }));
  }
  function Main() {
    const [state, setState] = React.useState(null); const [kernelId, setKernelId] = React.useState("");
    const [editingId, setEditingId] = React.useState(null); const [tab, setTab] = React.useState("kernels");
    const [connections, setConnections] = React.useState({});
    const [error, setError] = React.useState(""); const [notice, setNotice] = React.useState(""); const [busy, setBusy] = React.useState(false);
    const [filter, setFilter] = React.useState({ query: "", protocol: "", method: "", decision: "", offset: 0 });
    const [catalogResult, setCatalog] = React.useState(null); const [pending, setPending] = React.useState(null);
    const [revision, reload] = React.useReducer(n => n + 1, 0); const generation = React.useRef(0);
    const live = React.useRef(true); const mutationGate = React.useRef(false);
    React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    const perform = React.useCallback(async fn => {
      if (mutationGate.current) return; mutationGate.current = true; setBusy(true); setError(""); setNotice("");
      try { const result = await fn(); if (live.current) { if (typeof result === "string") setNotice(result); reload(); } }
      catch (error) { if (live.current) setError(error.message); }
      finally { mutationGate.current = false; if (live.current) setBusy(false); }
    }, []);
    React.useEffect(() => {
      const controller = new AbortController();
      async function load() {
        const value = await get({}, controller.signal);
        setState(value); setKernelId(previous => value.kernels.some(k => k.id === previous) ? previous : value.defaultKernelId ?? value.kernels[0]?.id ?? "");
        setConnections(Object.fromEntries(value.kernels.filter(k => k.enabled).map(k => [k.id, { checking: true }])));
        // 进入管理界面和保存配置后自动检查；顺序执行使首次绑定的状态更新依次落盘。
        for (const kernel of value.kernels.filter(k => k.enabled)) {
          if (controller.signal.aborted) return;
          let status;
          try { status = await post({ action: "test", kernelId: kernel.id }, controller.signal); }
          catch (error) { status = { error: error.message }; }
          if (controller.signal.aborted) return;
          setConnections(previous => ({ ...previous, [kernel.id]: status }));
        }
        setState(await get({}, controller.signal));
      }
      load().catch(error => { if (!controller.signal.aborted) setError(error.message); });
      return () => controller.abort();
    }, [revision]);
    React.useEffect(() => {
      const mine = ++generation.current; const controller = new AbortController(); setCatalog(null);
      if (!kernelId || tab !== "endpoints") return () => controller.abort();
      const timer = setTimeout(() => get({ view: "endpoints", kernelId, ...filter }, controller.signal).then(value => {
        if (mine === generation.current) setCatalog({ ...value, requestKey: JSON.stringify({ kernelId, filter, revision }) });
      }).catch(error => { if (!controller.signal.aborted) setError(error.message); }), 180);
      return () => { clearTimeout(timer); controller.abort(); };
    }, [kernelId, tab, filter, revision]);
    function change(key, value) { setFilter(previous => ({ ...previous, [key]: value, offset: 0 })); setPending(null); }
    const catalog = catalogResult?.requestKey === JSON.stringify({ kernelId, filter, revision }) ? catalogResult : null;
    return h("div", { className: "sy-page" }, h("header", { className: "sy-heading" }, h(Icon, { size: 28 }), h("div", null, h("h2", null, "思源连接管理界面"), h("p", { className: "sy-note" }, "核心连接与端点授权 · 自动检查已启用的连接"))),
      h("nav", { className: "sy-bar" }, button("核心连接", () => setTab("kernels"), { "aria-pressed": tab === "kernels" }), button("端点授权", () => setTab("endpoints"), { "aria-pressed": tab === "endpoints" }), button("刷新", () => reload(), { disabled: busy })),
      error && h("p", { role: "alert", className: "sy-error" }, error), notice && h("p", { role: "status" }, notice),
      !state ? h("p", null, "正在读取思源配置...") : tab === "kernels" ? h("div", { className: "sy-columns" },
        h("section", null, button("添加核心", () => setEditingId(null)), state.kernels.map(item => h("article", { className: "sy-box", key: item.id },
          h("h3", null, item.name), h("p", { className: "sy-mono" }, item.apiUrl), h("p", { className: "sy-note" }, `${item.enabled ? "已启用" : "已停用"} · ${item.credential.configured ? "凭据已配置" : "未配置凭据"}${state.defaultKernelId === item.id ? " · 默认核心" : ""}`),
          item.enabled && h("p", { role: "status", className: connections[item.id]?.error ? "sy-error" : "sy-note" },
            connections[item.id]?.error || (connections[item.id]?.version ? `连接成功：${connections[item.id].apiUrl} · 思源 ${connections[item.id].version}` : "正在自动检查连接...")),
          h("div", { className: "sy-bar" }, button("编辑", () => setEditingId(item.id)), button("设为默认", () => perform(() => post({ action: "defaultKernel", kernelId: item.id })), { disabled: busy }),
            button("重新检查连接", () => reload(), { disabled: busy || !item.enabled }),
            button("查看端点", () => { setKernelId(item.id); setTab("endpoints"); setFilter({ query: "", protocol: "", method: "", decision: "", offset: 0 }); }),
            button("删除", () => { if (window.confirm(`删除核心「${item.name}」及其授权配置？笔记内容不会删除。`)) perform(() => post({ action: "removeKernel", kernelId: item.id })); }, { disabled: busy })))),
          state.defaultKernelId && button("取消默认核心", () => perform(() => post({ action: "defaultKernel", kernelId: null })), { disabled: busy })),
        h(KernelForm, { kernel: state.kernels.find(k => k.id === editingId), onSaved: () => setEditingId(null), busy, perform })) :
        h(EndpointPanel, { state, kernelId, filter, catalog, pending, busy, perform, change, setKernelId, setFilter, setPending, reload }));
  }
  function ActivityView({ sessionId, result, state, error, query, offset, refresh, setError, setQuery, setOffset, openManagement, permission, revealCall }) {
    const data = result?.sessionId === sessionId && result?.pageOffset === offset ? result : null;
    const rows = data?.items.filter(item => `${item.tool} ${item.kernelName} ${item.callId} ${item.resources.join(" ")} ${item.endpoints.map(endpointName).join(" ")} ${item.status}`.toLowerCase().includes(query.toLowerCase())) ?? [];
    return h("div", { className: "sy-activity sy-page" }, h("div", { className: "sy-bar" }, h(Icon, {}), h("strong", null, "本会话的思源活动"), button("刷新", refresh),
        openManagement && button("思源连接管理界面", openManagement)),
      permission && h("p", { className: "sy-note" }, `DSH 会话权限：${{ "danger-full-access": "完全文件权限", "workspace-write": "工作区写入", "read-only": "只读", auto: "自动", custom: "自定义" }[permission] ?? permission}`),
      error && h("p", { role: "alert", className: "sy-error" }, error),
      state && h("label", { className: "sy-field" }, "会话核心", select(data?.sessionKernelId ?? "", async value => {
        try { await post({ action: "sessionKernel", sessionId, kernelId: value || null }); refresh(); } catch (error) { setError(error.message); }
      }, [["", "使用默认核心"], ...state.kernels.map(k => [k.id, k.name])], "会话思源核心", { disabled: !data })),
      h("input", { type: "search", placeholder: "过滤本页调用、核心、位置", "aria-label": "过滤会话思源活动", value: query, onChange: e => setQuery(e.target.value) }),
      h("p", { className: "sy-note" }, "默认每次询问、完全权限下拒绝。另一种询问配置在完全权限下自动通过；普通权限下两者均交给 DSH 审批。「允许」直接通过，「拒绝」直接停止。"),
      !data ? h("p", null, sessionId ? "读取中..." : "请打开一个会话") : h(React.Fragment, null,
        h("div", { className: "sy-bar" }, h("span", null, `共 ${data.total} 条记录`), button("上一页", () => setOffset(Math.max(0, offset - 50)), { disabled: offset === 0 }), button("下一页", () => setOffset(offset + 50), { disabled: offset + 50 >= data.total })),
        rows.length === 0 && h("p", null, "没有匹配的活动记录"), rows.map(item => h("article", { className: "sy-box", key: item.id },
          h("div", { className: "sy-bar" }, h("strong", null, item.tool), h("span", { className: "sy-tag" }, states[item.status] || item.status),
            item.callId && revealCall && button("定位工具调用", async () => {
              try { await revealCall(item.callId); setError(""); } catch (error) { setError(error.message); }
            })),
          h("p", null, `${item.kernelName || item.kernelId} · ${new Date(item.time).toLocaleString()}${item.elapsedMs !== undefined ? ` · ${item.elapsedMs}ms` : ""}`),
          item.endpoints.map(entry => h("div", { key: entry.key }, h("p", { className: "sy-mono" }, `${entry.protocol} ${endpointName(entry)}`),
            item.authorization?.find(auth => auth.endpointKey === entry.key) && h("p", { className: "sy-tag" },
              `${labels[item.authorization.find(auth => auth.endpointKey === entry.key).decision] ?? "端点策略"} · ${approvalLabels[item.authorization.find(auth => auth.endpointKey === entry.key).outcome] ?? "审批结果未知"}`))), item.error && h("p", { className: "sy-error" }, item.error),
          item.resources.length ? h("div", null, item.resources.map(id => h("p", { key: id, className: "sy-mono" }, item.target?.match(/^http:\/\/127\.0\.0\.1:/) ? h("a", { href: `siyuan://blocks/${id}` }, id) : id))) : h("p", { className: "sy-note" }, "未解析具体文档或块位置"),
          h("details", null, h("summary", null, "调用关联"), h("p", { className: "sy-mono" }, `调用：${item.callId || "公共服务调用"}`), h("p", { className: "sy-mono" }, `操作：${item.id}`), h("p", { className: "sy-mono" }, `核心：${item.kernelId}`))))));
  }
  function Activity({ sessionId, openManagement, useProjection, revealCall }) {
    const permission = useProjection?.("permissions")?.currentValue;
    const [result, setData] = React.useState(null); const [state, setState] = React.useState(null);
    const [error, setError] = React.useState(""); const [query, setQuery] = React.useState("");
    const [offset, setOffset] = React.useState(0); const [tick, refresh] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => { setData(null); setOffset(0); setQuery(""); }, [sessionId]);
    React.useEffect(() => {
      if (!sessionId) return;
      const controller = new AbortController(); let loading = false;
      async function load() {
        if (loading) return; loading = true;
        try {
          const [activity, config] = await Promise.all([get({ view: "activity", sessionId, offset }, controller.signal), get({}, controller.signal)]);
          if (!controller.signal.aborted) { setData({ ...activity, pageOffset: offset }); setState(config); setError(""); }
        } catch (error) { if (!controller.signal.aborted) setError(error.message); }
        finally { loading = false; }
      }
      load(); const timer = setInterval(load, 2500);
      return () => { clearInterval(timer); controller.abort(); };
    }, [sessionId, offset, tick]);
    return h(ActivityView, { sessionId, result, state, error, query, offset, refresh, setError, setQuery, setOffset, openManagement, permission, revealCall });
  }
  /** 卡片拥有自己的定位节点；导航只使用此组件注册的回调。 */
  function ToolCall({ callId, toolName, phase, block, inspect, bindCall }) {
    const element = React.useRef(null); const [open, setOpen] = React.useState(false);
    React.useEffect(() => bindCall?.(callId, () => {
      if (!element.current?.getClientRects().length) return false;
      setOpen(true); element.current.scrollIntoView({ block: "center" }); element.current.focus(); return true;
    }), [callId, bindCall]);
    const args = phase === "result" ? block.call?.argsRaw : phase === "start" ? block.argsRaw : undefined;
    const status = phase === "preparing" ? "准备参数" : phase === "start" ? "执行中" : block.isError ? "调用失败" : "已返回";
    return h("article", { ref: element, tabIndex: -1, className: "sy-tool sy-box", "aria-label": `${toolName} ${callId}` },
      h("div", { className: "sy-bar" }, button(`${toolName} · ${status}`, () => setOpen(value => !value), { "aria-expanded": open }),
        inspect && button("查看调用详情", inspect)),
      open && h("div", null, h("p", { className: "sy-mono" }, callId), args !== undefined && h("pre", null, args),
        phase === "result" && block.content.map((part, index) => h("pre", { key: index }, part.type === "text" ? part.text : JSON.stringify(part)))));
  }
  return Object.freeze({ Main, Activity, Icon, KernelForm, EndpointPanel, ActivityView, ToolCall });
}
