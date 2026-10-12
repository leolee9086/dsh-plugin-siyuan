/** 会话活动导航：通过正式历史分页加载记录，通过聊天标记与原生 beforematch 展开定位。 */
export function createActivityNavigation() {
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
}
