import {
  WIDGET_ID,
  SESSION_ID_RE,
  currentSessionId,
  isConnected,
  ws,
  pendingItems,
  localPendingItems,
  getEl,
  setWs,
  setIsConnected,
  setCurrentSessionId,
  setPendingItems,
  setLocalPendingItems,
  setWsReconnectTimeout,
  _wsReconnectTimeout,
} from "./widget-state.ts";

export const WS_BASE_URL = "__WEBSOCKET_BASE_URL__";
const RECONNECT_DELAY_MS = 3000;

export type MessageHandler = {
  onAnnotationRequest: (message: string) => void;
  onPendingUpdate: () => void;
  onItemAdded: () => void;
  onBatchSent: (count: number) => void;
  onNotification: (message: string) => void;
  onError: (message: string) => void;
};

let handlers: MessageHandler | null = null;

export function setMessageHandlers(h: MessageHandler) {
  handlers = h;
}

export function resolveSessionFromScript(): string | null {
  const candidates: string[] = [];
  if (document.currentScript && (document.currentScript as HTMLScriptElement).src) {
    candidates.push((document.currentScript as HTMLScriptElement).src);
  }
  const tagged = document.getElementById("claude-feedback-widget-script") as HTMLScriptElement | null;
  if (tagged && tagged.src) candidates.push(tagged.src);
  for (const src of candidates) {
    try {
      const u = new URL(src, location.href);
      const s = u.searchParams.get("session");
      if (s && SESSION_ID_RE.test(s)) return s;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function buildWsUrl(sessionId: string | null): string {
  return sessionId ? `${WS_BASE_URL}?session=${sessionId}` : WS_BASE_URL;
}

export function connectWebSocket(): void {
  try {
    const socket = new WebSocket(buildWsUrl(currentSessionId));
    setWs(socket);

    socket.onopen = () => {
      setIsConnected(true);
      updateButtonState();
      console.log("[Claude Feedback] Connected to feedback server");
      if (localPendingItems.length > 0) {
        try {
          for (const item of localPendingItems) {
            socket.send(JSON.stringify({ type: "feedback", payload: item }));
          }
          setLocalPendingItems([]);
        } catch (err) {
          console.warn("[Claude Feedback] Failed to flush pending items on reconnect:", err);
        }
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
      updateButtonState();
      console.log("[Claude Feedback] Disconnected from feedback server");
      setWsReconnectTimeout(setTimeout(connectWebSocket, RECONNECT_DELAY_MS));
    };

    socket.onerror = (err) => {
      console.warn("[Claude Feedback] WebSocket error:", err);
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string);
        handleServerMessage(message);
      } catch (err) {
        console.warn("[Claude Feedback] Error parsing message:", err);
      }
    };
  } catch (err) {
    console.warn("[Claude Feedback] Failed to connect:", err);
    setWsReconnectTimeout(setTimeout(connectWebSocket, RECONNECT_DELAY_MS));
  }
}

function handleServerMessage(message: Record<string, unknown>): void {
  if (message.type === "connected") {
    if (message.sessionWarning) {
      console.warn("[Claude Feedback]", message.sessionWarning);
    }
    if (message.duplicateWarning) {
      console.warn("[Claude Feedback]", message.duplicateWarning);
    }
    if (message.rebound && message.sessionId) {
      const rebound = message.rebound as { from: string; to: string };
      console.warn(`[Claude Feedback] Session rebound: ${rebound.from} -> ${rebound.to}`);
      setCurrentSessionId(message.sessionId as string);
    }
  } else if (message.type === "session_invalid") {
    const fresh = resolveSessionFromScript();
    if (fresh && fresh !== currentSessionId) {
      console.warn(
        `[Claude Feedback] Session refreshed from script src: ${currentSessionId} -> ${fresh}`,
      );
      setCurrentSessionId(fresh);
      if (_wsReconnectTimeout) clearTimeout(_wsReconnectTimeout);
      setWsReconnectTimeout(setTimeout(connectWebSocket, 100));
    } else {
      console.warn("[Claude Feedback] Session invalid:", message);
      showSessionInvalidBanner(message);
    }
  } else if (message.type === "pending_status") {
    setPendingItems((message.items as typeof pendingItems) || []);
    handlers?.onPendingUpdate();
  } else if (message.type === "feedback_deleted") {
    if (message.success) {
      console.log("[Claude Feedback] Feedback deleted:", message.id);
    }
  } else if (message.type === "request_annotation") {
    handlers?.onNotification((message.message as string) || "Claude is requesting your feedback");
    handlers?.onAnnotationRequest((message.message as string) || "");
  } else if (message.type === "request_multiple_annotations") {
    handlers?.onNotification(
      (message.message as string) || "Claude is requesting multiple annotations",
    );
    handlers?.onAnnotationRequest((message.message as string) || "");
  } else if (message.type === "feedback_received") {
    handlers?.onItemAdded();
  } else if (message.type === "sent_to_claude") {
    handlers?.onBatchSent(message.count as number);
  } else if (message.type === "push_failed") {
    handlers?.onError((message.reason as string) || "Failed to send feedback to Claude");
  }
}

export function updateButtonState(): void {
  const button = getEl(`${WIDGET_ID}-button`);
  const shortcutHint = getEl(`${WIDGET_ID}-button-shortcut`);
  if (button) {
    button.classList.toggle("disconnected", !isConnected);
  }
  if (shortcutHint) {
    shortcutHint.style.display = "inline";
  }
}

export function sendMessage(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function isSocketOpen(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

function showSessionInvalidBanner(message: Record<string, unknown>): void {
  const existing = document.getElementById("claude-feedback-session-invalid");
  if (existing) return;
  const banner = document.createElement("div");
  banner.id = "claude-feedback-session-invalid";
  banner.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:2147483647",
    "background:#b91c1c",
    "color:#fff",
    "padding:10px 16px",
    "font:14px/1.4 -apple-system,system-ui,sans-serif",
    "box-shadow:0 2px 8px rgba(0,0,0,.2)",
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "gap:12px",
  ].join(";");
  const text = document.createElement("span");
  text.textContent =
    ((message.reason as string) || null) ||
    "Claude feedback widget: session changed. Reload the page to reconnect.";
  const reload = document.createElement("button");
  reload.textContent = "Reload";
  reload.style.cssText =
    "background:#fff;color:#b91c1c;border:0;border-radius:4px;padding:6px 12px;font-weight:600;cursor:pointer";
  reload.addEventListener("click", () => location.reload());
  const dismiss = document.createElement("button");
  dismiss.textContent = "✕";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.style.cssText =
    "background:transparent;color:#fff;border:0;font-size:18px;cursor:pointer;padding:0 4px";
  dismiss.addEventListener("click", () => banner.remove());
  banner.append(text, reload, dismiss);
  document.body.appendChild(banner);
}
