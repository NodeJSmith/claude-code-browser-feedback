// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  WIDGET_ID,
  SESSION_ID_RE,
  getEl,
  getAllPendingItems,
  resetState,
  setShadowRoot,
  setWs,
  setIsConnected,
  setIsAnnotationMode,
  setSelectedElement,
  setConsoleLogs,
  setPendingItems,
  setLocalPendingItems,
  setIsPendingQueueOpen,
  setCurrentSessionId,
  setHoveredElement,
  setListeners,
  setSelfHealObserver,
  setSelfHealInterval,
  setWsReconnectTimeout,
  shadowRoot,
  ws,
  isConnected,
  isAnnotationMode,
  selectedElement,
  consoleLogs,
  pendingItems,
  localPendingItems,
  isPendingQueueOpen,
  currentSessionId,
  hoveredElement,
  _listeners,
  _selfHealObserver,
  _selfHealInterval,
  _wsReconnectTimeout,
} from "../src/widget/widget-state.ts";
import { makeFeedbackItem } from "./helpers.ts";

beforeEach(() => {
  resetState();
  setShadowRoot(null);
  setWs(null);
  setIsConnected(false);
  setCurrentSessionId(null);
  setListeners({});
  setSelfHealObserver(null);
  setSelfHealInterval(null);
  setWsReconnectTimeout(null);
});

describe("constants", () => {
  it("WIDGET_ID is a non-empty string", () => {
    expect(WIDGET_ID).toBe("claude-feedback-widget");
  });

  it("SESSION_ID_RE matches valid UUIDs", () => {
    expect(SESSION_ID_RE.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(SESSION_ID_RE.test("not-a-uuid")).toBe(false);
  });
});

describe("setters and getters", () => {
  it("setShadowRoot / shadowRoot", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    setShadowRoot(root);
    expect(shadowRoot).toBe(root);
  });

  it("setIsConnected / isConnected", () => {
    setIsConnected(true);
    expect(isConnected).toBe(true);
  });

  it("setIsAnnotationMode / isAnnotationMode", () => {
    setIsAnnotationMode(true);
    expect(isAnnotationMode).toBe(true);
  });

  it("setSelectedElement / selectedElement", () => {
    const el = document.createElement("div");
    setSelectedElement(el);
    expect(selectedElement).toBe(el);
  });

  it("setConsoleLogs / consoleLogs", () => {
    const logs = [{ type: "log", timestamp: "t", message: "hi" }];
    setConsoleLogs(logs);
    expect(consoleLogs).toEqual(logs);
  });

  it("setPendingItems / pendingItems", () => {
    const items = [makeFeedbackItem()];
    setPendingItems(items);
    expect(pendingItems).toEqual(items);
  });

  it("setLocalPendingItems / localPendingItems", () => {
    const items = [makeFeedbackItem({ id: "local-1" })];
    setLocalPendingItems(items);
    expect(localPendingItems).toEqual(items);
  });

  it("setIsPendingQueueOpen / isPendingQueueOpen", () => {
    setIsPendingQueueOpen(true);
    expect(isPendingQueueOpen).toBe(true);
  });

  it("setCurrentSessionId / currentSessionId", () => {
    setCurrentSessionId("abc-123");
    expect(currentSessionId).toBe("abc-123");
  });

  it("setHoveredElement / hoveredElement", () => {
    const el = document.createElement("span");
    setHoveredElement(el);
    expect(hoveredElement).toBe(el);
  });

  it("setListeners / _listeners", () => {
    const fn = () => {};
    setListeners({ onDocumentKeydown: fn as EventListener });
    expect(_listeners.onDocumentKeydown).toBe(fn);
  });

  it("setSelfHealObserver / _selfHealObserver", () => {
    const observer = new MutationObserver(() => {});
    setSelfHealObserver(observer);
    expect(_selfHealObserver).toBe(observer);
  });

  it("setSelfHealInterval / _selfHealInterval", () => {
    const id = setInterval(() => {}, 1000);
    setSelfHealInterval(id);
    expect(_selfHealInterval).toBe(id);
    clearInterval(id);
  });

  it("setWsReconnectTimeout / _wsReconnectTimeout", () => {
    const id = setTimeout(() => {}, 1000);
    setWsReconnectTimeout(id);
    expect(_wsReconnectTimeout).toBe(id);
    clearTimeout(id);
  });
});

describe("getEl", () => {
  it("returns element from shadow root by id", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("div");
    inner.id = "test-el";
    root.appendChild(inner);
    setShadowRoot(root);

    expect(getEl("test-el")).toBe(inner);
  });

  it("returns null when shadow root is not set", () => {
    expect(getEl("anything")).toBeNull();
  });

  it("returns null for non-existent id", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    setShadowRoot(root);
    expect(getEl("missing")).toBeNull();
  });
});

describe("getAllPendingItems", () => {
  it("returns pendingItems when connected", () => {
    const serverItems = [makeFeedbackItem({ id: "server-1" })];
    setPendingItems(serverItems);
    setLocalPendingItems([makeFeedbackItem({ id: "local-1" })]);
    setIsConnected(true);

    expect(getAllPendingItems()).toEqual(serverItems);
  });

  it("returns localPendingItems when disconnected", () => {
    const localItems = [makeFeedbackItem({ id: "local-1" })];
    setPendingItems([makeFeedbackItem({ id: "server-1" })]);
    setLocalPendingItems(localItems);
    setIsConnected(false);

    expect(getAllPendingItems()).toEqual(localItems);
  });
});

describe("resetState", () => {
  it("clears all mutable state", () => {
    setConsoleLogs([{ type: "log", timestamp: "t", message: "hi" }]);
    setPendingItems([makeFeedbackItem()]);
    setLocalPendingItems([makeFeedbackItem()]);
    setSelectedElement(document.createElement("div"));
    setIsAnnotationMode(true);
    setIsPendingQueueOpen(true);
    setHoveredElement(document.createElement("span"));

    resetState();

    expect(consoleLogs).toEqual([]);
    expect(pendingItems).toEqual([]);
    expect(localPendingItems).toEqual([]);
    expect(selectedElement).toBeNull();
    expect(isAnnotationMode).toBe(false);
    expect(isPendingQueueOpen).toBe(false);
    expect(hoveredElement).toBeNull();
  });
});
