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
