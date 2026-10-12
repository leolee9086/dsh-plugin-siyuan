/** Harness 客户端适配器只负责网络与插槽接入，界面实现通过其领域入口创建。 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-siyuan",
  factory: require => {
    const React = require("react");
    const h = React.createElement;
    const ROUTE = "/api/siyuan-control";
    const ICON = "__SIYUAN_ICON__";
    async function get(params, signal) {
      const response = await fetch(`${ROUTE}?${new URLSearchParams(params)}`, { credentials: "same-origin", signal });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value;
    }
    async function post(value, signal) {
      const response = await fetch(ROUTE, { method: "POST", signal, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
    }
    // 构建嵌入同一份工厂，测试直接 import 此工厂；不为测试复制组件实现。
    const { Main, Activity, Icon, ToolCall } = (__SIYUAN_UI_FACTORY__)(React, { get, post, icon: ICON });
    function installStyle(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style"); style.id = "dsh-siyuan-style";
        style.textContent = `
.sy-page{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:24px;color:var(--dsw-alias-text-primary,inherit);background:var(--dsw-alias-bg-layer-1,transparent);font-size:13px}
.sy-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.sy-page input,.sy-page select,.sy-page button{min-height:34px}.sy-page input[type=checkbox]{min-height:0}.sy-page a{color:var(--dsw-alias-brand-primary)}
.sy-page h2,.sy-page h3,.sy-page p{margin:0 0 10px}.sy-page h2{font-size:22px}.sy-page h3{font-size:15px}
.sy-heading,.sy-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}.sy-heading{margin-bottom:22px}
.sy-page input:not([type=checkbox]),.sy-page select{box-sizing:border-box;min-width:0;padding:7px 10px;border:1px solid var(--dsw-alias-border-secondary);border-radius:6px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit}
.sy-page button{padding:7px 12px;border:1px solid var(--dsw-alias-border-secondary);border-radius:6px;color:inherit;background:var(--dsw-alias-bg-layer-1,transparent);font:inherit;cursor:pointer}
.sy-page button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.sy-page button:disabled{opacity:.45;cursor:default}.sy-page button[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary)}
.sy-columns{display:grid;grid-template-columns:minmax(260px,1fr) minmax(300px,1fr);gap:24px;align-items:start}.sy-box{border:1px solid var(--dsw-alias-border-secondary);border-radius:10px;padding:16px;margin-bottom:14px}
.sy-form{display:flex;flex-direction:column;gap:12px}.sy-field{display:flex;flex-direction:column;gap:6px}.sy-field input{width:100%}.sy-note{color:var(--dsw-alias-label-secondary,#777);line-height:1.65}.sy-error{color:var(--dsw-alias-text-error,inherit);white-space:pre-wrap;overflow-wrap:anywhere}
.sy-mono{font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere}.sy-filters{display:grid;grid-template-columns:minmax(160px,2fr) minmax(90px,1fr) minmax(150px,1fr) minmax(100px,1fr);gap:10px;margin:16px 0}
.sy-endpoint{display:grid;grid-template-columns:minmax(0,1fr) minmax(110px,auto);gap:16px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-secondary)}.sy-endpoint strong{display:block;margin:6px 0}.sy-tag{font-size:11px;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2)}
.sy-tool{font-size:13px;color:var(--dsw-alias-text-primary,inherit)}.sy-tool pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto}.sy-tool:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.sy-tool button{cursor:pointer;color:inherit;background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-secondary);border-radius:6px;padding:6px 10px}
.sy-confirm{max-width:320px;margin-top:10px;line-height:1.6}.sy-confirm button{margin-right:6px}.sy-activity{padding:14px}.sy-activity .sy-box{padding:12px}.sy-activity input[type=search]{width:100%}
@media(max-width:800px){.sy-columns{grid-template-columns:1fr}.sy-filters{grid-template-columns:1fr 1fr}.sy-page{padding:16px}.sy-endpoint{grid-template-columns:1fr}}
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
        const { createRevealer } = (__SIYUAN_NAVIGATION_FACTORY__)();
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
