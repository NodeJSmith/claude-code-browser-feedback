// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveSessionFromScript,
  sendMessage,
  isSocketOpen,
  updateButtonState,
  setMessageHandlers,
  connectWebSocket,
  type MessageHandler,
} from "../src/widget/widget-connection.ts";
import * as state from "../src/widget/widget-state.ts";
import {
  WIDGET_ID,
  setWs,
  setIsConnected,
  setShadowRoot,
  setCurrentSessionId,
  setWsReconnectTimeout,
  resetState,
} from "../src/widget/widget-state.ts";

function setupShadowDom(): ShadowRoot {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });

  const button = document.createElement("button");
  button.id = `${WIDGET_ID}-button`;
  root.appendChild(button);

  const shortcut = document.createElement("span");
  shortcut.id = `${WIDGET_ID}-button-shortcut`;
  shortcut.style.display = "none";
  root.appendChild(shortcut);

  setShadowRoot(root);
  return root;
}

function makeMockWs(readyState: number): WebSocket {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    OPEN: 1,
    CLOSED: 3,
  } as unknown as WebSocket;
}

beforeEach(() => {
  resetState();
  setWs(null);
  setIsConnected(false);
  setShadowRoot(null);
  setCurrentSessionId(null);
  setWsReconnectTimeout(null);
  document.body.innerHTML = "";
  const taggedScript = document.getElementById("claude-feedback-widget-script");
  if (taggedScript) taggedScript.remove();
});

describe("resolveSessionFromScript", () => {
  it("returns null when no script elements exist", () => {
    expect(resolveSessionFromScript()).toBeNull();
  });

  it("extracts session from tagged script element", () => {
    const script = document.createElement("script");
    script.id = "claude-feedback-widget-script";
    script.setAttribute("src", "http://localhost:9877/widget.js?session=550e8400-e29b-41d4-a716-446655440000");
    document.head.appendChild(script);

    expect(resolveSessionFromScript()).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns null for invalid session in script src", () => {
    const script = document.createElement("script");
    script.id = "claude-feedback-widget-script";
    script.setAttribute("src", "http://localhost:9877/widget.js?session=not-a-uuid");
    document.head.appendChild(script);

    expect(resolveSessionFromScript()).toBeNull();
  });

  it("returns null when script has no session param", () => {
    const script = document.createElement("script");
    script.id = "claude-feedback-widget-script";
    script.setAttribute("src", "http://localhost:9877/widget.js");
    document.head.appendChild(script);

    expect(resolveSessionFromScript()).toBeNull();
  });
});

describe("sendMessage", () => {
  it("sends JSON when socket is open", () => {
    const mockWs = makeMockWs(WebSocket.OPEN);
    setWs(mockWs);

    sendMessage({ type: "test", data: "hello" });

    expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "test", data: "hello" }));
  });

  it("does nothing when socket is null", () => {
    setWs(null);
    expect(() => sendMessage({ type: "test" })).not.toThrow();
  });

  it("does nothing when socket is not open", () => {
    const mockWs = makeMockWs(WebSocket.CLOSED);
    setWs(mockWs);

    sendMessage({ type: "test" });

    expect(mockWs.send).not.toHaveBeenCalled();
  });
});

describe("isSocketOpen", () => {
  it("returns true when socket is open", () => {
    setWs(makeMockWs(WebSocket.OPEN));
    expect(isSocketOpen()).toBe(true);
  });

  it("returns false when socket is null", () => {
    setWs(null);
    expect(isSocketOpen()).toBe(false);
  });

  it("returns false when socket is closed", () => {
    setWs(makeMockWs(WebSocket.CLOSED));
    expect(isSocketOpen()).toBe(false);
  });
});

describe("updateButtonState", () => {
  it("adds disconnected class when not connected", () => {
    const root = setupShadowDom();
    setIsConnected(false);

    updateButtonState();

    const button = root.getElementById(`${WIDGET_ID}-button`)!;
    expect(button.classList.contains("disconnected")).toBe(true);
  });

  it("removes disconnected class when connected", () => {
    const root = setupShadowDom();
    const button = root.getElementById(`${WIDGET_ID}-button`)!;
    button.classList.add("disconnected");
    setIsConnected(true);

    updateButtonState();

    expect(button.classList.contains("disconnected")).toBe(false);
  });

  it("shows shortcut hint", () => {
    const root = setupShadowDom();
    setIsConnected(true);

    updateButtonState();

    const shortcut = root.getElementById(`${WIDGET_ID}-button-shortcut`)!;
    expect(shortcut.style.display).toBe("inline");
  });
});

function setupMockWebSocket() {
  setupShadowDom();
  const originalWS = globalThis.WebSocket;
  const socket = {
    onopen: null as ((ev: unknown) => void) | null,
    onclose: null as ((ev: unknown) => void) | null,
    onerror: null as ((ev: unknown) => void) | null,
    onmessage: null as ((ev: { data: string }) => void) | null,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  };
  globalThis.WebSocket = class {
    constructor() { return socket; }
    static OPEN = 1;
    static CLOSED = 3;
    static CONNECTING = 0;
    static CLOSING = 2;
  } as unknown as typeof WebSocket;

  return { socket, restore: () => { globalThis.WebSocket = originalWS; } };
}

function dispatch(socket: { onmessage: ((ev: { data: string }) => void) | null }, msg: Record<string, unknown>) {
  socket.onmessage!({ data: JSON.stringify(msg) });
}

describe("connectWebSocket lifecycle", () => {
  it("sets isConnected true on open", () => {
    const { socket, restore } = setupMockWebSocket();
    try {
      connectWebSocket();
      socket.onopen!({});
      expect(state.isConnected).toBe(true);
    } finally { restore(); }
  });

  it("sets isConnected false on close", () => {
    const { socket, restore } = setupMockWebSocket();
    try {
      connectWebSocket();
      socket.onopen!({});
      socket.onclose!({});
      expect(state.isConnected).toBe(false);
    } finally { restore(); }
  });
});

describe("message dispatch via connectWebSocket", () => {
  let socket: ReturnType<typeof setupMockWebSocket>["socket"];
  let handlers: MessageHandler;
  let restore: () => void;

  beforeEach(() => {
    const h: MessageHandler = {
      onAnnotationRequest: vi.fn(),
      onPendingUpdate: vi.fn(),
      onItemAdded: vi.fn(),
      onBatchSent: vi.fn(),
      onNotification: vi.fn(),
      onError: vi.fn(),
    };
    setMessageHandlers(h);
    const mock = setupMockWebSocket();
    connectWebSocket();
    socket = mock.socket;
    restore = mock.restore;
    handlers = h;
  });

  afterEach(() => {
    restore();
    const banner = document.getElementById("claude-feedback-session-invalid");
    if (banner) banner.remove();
  });

  it("does not throw on 'connected' with sessionWarning", () => {
    expect(() => dispatch(socket, { type: "connected", sessionWarning: "no session param" })).not.toThrow();
  });

  it("does not throw on 'connected' with duplicateWarning", () => {
    expect(() => dispatch(socket, { type: "connected", duplicateWarning: "another tab open" })).not.toThrow();
  });

  it("updates session ID on 'connected' with rebound", () => {
    dispatch(socket, { type: "connected", sessionId: "new-id", rebound: { from: "old", to: "new-id" } });
    expect(state.currentSessionId).toBe("new-id");
  });

  it("shows banner on 'session_invalid' when no fresh session available", () => {
    dispatch(socket, { type: "session_invalid", reason: "session expired" });
    expect(document.getElementById("claude-feedback-session-invalid")).not.toBeNull();
  });

  it("calls onPendingUpdate on 'pending_status'", () => {
    dispatch(socket, { type: "pending_status", items: [{ id: "p1" }] });
    expect(handlers.onPendingUpdate).toHaveBeenCalled();
  });

  it("does not throw on 'feedback_deleted'", () => {
    expect(() => dispatch(socket, { type: "feedback_deleted", success: true, id: "fb-1" })).not.toThrow();
  });

  it("calls onAnnotationRequest on 'request_annotation'", () => {
    dispatch(socket, { type: "request_annotation", message: "Please annotate" });
    expect(handlers.onAnnotationRequest).toHaveBeenCalledWith("Please annotate");
    expect(handlers.onNotification).toHaveBeenCalled();
  });

  it("calls onAnnotationRequest on 'request_multiple_annotations'", () => {
    dispatch(socket, { type: "request_multiple_annotations", message: "Multiple needed" });
    expect(handlers.onAnnotationRequest).toHaveBeenCalledWith("Multiple needed");
    expect(handlers.onNotification).toHaveBeenCalled();
  });

  it("calls onItemAdded on 'feedback_received'", () => {
    dispatch(socket, { type: "feedback_received" });
    expect(handlers.onItemAdded).toHaveBeenCalled();
  });

  it("calls onBatchSent on 'sent_to_claude'", () => {
    dispatch(socket, { type: "sent_to_claude", count: 3 });
    expect(handlers.onBatchSent).toHaveBeenCalledWith(3);
  });

  it("does not throw on malformed JSON", () => {
    expect(() => socket.onmessage!({ data: "not json" })).not.toThrow();
  });
});
