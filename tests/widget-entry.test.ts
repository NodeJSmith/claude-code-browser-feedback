// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WIDGET_ID } from "../src/widget/widget-state.ts";

let originalWebSocket: typeof WebSocket;
let mockSocket: Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();

  window.__CLAUDE_FEEDBACK_WIDGET__ = false;
  delete window.__claudeFeedbackDestroy;

  const existing = document.getElementById(WIDGET_ID);
  if (existing) existing.remove();

  mockSocket = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  };
  originalWebSocket = globalThis.WebSocket;
  const socket = mockSocket;
  globalThis.WebSocket = class MockWebSocket {
    onopen = null;
    onclose = null;
    onerror = null;
    onmessage = null;
    readyState = 1;
    send = socket.send as () => void;
    close = socket.close as () => void;
    static OPEN = 1;
    static CLOSED = 3;
    static CONNECTING = 0;
    static CLOSING = 2;
    constructor() {
      Object.assign(socket, this);
    }
  } as unknown as typeof WebSocket;
});

afterEach(() => {
  if (window.__claudeFeedbackDestroy) {
    window.__claudeFeedbackDestroy();
  }
  globalThis.WebSocket = originalWebSocket;
});

async function loadWidget() {
  await import("../src/widget/widget.ts");
}

describe("widget entry point", () => {
  it("sets __CLAUDE_FEEDBACK_WIDGET__ guard to true", async () => {
    await loadWidget();
    expect(window.__CLAUDE_FEEDBACK_WIDGET__).toBe(true);
  });

  it("registers __claudeFeedbackDestroy function", async () => {
    await loadWidget();
    expect(typeof window.__claudeFeedbackDestroy).toBe("function");
  });

  it("creates the widget host element in DOM", async () => {
    await loadWidget();
    expect(document.getElementById(WIDGET_ID)).not.toBeNull();
  });

  it("connects to WebSocket", async () => {
    await loadWidget();
    const { ws } = await import("../src/widget/widget-state.ts");
    expect(ws).not.toBeNull();
  });

  it("does not initialize twice", async () => {
    await loadWidget();
    const firstHost = document.getElementById(WIDGET_ID);

    vi.resetModules();
    await import("../src/widget/widget.ts");

    expect(document.querySelectorAll(`#${WIDGET_ID}`).length).toBe(1);
  });
});

describe("destroy", () => {
  it("removes widget from DOM", async () => {
    await loadWidget();
    expect(document.getElementById(WIDGET_ID)).not.toBeNull();

    window.__claudeFeedbackDestroy!();

    expect(document.getElementById(WIDGET_ID)).toBeNull();
  });

  it("resets the guard flag", async () => {
    await loadWidget();
    window.__claudeFeedbackDestroy!();

    expect(window.__CLAUDE_FEEDBACK_WIDGET__).toBe(false);
    expect(window.__claudeFeedbackDestroy).toBeUndefined();
  });

  it("closes the WebSocket connection", async () => {
    await loadWidget();
    const { ws } = await import("../src/widget/widget-state.ts");
    const closeSpy = vi.spyOn(ws!, "close");

    window.__claudeFeedbackDestroy!();

    expect(closeSpy).toHaveBeenCalled();
  });
});

describe("console capture", () => {
  it("captures console.log calls", async () => {
    await loadWidget();

    const { consoleLogs } = await import("../src/widget/widget-state.ts");
    const countBefore = consoleLogs.length;
    console.log("test capture message");
    expect(consoleLogs.length).toBeGreaterThan(countBefore);
    expect(consoleLogs.some((l) => l.message.includes("test capture message"))).toBe(true);
  });

  it("restores original console methods on destroy", async () => {
    const originalLog = console.log;
    await loadWidget();

    expect(console.log).not.toBe(originalLog);

    window.__claudeFeedbackDestroy!();

    expect(console.log).toBe(originalLog);
  });
});
