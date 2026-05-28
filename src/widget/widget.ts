import {
  WIDGET_ID,
  consoleLogs,
  ws,
  shadowRoot,
  _listeners,
  _selfHealObserver,
  _selfHealInterval,
  _wsReconnectTimeout,
  setWs,
  setIsConnected,
  setShadowRoot,
  setListeners,
  setSelfHealObserver,
  setSelfHealInterval,
  setWsReconnectTimeout,
  resetState,
  type ConsoleLogEntry,
} from "./widget-state.ts";
import { createWidget } from "./widget-dom.ts";
import {
  connectWebSocket,
  updateButtonState,
  resolveSessionFromScript,
  setMessageHandlers,
} from "./widget-connection.ts";
import {
  bindEvents,
  updatePendingUI,
  startAnnotationMode,
  showNotification,
  showItemAdded,
  showBatchSuccess,
} from "./widget-annotation.ts";
import { setCurrentSessionId } from "./widget-state.ts";

const WIDGET_VERSION = "__WIDGET_VERSION__";

declare global {
  interface Window {
    __CLAUDE_FEEDBACK_WIDGET__: boolean;
    __claudeFeedbackDestroy?: () => void;
  }
}

if (!window.__CLAUDE_FEEDBACK_WIDGET__) {
  window.__CLAUDE_FEEDBACK_WIDGET__ = true;

  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  function captureConsoleLogs() {
    (["log", "warn", "error"] as const).forEach((method) => {
      console[method] = function (...args: unknown[]) {
        consoleLogs.push({
          type: method,
          timestamp: new Date().toISOString(),
          message: args
            .map((arg) => {
              try {
                return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
              } catch {
                return String(arg);
              }
            })
            .join(" "),
        });
        if (consoleLogs.length > 50) consoleLogs.shift();
        originalConsole[method].apply(console, args);
      };
    });
  }

  function onWindowError(event: ErrorEvent) {
    consoleLogs.push({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
      stack: event.error?.stack,
    });
  }
  window.addEventListener("error", onWindowError);

  function ensureWidgetInDOM() {
    if (!document.getElementById(WIDGET_ID)) {
      console.log("[Claude Feedback] Widget DOM removed, re-injecting");
      createWidget(bindEvents);
      updateButtonState();
      updatePendingUI();
    }
  }

  function startSelfHealing() {
    const observer = new MutationObserver(() => {
      if (document.getElementById(WIDGET_ID)) return;
      Promise.resolve().then(ensureWidgetInDOM);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setSelfHealObserver(observer);

    setSelfHealInterval(
      setInterval(() => {
        ensureWidgetInDOM();
      }, 2000),
    );
  }

  function destroy() {
    if (_selfHealObserver) {
      _selfHealObserver.disconnect();
      setSelfHealObserver(null);
    }
    if (_selfHealInterval) {
      clearInterval(_selfHealInterval);
      setSelfHealInterval(null);
    }

    if (_wsReconnectTimeout) {
      clearTimeout(_wsReconnectTimeout);
      setWsReconnectTimeout(null);
    }
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      setWs(null);
    }
    setIsConnected(false);

    if (_listeners.onDocumentMousemove) {
      document.removeEventListener("mousemove", _listeners.onDocumentMousemove);
    }
    if (_listeners.onDocumentMouseup) {
      document.removeEventListener("mouseup", _listeners.onDocumentMouseup);
    }
    if (_listeners.onDocumentKeydown) {
      document.removeEventListener("keydown", _listeners.onDocumentKeydown);
    }
    if (_listeners.onShadowRootKeydown && shadowRoot) {
      shadowRoot.removeEventListener("keydown", _listeners.onShadowRootKeydown);
    }
    if (_listeners.onWindowResize) {
      window.removeEventListener("resize", _listeners.onWindowResize);
    }
    window.removeEventListener("error", onWindowError);
    setListeners({});

    const host = document.getElementById(WIDGET_ID);
    if (host) host.remove();
    setShadowRoot(null);

    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;

    window.__CLAUDE_FEEDBACK_WIDGET__ = false;
    delete window.__claudeFeedbackDestroy;

    resetState();

    originalConsole.log("[Claude Feedback] Widget destroyed");
  }

  window.__claudeFeedbackDestroy = destroy;

  setMessageHandlers({
    onAnnotationRequest: () => startAnnotationMode(),
    onPendingUpdate: () => updatePendingUI(),
    onItemAdded: () => showItemAdded(),
    onBatchSent: (count) => showBatchSuccess(count),
    onNotification: (msg) => showNotification(msg),
    onError: () => {},
  });

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
      return;
    }

    setCurrentSessionId(resolveSessionFromScript());
    captureConsoleLogs();
    createWidget(bindEvents);
    connectWebSocket();
    startSelfHealing();

    console.log(`[Claude Feedback] Widget v${WIDGET_VERSION} initialized`);
  }

  init();
}
