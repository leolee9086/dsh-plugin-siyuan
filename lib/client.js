/** Harness 客户端适配器只负责网络与插槽接入，界面实现通过其领域入口创建。 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-siyuan",
  factory: require => {
    const React = require("react");
    const h = React.createElement;
    const ROUTE = "/api/siyuan-control";
    const ICON = "data:image/svg+xml;base64,PCEtLSBHZW5lcmF0ZWQgYnkgSWNvTW9vbi5pbyAtLT4NCjxzdmcgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiPg0KPHRpdGxlPjwvdGl0bGU+DQo8ZyBpZD0iaWNvbW9vbi1pZ25vcmUiPg0KPC9nPg0KPHBhdGggZmlsbD0iI2QyM2YzMSIgZD0iTTM3LjA1MiAzNzEuNjc2bDI2OS44NTctMjY5Ljg1N3Y1NTAuNTA3bC0yNjkuODU3IDI2OS44NTd6Ij48L3BhdGg+DQo8cGF0aCBmaWxsPSIjM2IzZTQzIiBkPSJNMzA2LjkwOSAxMDEuODE4bDIwNS4wOTEgMjA1LjA5MXY1NTAuNTA3bC0yMDUuMDkxLTIwNS4wOTF6Ij48L3BhdGg+DQo8cGF0aCBmaWxsPSIjZDIzZjMxIiBkPSJNNTEyIDMwNi45MDlsMjA1LjA5MS0yMDUuMDkxdjU1MC41MDdsLTIwNS4wOTEgMjA1LjA5MXoiPjwvcGF0aD4NCjxwYXRoIGZpbGw9IiMzYjNlNDMiIGQ9Ik03MTcuMDkxIDEwMS44MThsMjY5Ljg1NyAyNjkuODU3djU1MC41MDdsLTI2OS44NTctMjY5Ljg1N3oiPjwvcGF0aD4NCjwvc3ZnPg0K";
    async function get(params, signal) {
      const response = await fetch(`${ROUTE}?${new URLSearchParams(params)}`, { credentials: "same-origin", signal });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value;
    }
    async function post(value, signal) {
      const response = await fetch(ROUTE, { method: "POST", signal, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
    }
    // 构建嵌入同一份工厂，测试直接 import 此工厂；不为测试复制组件实现。
    const { Main, Activity, Icon, ToolCall } = ((function createClientUI(React, { get, post, icon }) {
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
      h("header", null, h("h3", null, kernel ? "编辑核心" : "添加核心"),
        h("p", { className: "sy-note" }, kernel ? `正在编辑「${kernel.name}」` : "连接本机思源或远程工作空间")),
      field("name", "名称", "text", "例如：本机思源"), field("apiUrl", "内核地址", "text", "auto 或 https://..."),
      h("p", { className: "sy-note" }, "本机使用 auto，保存后从实例列表选择；远程地址支持代理路径前缀。"),
      h("label", { className: "sy-field" }, h("span", null, "API token"), h("input", { ref: token, type: "password", name: "siyuan-credential",
        autoComplete: "new-password", spellCheck: false, disabled: clearToken || busy || kernel?.credential.writable === false,
        placeholder: kernel?.credential.configured ? "已配置；留空保留，输入新值替换" : "未配置；可留空" })),
      h("div", { className: "sy-checks" },
        h("label", null, h("input", { type: "checkbox", checked: form.enabled, onChange: e => setForm({ ...form, enabled: e.target.checked }) }), "启用核心"),
        h("label", null, h("input", { type: "checkbox", checked: clearToken, disabled: busy || kernel?.credential.writable === false, onChange: e => setClearToken(e.target.checked) }), "清除已保存的 token")),
      h("details", null, h("summary", null, "高级连接选项"),
        h("div", { className: "sy-form-grid" }, field("timeoutMs", "超时（毫秒）", "number"), field("kernelPid", "固定 PID（可选）", "number")),
        field("portFile", "端口登记文件", "text", "留空使用系统默认"),
        h("p", { className: "sy-note" }, "通常直接使用实例列表即可，无需手填 PID。")),
      h("p", { className: "sy-note" }, "凭据保存在本机且不回显。改变地址、PID 或登记文件后，需要重新授权端点。"),
      h("footer", { className: "sy-form-footer" }, kernel && button("取消编辑", onSaved, { disabled: busy, className: "sy-quiet" }),
        h("button", { type: "submit", disabled: busy, className: "sy-primary" }, busy ? "保存中..." : "保存核心")));
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
  function GatewayPanel({ gateway, busy, perform }) {
    if (!gateway) return null;
    return h("details", { className: "sy-box sy-gateway" },
      h("summary", null, h("strong", null, "工具箱协同"), h("span", { className: "sy-badge" }, `已注册 ${gateway.registered} 个`)),
      h("div", { className: "sy-gateway-stats" }, h("span", { className: "sy-badge" }, `${gateway.http} 个 HTTP 端点`),
        h("span", { className: "sy-badge" }, `${gateway.mcp} 个 MCP 工具`)),
      h("p", { className: "sy-note" }, "注册后，新工具默认关闭。在右侧工具箱按工具或工具组开启；调用仍遵循思源端点授权。HTTP 使用会话选择的核心，MCP 固定到发现它的核心。"),
      !gateway.available && h("p", null, "安装并启用 dsh-tool-gateway 后可注册完整工具目录。"),
      gateway.missingSchemas > 0 && h("p", null, `${gateway.missingSchemas} 个旧 MCP 记录缺少参数定义，请在对应核心重新发现 MCP 工具。`),
      gateway.requested && !gateway.available && h("p", null, "注册选择已保存，工具箱恢复后会自动注册。"),
      gateway.error && h("p", { role: "alert", className: "sy-error" }, gateway.error),
      h("div", { className: "sy-bar" }, button(gateway.requested ? "同步全部 HTTP / MCP 工具" : "注册全部 HTTP / MCP 工具", () => perform(async () => {
        const result = await post({ action: "registerGateway", enabled: true });
        return `已注册 ${result.registered} 个工具；请在右侧工具箱选择要开启的工具`;
      }), { disabled: busy || !gateway.available }),
      gateway.requested && button("撤回扩展工具", () => perform(async () => {
        await post({ action: "registerGateway", enabled: false }); return "已撤回扩展工具，五个基础思源工具仍可使用";
      }), { disabled: busy })));
  }
  function Main() {
    const [state, setState] = React.useState(null); const [kernelId, setKernelId] = React.useState("");
    const [editingId, setEditingId] = React.useState(null); const [tab, setTab] = React.useState("kernels");
    const [connections, setConnections] = React.useState({});
    const [instances, setInstances] = React.useState({});
    const [error, setError] = React.useState(""); const [notice, setNotice] = React.useState(""); const [busy, setBusy] = React.useState(false);
    const [filter, setFilter] = React.useState({ query: "", protocol: "", method: "", decision: "", offset: 0 });
    const [catalogResult, setCatalog] = React.useState(null); const [pending, setPending] = React.useState(null);
    const [revision, reload] = React.useReducer(n => n + 1, 0); const generation = React.useRef(0);
    const live = React.useRef(true); const mutationGate = React.useRef(false);
    React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    const perform = React.useCallback(async (fn, refresh = true) => {
      if (mutationGate.current) return; mutationGate.current = true; setBusy(true); setError(""); setNotice("");
      try { const result = await fn(); if (live.current) { if (typeof result === "string") setNotice(result); if (refresh) reload(); } }
      catch (error) { if (live.current) setError(error.message); }
      finally { mutationGate.current = false; if (live.current) setBusy(false); }
    }, []);
    React.useEffect(() => {
      const controller = new AbortController();
      async function load() {
        const value = await get({}, controller.signal);
        setState(value); setKernelId(previous => value.kernels.some(k => k.id === previous) ? previous : value.defaultKernelId ?? value.kernels[0]?.id ?? "");
        if (controller.signal.aborted) return;
        setConnections(Object.fromEntries(value.kernels.filter(k => k.enabled).map(k =>
          [k.id, k.reminderPause ? { error: k.reminderPause.message } : { checking: true }])));
        setInstances(Object.fromEntries(value.kernels.filter(k => k.apiUrl === "auto").map(k =>
          [k.id, { loading: k.enabled && !k.reminderPause, items: null }])));
        // 先展示不带凭据的候选实例，再检查当前连接；旧 PID 失效也能直接选择。
        // 暂停的核心只允许人工检查；授权或普通刷新不能再次撞认证限流。
        for (const kernel of value.kernels.filter(k => k.enabled && !k.reminderPause)) {
          if (controller.signal.aborted) return;
          if (kernel.apiUrl === "auto") {
            let candidates;
            try { candidates = { items: (await post({ action: "instances", kernelId: kernel.id }, controller.signal)).instances }; }
            catch (error) { candidates = { error: error.message }; }
            if (controller.signal.aborted) return;
            setInstances(previous => ({ ...previous, [kernel.id]: candidates }));
          }
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
    return h("div", { className: "sy-page" }, h("div", { className: "sy-shell" },
      h("header", { className: "sy-heading" }, h("span", { className: "sy-heading-icon" }, h(Icon, { size: 28 })),
        h("div", { className: "sy-heading-copy" }, h("h2", null, "思源连接管理界面"), h("p", { className: "sy-note" }, "管理工作空间、选择本机实例与端点权限"))),
      h("div", { className: "sy-toolbar" }, h("nav", { className: "sy-tabs", "aria-label": "思源管理" },
        button("核心连接", () => setTab("kernels"), { "aria-pressed": tab === "kernels" }),
        button("端点授权", () => setTab("endpoints"), { "aria-pressed": tab === "endpoints" })), button("刷新", () => reload(), { disabled: busy })),
      error && h("p", { role: "alert", className: "sy-alert sy-error" }, error),
      notice && h("p", { role: "status", className: "sy-alert sy-ok" }, notice),
      !state ? h("div", { className: "sy-box sy-empty" }, "正在读取思源配置...") : tab === "kernels" ? h("div", { className: "sy-columns" },
        h("section", { "aria-label": "已保存的核心" },
          h("div", { className: "sy-section-heading" }, h("div", null, h("h3", null, "我的核心"), h("span", { className: "sy-count" }, state.kernels.length)),
            button("添加核心", () => setEditingId(null), { className: "sy-quiet" })),
          state.kernels.length === 0 && h("div", { className: "sy-box sy-empty" }, h("h3", null, "连接你的思源"), h("p", { className: "sy-note" }, "填写核心名称和地址，本机地址使用 auto 即可。")),
          state.kernels.map(item => {
            const connection = connections[item.id]; const candidates = instances[item.id];
            const tone = !item.enabled ? undefined : item.reminderPause ? "warning" : connection?.error ? "error" : connection?.version ? "success" : "accent";
            return h("article", { className: "sy-box", key: item.id },
              h("div", { className: "sy-kernel-title" }, h("h3", null, item.name),
                h("span", { className: "sy-badge", "data-tone": tone }, h("span", { className: "sy-dot" }),
                  !item.enabled ? "已停用" : item.reminderPause ? "提醒已暂停" : connection?.error ? "连接异常" : connection?.version ? "已连接" : "检查中"),
                state.defaultKernelId === item.id && h("span", { className: "sy-badge", "data-tone": "accent" }, "默认核心")),
              h("div", { className: "sy-kernel-meta" }, h("span", null, item.apiUrl === "auto" ? "本机 · 自动发现" : item.apiUrl),
                h("span", null, item.credential.configured ? "凭据已配置" : "未配置凭据")),
              item.enabled && h("div", { role: "status", className: "sy-kernel-status", "data-tone": connection?.error ? "error" : connection?.version ? "success" : undefined },
                connection?.error || (connection?.version ? `访问可用 · 思源 ${connection.version}` : "正在自动检查连接..."),
                connection?.version && h("p", { className: "sy-mono" }, connection.apiUrl),
                item.reminderPause && h("p", { className: "sy-note" }, "自动访问已暂停，可编辑凭据后人工重新检查。")),
              item.apiUrl === "auto" && h("section", { className: "sy-instances", "aria-label": `${item.name}的本机实例` },
                h("div", { className: "sy-section-heading" }, h("h4", null, "本机实例"), button("刷新实例列表", () => perform(async () => {
                  const result = await post({ action: "instances", kernelId: item.id });
                  if (live.current) setInstances(previous => ({ ...previous, [item.id]: { items: result.instances } }));
                }, false), { disabled: busy || !item.enabled, className: "sy-quiet" })),
                h("p", { className: "sy-note" }, `当前绑定：${item.kernelPid ? `PID ${item.kernelPid}` : "待选择"} · 切换实例后需重新授权端点`),
                candidates?.loading && h("p", { className: "sy-note", role: "status" }, "正在发现本机实例…"),
                candidates?.error && h("p", { className: "sy-error", role: "alert" }, candidates.error),
                !candidates?.loading && !candidates?.items && !candidates?.error && h("p", { className: "sy-note" }, item.enabled ? "自动发现已暂停，点击刷新实例列表查看。" : "启用核心后自动发现本机实例。"),
                candidates?.items?.length === 0 && h("p", { className: "sy-note" }, "暂未发现可用实例；启动思源后刷新。"),
                h("div", { className: "sy-instance-list" }, candidates?.items?.map(instance => h("div", { key: instance.pid, className: "sy-instance", "data-selected": item.kernelPid === instance.pid },
                  h("div", null, h("strong", null, `PID ${instance.pid}`), h("p", { className: "sy-note sy-mono" }, `${instance.apiUrl} · 思源 ${instance.version}`)),
                  button(item.kernelPid === instance.pid ? "当前实例" : "连接此实例", () => perform(async () => {
                    await post({ action: "selectInstance", kernelId: item.id, pid: instance.pid }); return `已连接 PID ${instance.pid}`;
                  }), { disabled: busy || !item.enabled || item.kernelPid === instance.pid, "aria-label": `连接 PID ${instance.pid}` }))))),
              h("div", { className: "sy-bar sy-kernel-actions" }, button("编辑", () => setEditingId(item.id), { disabled: busy }),
                button("重新检查连接", () => perform(async () => {
                  let status;
                  try { status = await post({ action: "test", kernelId: item.id }); }
                  catch (error) { status = { error: error.message }; }
                  const current = await get({});
                  if (live.current) { setConnections(previous => ({ ...previous, [item.id]: status })); setState(current); }
                  if (status.error) throw new Error(status.error);
                  return `访问可用 · 思源 ${status.version} · ${status.credentialSent ? "已发送配置凭据" : "未发送配置凭据"}`;
                }, false), { disabled: busy || !item.enabled }),
                button("查看端点", () => { setKernelId(item.id); setTab("endpoints"); setFilter({ query: "", protocol: "", method: "", decision: "", offset: 0 }); }),
                button("设为默认", () => perform(() => post({ action: "defaultKernel", kernelId: item.id })), { disabled: busy || state.defaultKernelId === item.id, className: "sy-quiet" }),
                button("删除", () => { if (window.confirm(`删除核心「${item.name}」及其授权配置？笔记内容不会删除。`)) perform(() => post({ action: "removeKernel", kernelId: item.id })); }, { disabled: busy, className: "sy-quiet sy-danger-button" })));
          }),
          state.defaultKernelId && button("取消默认核心", () => perform(() => post({ action: "defaultKernel", kernelId: null })), { disabled: busy, className: "sy-quiet" }),
          h(GatewayPanel, { gateway: state.gateway, busy, perform })),
        h(KernelForm, { kernel: state.kernels.find(k => k.id === editingId), onSaved: () => setEditingId(null), busy, perform })) :
        h("div", { className: "sy-box" }, h(EndpointPanel, { state, kernelId, filter, catalog, pending, busy, perform, change, setKernelId, setFilter, setPending, reload }))));
  }
  function ActivityView({ sessionId, result, state, error, query, offset, refresh, setError, setQuery, setOffset, openManagement, permission, revealCall }) {
    const [jump, setJump] = React.useState({ callId: "", busy: false, error: "", message: "" });
    const jumpGeneration = React.useRef(0);
    React.useEffect(() => {
      setJump({ callId: "", busy: false, error: "", message: "" });
      return () => { jumpGeneration.current++; };
    }, [sessionId]);
    async function locate(callId) {
      const mine = ++jumpGeneration.current; setJump({ callId, busy: true, error: "", message: "" });
      try {
        await revealCall(callId);
        if (mine === jumpGeneration.current) setJump({ callId, busy: false, error: "", message: "已定位到对应工具调用" });
      } catch (error) {
        if (mine === jumpGeneration.current) setJump({ callId, busy: false, error: error.message, message: "" });
      }
    }
    const data = result?.sessionId === sessionId && result?.pageOffset === offset ? result : null;
    const rows = data?.items.filter(item => `${item.tool} ${item.kernelName} ${item.callId} ${item.resources.join(" ")} ${item.endpoints.map(endpointName).join(" ")} ${item.status}`.toLowerCase().includes(query.toLowerCase())) ?? [];
    return h("div", { className: "sy-activity sy-page" }, h("div", { className: "sy-shell" },
      h("header", { className: "sy-heading" }, h("span", { className: "sy-heading-icon" }, h(Icon, { size: 22 })),
        h("div", { className: "sy-heading-copy" }, h("h2", null, "本会话的思源活动"), h("p", { className: "sy-note" }, "调用结果、端点授权与笔记位置")),
        button("刷新", refresh, { className: "sy-quiet" })),
      error && h("p", { role: "alert", className: "sy-alert sy-error" }, error),
      h("section", { className: "sy-box sy-activity-controls", "aria-label": "活动筛选" },
        state && h("label", { className: "sy-field" }, "会话核心", select(data?.sessionKernelId ?? "", async value => {
          try { await post({ action: "sessionKernel", sessionId, kernelId: value || null }); refresh(); } catch (error) { setError(error.message); }
        }, [["", "使用默认核心"], ...state.kernels.map(k => [k.id, k.name])], "会话思源核心", { disabled: !data })),
        h("label", { className: "sy-field" }, "搜索本页", h("input", { type: "search", placeholder: "调用、核心、端点或位置", "aria-label": "过滤会话思源活动", value: query, onChange: e => setQuery(e.target.value) })),
        h("details", { className: "sy-policy-note" }, h("summary", null, "权限与审批说明"),
          permission && h("p", { className: "sy-note" }, "DSH 会话权限：" + ({ "danger-full-access": "完全文件权限", "workspace-write": "工作区写入", "read-only": "只读", auto: "自动", custom: "自定义" }[permission] ?? permission)),
          h("p", { className: "sy-note" }, "默认每次询问、完全权限下拒绝。另一种询问配置在完全权限下自动通过；普通权限下两者均交给 DSH 审批。「允许」直接通过，「拒绝」直接停止。")),
        openManagement && button("思源连接管理界面", openManagement, { className: "sy-quiet" })),
      !data ? h("div", { className: "sy-box sy-empty" }, sessionId ? "读取中..." : "请打开一个会话") : h(React.Fragment, null,
        h("div", { className: "sy-results-bar" }, h("span", null, "共 " + data.total + " 条记录" + (query ? " · 本页匹配 " + rows.length + " 条" : "")),
          h("div", { className: "sy-pagination" }, button("上一页", () => setOffset(Math.max(0, offset - 50)), { disabled: offset === 0 }), button("下一页", () => setOffset(offset + 50), { disabled: offset + 50 >= data.total }))),
        rows.length === 0 && h("div", { className: "sy-box sy-empty" }, "没有匹配的活动记录"), rows.map(item => {
          const tone = item.status === "succeeded" ? "success" : ["failed", "denied"].includes(item.status) ? "error" : ["partial", "uncertain"].includes(item.status) ? "warning" : "accent";
          return h("article", { className: "sy-box sy-record", key: item.id },
            h("div", { className: "sy-record-head" }, h("div", null,
              h("div", { className: "sy-record-title" }, h("strong", null, item.tool), h("span", { className: "sy-badge", "data-tone": tone }, states[item.status] || item.status)),
              h("div", { className: "sy-record-time" }, h("span", null, item.kernelName || item.kernelId), h("time", { dateTime: item.time }, new Date(item.time).toLocaleString()),
                item.elapsedMs !== undefined && h("span", null, item.elapsedMs + " ms"))),
              item.callId && revealCall && button(jump.callId === item.callId && jump.busy ? "正在定位…" : "定位工具调用",
                () => locate(item.callId), { disabled: jump.callId === item.callId && jump.busy })),
            jump.callId === item.callId && (jump.error || jump.message) && h("p", { role: jump.error ? "alert" : "status", className: jump.error ? "sy-alert sy-error" : "sy-alert sy-ok" }, jump.error || jump.message),
            item.endpoints.length > 0 && h("div", { className: "sy-record-endpoints" }, item.endpoints.map(entry => {
              const authorization = item.authorization?.find(auth => auth.endpointKey === entry.key);
              return h("div", { key: entry.key }, h("div", { className: "sy-endpoint-line" }, h("span", { className: "sy-method" }, entry.protocol.toUpperCase()), h("code", null, endpointName(entry))),
                authorization && h("p", { className: "sy-authorization" }, (labels[authorization.decision] ?? "端点策略") + " · " + (approvalLabels[authorization.outcome] ?? "审批结果未知")));
            })),
            item.error && h("p", { role: "alert", className: "sy-alert sy-error" }, item.error),
            h("footer", { className: "sy-record-footer" }, item.resources.length > 0 && h("div", { className: "sy-resources" }, item.resources.map(id => h("span", { key: id, className: "sy-mono" },
              item.target?.match(/^http:\/\/127\.0\.0\.1:/) ? h("a", { href: "siyuan://blocks/" + id }, id) : id))),
              h("details", null, h("summary", null, "调用关联"), h("p", { className: "sy-mono" }, "调用：" + (item.callId || "公共服务调用")),
                h("p", { className: "sy-mono" }, "操作：" + item.id), h("p", { className: "sy-mono" }, "核心：" + item.kernelId),
                item.resources.length === 0 && h("p", { className: "sy-note" }, "未解析具体文档或块位置"))));
        }))));
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
  /** 卡片主动作打开会话活动，参数和结果可在原位单独展开。 */
  function ToolCall({ callId, toolName, phase, block, openActivity }) {
    const [open, setOpen] = React.useState(false); const [error, setError] = React.useState("");
    function showActivity() {
      try { openActivity(); setError(""); } catch (error) { setError(error.message); }
    }
    const args = phase === "result" ? block.call?.argsRaw : phase === "start" ? block.argsRaw : undefined;
    const status = phase === "preparing" ? "准备参数" : phase === "start" ? "执行中" : block.isError ? "调用失败" : "已返回";
    return h("article", { className: "sy-tool sy-box", "aria-label": `${toolName} ${callId}`, onClick: event => {
      if (!event.defaultPrevented && !event.target.closest("button, a, input, textarea, select, pre")) showActivity();
    } },
      h("div", { className: "sy-bar" }, button(`${toolName} · ${status}`, showActivity, { title: "打开右侧思源活动" }),
        button(open ? "收起参数与结果" : "展开参数与结果", () => setOpen(value => !value), { "aria-expanded": open })),
      error && h("p", { role: "alert", className: "sy-error" }, error),
      open && h("div", null, h("p", { className: "sy-mono" }, callId), args !== undefined && h("pre", null, args),
        phase === "result" && block.content.map((part, index) => h("pre", { key: index }, part.type === "text" ? part.text : JSON.stringify(part)))));
  }
  return Object.freeze({ Main, Activity, Icon, KernelForm, EndpointPanel, ActivityView, ToolCall, GatewayPanel });
}))(React, { get, post, icon: ICON });
    function installStyle(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style"); style.id = "dsh-siyuan-style";
        style.textContent = `
/* Every surface owns usable fallback colors, including pop-out windows and narrow panes. */
.sy-page,.sy-tool{--sy-bg:var(--dsw-alias-bg-layer-1,#f5f7fa);--sy-card:var(--dsw-alias-bg-layer-2,#fff);--sy-text:var(--dsw-alias-text-primary,#243247);--sy-muted:var(--dsw-alias-label-secondary,#65758a);--sy-border:var(--dsw-alias-border-secondary,#dce3ec);--sy-accent:#3467c2;--sy-tint:#edf3ff;--sy-success:#267452;--sy-success-bg:#eaf6ef;--sy-danger:#b43b42;--sy-danger-bg:#fff0f0;--sy-warn:#916218;--sy-warn-bg:#fff6e7;color:var(--sy-text);font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
.sy-page{box-sizing:border-box;height:100%;min-height:0;overflow:auto;background:var(--sy-bg);padding:28px;container-type:inline-size}.sy-page *,.sy-tool *{box-sizing:border-box}.sy-shell{max-width:1160px;margin:0 auto;min-width:0}
.sy-page h2,.sy-page h3,.sy-page h4,.sy-page p{margin:0}.sy-page h2{font-size:24px;font-weight:650;letter-spacing:-.5px}.sy-page h3{font-size:15px;font-weight:650}.sy-page h4{font-size:13px}.sy-page a{color:var(--sy-accent);text-underline-offset:3px}.sy-page :focus-visible,.sy-tool :focus-visible{outline:2px solid var(--sy-accent);outline-offset:3px}
.sy-heading{display:flex;align-items:center;gap:13px;margin-bottom:24px}.sy-heading-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;flex-shrink:0;background:var(--sy-card);border:1px solid var(--sy-border);border-radius:14px}.sy-heading-copy{flex:1;min-width:0}.sy-heading .sy-note{margin-top:3px}
.sy-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sy-between{justify-content:space-between}.sy-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}.sy-tabs{display:flex;gap:4px;padding:4px;background:var(--sy-card);border:1px solid var(--sy-border);border-radius:10px}
.sy-page button,.sy-tool button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px 12px;border:1px solid var(--sy-border);border-radius:7px;color:var(--sy-text);background:var(--sy-card);font:inherit;line-height:1.35;cursor:pointer;transition:background .15s,border-color .15s}.sy-page button:hover:not(:disabled),.sy-tool button:hover:not(:disabled){background:var(--sy-tint);border-color:var(--sy-accent)}.sy-page button:disabled{opacity:.48;cursor:default}.sy-page .sy-primary{background:var(--sy-accent);color:#fff;border-color:var(--sy-accent)}.sy-page .sy-primary:hover:not(:disabled){background:#2854a1;color:#fff}.sy-page .sy-quiet{border-color:transparent;background:transparent}.sy-page .sy-danger-button{color:var(--sy-danger)}.sy-tabs button{border-color:transparent;background:transparent;min-width:100px}.sy-tabs button[aria-pressed=true]{background:var(--sy-tint);color:var(--sy-accent);font-weight:600}
.sy-page input:not([type=checkbox]),.sy-page select{display:block;width:100%;min-height:38px;min-width:0;padding:8px 10px;border:1px solid var(--sy-border);border-radius:7px;background:var(--sy-card);color:var(--sy-text);font:inherit}.sy-page input::placeholder{color:var(--sy-muted);opacity:.8}.sy-page input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--sy-accent)}.sy-page label:has(>input[type=checkbox]){display:flex;align-items:center;gap:8px}.sy-page summary{cursor:pointer;color:var(--sy-muted);font-size:12px}.sy-page summary:hover{color:var(--sy-accent)}
.sy-columns{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:20px;align-items:start}.sy-columns>*,.sy-form-grid>*{min-width:0}.sy-box{background:var(--sy-card);border:1px solid var(--sy-border);border-radius:12px;padding:20px;margin-bottom:16px}.sy-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.sy-section-heading>div{display:flex;align-items:center;gap:8px}.sy-count{font-size:12px;color:var(--sy-muted);background:var(--sy-card);border:1px solid var(--sy-border);padding:1px 7px;border-radius:12px}
.sy-form{display:flex;flex-direction:column;gap:16px}.sy-form>header{padding-bottom:14px;border-bottom:1px solid var(--sy-border)}.sy-form>header .sy-note{margin-top:4px}.sy-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.sy-field{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:500}.sy-field input,.sy-field select{font-weight:400}.sy-form details{border-top:1px solid var(--sy-border);padding-top:12px}.sy-form details[open]>summary{margin-bottom:12px}.sy-form details .sy-field+.sy-field{margin-top:12px}.sy-checks{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px}.sy-form-footer{border-top:1px solid var(--sy-border);padding-top:16px;display:flex;gap:8px;justify-content:flex-end}
.sy-note{color:var(--sy-muted);font-size:12px;line-height:1.65}.sy-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}.sy-error{color:var(--sy-danger);white-space:pre-wrap;overflow-wrap:anywhere}.sy-alert{display:flex;align-items:flex-start;gap:9px;padding:11px 13px;border:1px solid var(--sy-border);border-radius:8px;font-size:12px;line-height:1.65;margin-bottom:16px;background:var(--sy-tint)}.sy-alert.sy-error{background:var(--sy-danger-bg);border-color:color-mix(in srgb,var(--sy-danger) 24%,transparent)}.sy-alert.sy-ok{color:var(--sy-success);background:var(--sy-success-bg)}
.sy-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:500;line-height:1.4;white-space:nowrap;background:var(--sy-bg);color:var(--sy-muted)}.sy-badge[data-tone=success]{color:var(--sy-success);background:var(--sy-success-bg)}.sy-badge[data-tone=error]{color:var(--sy-danger);background:var(--sy-danger-bg)}.sy-badge[data-tone=warning]{color:var(--sy-warn);background:var(--sy-warn-bg)}.sy-badge[data-tone=accent]{color:var(--sy-accent);background:var(--sy-tint)}.sy-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
.sy-kernel-title{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.sy-kernel-meta{display:flex;gap:14px;flex-wrap:wrap;color:var(--sy-muted);font-size:12px;margin-top:8px}.sy-kernel-status{margin:16px 0;padding:12px;border-radius:8px;background:var(--sy-bg);font-size:12px;line-height:1.65;overflow-wrap:anywhere}.sy-kernel-status[data-tone=error]{background:var(--sy-danger-bg);color:var(--sy-danger)}.sy-kernel-status[data-tone=success]{background:var(--sy-success-bg);color:var(--sy-success)}.sy-kernel-actions{border-top:1px solid var(--sy-border);padding-top:13px;margin-top:16px}.sy-instances{border-top:1px solid var(--sy-border);padding-top:14px}.sy-instances .sy-section-heading{margin-bottom:8px}.sy-instance-list{display:flex;flex-direction:column;gap:8px;margin-top:10px}.sy-instance{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--sy-border);border-radius:8px}.sy-instance[data-selected=true]{border-color:var(--sy-accent);background:var(--sy-tint)}.sy-instance strong{font-size:12px}.sy-instance .sy-note{margin-top:2px}
.sy-gateway{margin-top:20px}.sy-gateway summary{display:flex;align-items:center;justify-content:space-between;gap:12px;list-style:none;color:var(--sy-text)}.sy-gateway summary::-webkit-details-marker{display:none}.sy-gateway summary::after{content:'⌄';font-size:16px;color:var(--sy-muted)}.sy-gateway[open] summary{margin-bottom:16px}.sy-gateway .sy-note{margin:9px 0 12px}.sy-gateway-stats{display:flex;gap:8px;flex-wrap:wrap}.sy-gateway-stats .sy-badge{font-variant-numeric:tabular-nums}.sy-policy-note{margin-top:12px;padding:10px 12px;background:var(--sy-bg);border-radius:7px}
.sy-filters{display:grid;grid-template-columns:minmax(160px,2fr) minmax(90px,1fr) minmax(120px,1fr) minmax(100px,1fr);gap:10px;margin:16px 0}.sy-endpoint{display:grid;grid-template-columns:minmax(0,1fr) minmax(110px,auto);gap:16px;padding:16px 0;border-bottom:1px solid var(--sy-border)}.sy-endpoint strong{display:block;margin:6px 0}.sy-tag{font-size:11px;padding:2px 6px;border-radius:4px;background:var(--sy-bg);color:var(--sy-muted)}.sy-confirm{max-width:320px;margin-top:10px;line-height:1.6}.sy-confirm button{margin:8px 6px 0 0}
.sy-activity{padding:18px}.sy-activity .sy-shell{max-width:780px}.sy-activity .sy-heading{margin-bottom:16px;gap:10px}.sy-activity .sy-heading h2{font-size:17px;letter-spacing:0}.sy-activity .sy-heading-icon{width:36px;height:36px;border-radius:10px}.sy-activity-controls{padding:14px}.sy-activity-controls .sy-field+.sy-field{margin-top:12px}.sy-activity-controls details{margin-top:12px}.sy-activity-controls details .sy-note{margin-top:7px}.sy-results-bar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:18px 0 10px;color:var(--sy-muted);font-size:12px}.sy-pagination{display:flex;gap:5px}.sy-pagination button{min-height:28px;padding:4px 8px;font-size:12px}.sy-record{padding:14px;margin-bottom:10px}.sy-record-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.sy-record-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}.sy-record-title strong{font-size:13px;overflow-wrap:anywhere}.sy-record-time{display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;font-size:11px;color:var(--sy-muted)}.sy-record-head>button{font-size:11px;min-height:28px;flex-shrink:0;padding:4px 7px}.sy-record-endpoints{display:flex;flex-direction:column;gap:7px;margin-top:12px;padding:10px;background:var(--sy-bg);border-radius:7px}.sy-endpoint-line{display:flex;gap:7px;align-items:baseline;min-width:0}.sy-endpoint-line code{font-size:11px;overflow-wrap:anywhere}.sy-method{font-size:10px;color:var(--sy-accent);font-weight:650;flex-shrink:0}.sy-authorization{font-size:11px;color:var(--sy-muted);margin-top:3px}.sy-record .sy-alert{margin:10px 0 0}.sy-record-footer{margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.sy-record-footer details{max-width:100%;width:auto}.sy-record-footer details[open]{width:100%;padding-top:6px}.sy-record-footer details .sy-mono{margin-top:5px;font-size:11px;color:var(--sy-muted)}.sy-resources{display:flex;gap:7px;flex-wrap:wrap;font-size:11px}.sy-empty{text-align:center;padding:30px 16px;color:var(--sy-muted);border:1px dashed var(--sy-border);border-radius:10px}.sy-empty strong{display:block;color:var(--sy-text);margin-bottom:5px}
.sy-tool{padding:14px;background:var(--sy-card);border:1px solid var(--sy-border);border-radius:10px}.sy-tool pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto}.sy-tool .sy-bar{margin-bottom:8px}
@container(max-width:760px){.sy-columns{grid-template-columns:1fr}.sy-filters{grid-template-columns:1fr 1fr}.sy-endpoint{grid-template-columns:1fr}.sy-heading h2{font-size:20px}}
@container(max-width:440px){.sy-heading{align-items:flex-start}.sy-heading>.sy-quiet{padding:5px 7px;font-size:12px}.sy-form-grid{grid-template-columns:1fr}.sy-tabs button{min-width:0;padding:7px 10px}.sy-record-head{flex-wrap:wrap}.sy-record-head>button{margin-left:auto}.sy-toolbar{gap:8px}.sy-filters{grid-template-columns:1fr}.sy-gateway summary{flex-wrap:wrap}}
@media(prefers-color-scheme:dark){.sy-page,.sy-tool{--sy-bg:var(--dsw-alias-bg-layer-1,#171c24);--sy-card:var(--dsw-alias-bg-layer-2,#212833);--sy-text:var(--dsw-alias-text-primary,#e2e8f2);--sy-muted:var(--dsw-alias-label-secondary,#a0aec0);--sy-border:var(--dsw-alias-border-secondary,#364150);--sy-accent:#86adf4;--sy-tint:#263953;--sy-success:#87cba5;--sy-success-bg:#203b30;--sy-danger:#f3a0a4;--sy-danger-bg:#422a30;--sy-warn:#e8c183;--sy-warn-bg:#413623}.sy-page .sy-primary{color:#142339}.sy-page .sy-primary:hover:not(:disabled){background:#a1bef6;color:#142339}}
`;
        document.head.appendChild(style); return () => style.remove();
      }, "siyuan: styles");
    }
    function apply(ctx) {
      installStyle(ctx);
      ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "siyuan-control" }, Main));
      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: "siyuan-control", order: 31, label: () => "思源连接管理界面" }, Icon));
      ctx.inject(["sidebarRightTabs", "sidebarRight", "layout", "sessions"], scope => {
        const kind = "siyuan:activity";
        const { createRevealer } = ((function createActivityNavigation() {
  function sourceCall(entries, callId) {
    const call = entries.find(({ event }) => event.type === "tool/call" && event.data.callId === callId
      || (event.type === "tool/ptc-dispatch-start" || event.type === "tool/ptc-dispatch") && event.data.subCallId === callId);
    if (!call) return null;
    const rootCallId = call.event.type === "tool/call" ? callId : call.event.data.rootCallId;
    const root = entries.find(({ event }) => event.type === "tool/call" && event.data.callId === rootCallId);
    return { callId, rootCallId, seq: root?.event.seq ?? call.event.seq, rootLoaded: !!root };
  }
  /** 新点击、换会话和卸载都会使旧定位失效；分页操作由会话自身管理。 */
  function createRevealer({ sessionId, getWindow, loadThrough, isCurrent, showChat, document: doc = globalThis.document }) {
    let generation = 0; let disposed = false;
    const pending = new Map();
    function cancel() {
      generation++;
      for (const [timer, resolve] of pending) { clearTimeout(timer); resolve(); }
      pending.clear();
    }
    const pause = () => new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(timer); resolve(); }, 50);
      pending.set(timer, resolve);
    });
    function rootForSession() {
      // ID 只作完整值比较，不拼接进 CSS 选择器。
      const roots = [...doc.querySelectorAll('[data-conversation-session][data-conversation-region="chat"]')]
        .filter(root => root.getAttribute("data-conversation-session") === sessionId && root.getClientRects().length);
      return roots.length === 1 ? roots[0] : null;
    }
    return {
      cancel,
      dispose() { disposed = true; cancel(); },
      async reveal(callId) {
        cancel(); const ticket = generation;
        const check = () => {
          if (disposed || ticket !== generation || !isCurrent()) throw new Error("定位已取消：会话已切换或有新的定位请求");
        };
        check();
        showChat();
        let record = sourceCall(getWindow().entries, callId);
        // 活动来自持久记录，目标可能早于当前事件窗口；缺少序号时从正式分页接口补齐历史。
        if (!record && getWindow().hasMore) {
          await loadThrough(0); check(); record = sourceCall(getWindow().entries, callId);
        }
        if (!record) throw new Error("会话历史中未找到这次工具调用");
        await loadThrough(record.seq); check();
        if (record.rootCallId !== callId && !sourceCall(getWindow().entries, callId)?.rootLoaded) {
          await loadThrough(0); check();
        }
        let found = false;
        // 分页投影和 React 提交异步完成；仅在本次点击后作有上限的等待。
        for (let attempt = 0; attempt < 40; attempt++) {
          check();
          const root = rootForSession();
          const card = root && [...root.querySelectorAll("[data-chat-call-id]")]
            .find(element => element.getAttribute("data-chat-call-id") === callId);
          if (card) {
            found = true; const hidden = [];
            for (let element = card; element && element !== root; element = element.parentElement) {
              if (element.hasAttribute("hidden")) hidden.push(element);
            }
            if (hidden.length) {
              const outer = hidden.at(-1);
              if (outer.getAttribute("hidden") !== "until-found") throw new Error("此调用被当前视图隐藏，无法自动展开");
              // 从外向内交给宿主的折叠组件展开，不直接改 hidden、class 或 React 状态。
              outer.dispatchEvent(new doc.defaultView.Event("beforematch", { bubbles: false }));
            } else if (card.getClientRects().length) {
              card.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
              await pause(); check();
              if (!card.isConnected || card.closest("[hidden]")) continue;
              const rect = card.getBoundingClientRect();
              if (rect.bottom <= 0 || rect.top >= doc.defaultView.innerHeight) throw new Error("调用已展开，但未完成滚动，请再次定位");
              return { callId };
            }
          }
          await pause();
        }
        throw new Error(found ? "已找到工具调用，但折叠组尚未完成展开，请重试" : "聊天视图尚未显示对应调用，请稍后重试");
      },
    };
  }
  return Object.freeze({ sourceCall, createRevealer });
}))();
        const states = new Map(); let disposed = false;
        const sessions = scope.get("sessions"), sidebar = scope.get("sidebarRight"), layout = scope.get("layout");
        function openActivity(sessionId) {
          if (disposed || !sessionId || sidebar.mounted.getSnapshot() !== sessionId) throw new Error("请先打开对应会话，再查看思源活动");
          sidebar.openTab(kind);
          if (!sidebar.isExpanded()) layout.openRightbar(false, false);
        }
        function injected(sessionId) {
          const binding = sessions.binding(sessionId);
          if (!binding) throw new Error("思源活动无法取得当前会话");
          let state = states.get(binding);
          if (!state) {
            const revealer = createRevealer({ sessionId, getWindow: () => binding.eventSource.getSnapshot(),
              loadThrough: seq => binding.session.loadThrough(seq), showChat: () => layout.selectPanel(null),
              isCurrent: () => !disposed && sessions.binding(sessionId) === binding && sidebar.mounted.getSnapshot() === sessionId });
            const stopMounted = sidebar.mounted.subscribe(() => {
              if (sidebar.mounted.getSnapshot() !== sessionId) revealer.cancel();
            });
            let released = false;
            const release = () => {
              if (released) return; released = true;
              stopMounted(); revealer.dispose(); states.delete(binding);
            };
            state = { revealer, stop: binding.ctx.effect(() => release, "siyuan: navigation lifetime") };
            states.set(binding, state);
          }
          return { openActivity: () => openActivity(sessionId), openManagement: () => layout.selectPanel("siyuan-control"),
            revealCall: callId => state.revealer.reveal(callId) };
        }
        scope.effect(() => () => {
          disposed = true;
          for (const state of [...states.values()]) state.stop();
        }, "siyuan: navigation cleanup");
        for (const tool of ["siyuan_query", "siyuan_create", "siyuan_update", "siyuan_delete", "siyuan_rpc"]) {
          scope.slots.inject("tool.call.toolview", () => scope.slots.register({ name: "tool.call.toolview", key: tool, inject: injected }, ToolCall));
        }
        scope.effect(() => scope.get("sidebarRightTabs").register({ id: kind, kind, title: () => "思源活动" }), "siyuan: activity type");
        scope.slots.inject("sidebar.right.pane.tab", () => scope.slots.register({ name: "sidebar.right.pane.tab", key: kind, inject: injected }, Activity));
        scope.slots.inject("sidebar.right.pane.tab.title", () => scope.slots.register({ name: "sidebar.right.pane.tab.title", key: kind }, () => h("span", null, "思源活动")));
        function Opener({ wide }) {
          const [error, setError] = React.useState("");
          return h(React.Fragment, null, h("button", { type: "button", onClick: () => {
            try {
              openActivity(sidebar.mounted.getSnapshot());
              setError("");
            } catch { setError("请先打开一个会话，再查看思源活动"); }
          }, title: "本会话的思源活动", "aria-label": "思源活动", style: { display: "flex", alignItems: "center", gap: 6,
            border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 8 } }, h(Icon, {}), wide && "思源"),
            error && h("span", { role: "alert", style: { fontSize: 12 } }, error));
        }
        scope.slots.inject("sidebar.footer.action", () => scope.slots.register({ name: "sidebar.footer.action", id: "siyuan-activity", order: 51, label: () => "思源" }, Opener));
      });
    }
    return { inject: ["slots"], apply };
  },
});
