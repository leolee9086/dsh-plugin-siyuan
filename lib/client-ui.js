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
}
