// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createWidget } from "../src/widget/widget-dom.ts";
import {
  startAnnotationMode,
  stopAnnotationMode,
  showPanel,
  hidePanel,
  addItem,
  updatePendingUI,
  toggleQueuePanel,
  closeQueuePanel,
  deletePendingItem,
  showSuccess,
  showError,
  showBatchSuccess,
  showItemAdded,
  downloadFile,
  bindEvents,
} from "../src/widget/widget-annotation.ts";
import * as state from "../src/widget/widget-state.ts";
import {
  WIDGET_ID,
  getEl,
  setShadowRoot,
  setIsAnnotationMode,
  setIsConnected,
  setSelectedElement,
  setHoveredElement,
  setIsPendingQueueOpen,
  setPendingItems,
  setLocalPendingItems,
  setWs,
  resetState,
  selectedElement,
  pendingItems,
  localPendingItems,
} from "../src/widget/widget-state.ts";
import { makeFeedbackItem } from "./helpers.ts";

const isAnnotationMode = () => state.isAnnotationMode;
const isPendingQueueOpen = () => state.isPendingQueueOpen;

function setupWidget() {
  createWidget(() => {});
}

beforeEach(() => {
  resetState();
  setWs(null);
  setIsConnected(false);
  setShadowRoot(null);
  setIsPendingQueueOpen(false);
  const existing = document.getElementById(WIDGET_ID);
  if (existing) existing.remove();
  setupWidget();
});

describe("startAnnotationMode", () => {
  it("activates overlay and instructions", () => {
    startAnnotationMode();

    expect(isAnnotationMode()).toBe(true);
    expect(getEl(`${WIDGET_ID}-overlay`)!.classList.contains("active")).toBe(true);
    expect(getEl(`${WIDGET_ID}-instructions`)!.classList.contains("active")).toBe(true);
  });
});

describe("stopAnnotationMode", () => {
  it("deactivates overlay, instructions, highlight, and tooltip", () => {
    startAnnotationMode();
    setHoveredElement(document.createElement("div"));

    stopAnnotationMode();

    expect(isAnnotationMode()).toBe(false);
    expect(getEl(`${WIDGET_ID}-overlay`)!.classList.contains("active")).toBe(false);
    expect(getEl(`${WIDGET_ID}-instructions`)!.classList.contains("active")).toBe(false);
    expect(getEl(`${WIDGET_ID}-highlight`)!.style.display).toBe("none");
    expect(getEl(`${WIDGET_ID}-tooltip`)!.style.display).toBe("none");
  });
});

describe("showPanel / hidePanel", () => {
  it("showPanel activates panel and focuses description", async () => {
    const el = document.createElement("button");
    el.textContent = "Click me";
    document.body.appendChild(el);
    setSelectedElement(el);

    await showPanel();

    const panel = getEl(`${WIDGET_ID}-panel`)!;
    expect(panel.classList.contains("active")).toBe(true);
  });

  it("showPanel displays element info when element is selected", async () => {
    const el = document.createElement("button");
    el.id = "test-btn";
    document.body.appendChild(el);
    setSelectedElement(el);

    await showPanel();

    const infoEl = getEl(`${WIDGET_ID}-element-info`)!;
    expect(infoEl.innerHTML).toContain("button");
  });

  it("hidePanel deactivates panel and clears description", () => {
    const panel = getEl(`${WIDGET_ID}-panel`)!;
    panel.classList.add("active");
    (getEl(`${WIDGET_ID}-description`) as HTMLTextAreaElement).value = "some text";
    setSelectedElement(document.createElement("div"));

    hidePanel();

    expect(panel.classList.contains("active")).toBe(false);
    expect((getEl(`${WIDGET_ID}-description`) as HTMLTextAreaElement).value).toBe("");
    expect(selectedElement).toBeNull();
  });
});

describe("updatePendingUI", () => {
  it("shows button group when items are pending", () => {
    setIsConnected(true);
    setPendingItems([makeFeedbackItem()]);

    updatePendingUI();

    const mainButton = getEl(`${WIDGET_ID}-button`)!;
    const buttonGroup = getEl(`${WIDGET_ID}-button-group`)!;
    expect(mainButton.style.display).toBe("none");
    expect(buttonGroup.classList.contains("visible")).toBe(true);
  });

  it("shows main button when no items pending", () => {
    setIsConnected(true);
    setPendingItems([]);

    updatePendingUI();

    const mainButton = getEl(`${WIDGET_ID}-button`)!;
    expect(mainButton.style.display).toBe("flex");
  });

  it("updates pending count text", () => {
    setIsConnected(true);
    setPendingItems([makeFeedbackItem({ id: "a" }), makeFeedbackItem({ id: "b" })]);

    updatePendingUI();

    const count = getEl(`${WIDGET_ID}-pending-count`)!;
    expect(count.textContent).toBe("2");
  });

  it("hides send button when disconnected", () => {
    setIsConnected(false);
    setLocalPendingItems([makeFeedbackItem()]);

    updatePendingUI();

    const sendBtnGroup = getEl(`${WIDGET_ID}-send-btn-group`)!;
    expect(sendBtnGroup.style.display).toBe("none");
  });

  it("renders queue items with selector and description", () => {
    setIsConnected(true);
    setPendingItems([makeFeedbackItem({ id: "fb-1", description: "misaligned" })]);

    updatePendingUI();

    const queueList = getEl(`${WIDGET_ID}-queue-list`)!;
    const items = queueList.querySelectorAll(`.${WIDGET_ID}-queue-item`);
    expect(items.length).toBe(1);
  });

  it("closes queue panel when items become empty", () => {
    setIsConnected(true);
    setPendingItems([makeFeedbackItem()]);
    setIsPendingQueueOpen(true);
    const queuePanel = getEl(`${WIDGET_ID}-queue-panel`)!;
    queuePanel.classList.add("active");

    setPendingItems([]);
    updatePendingUI();

    expect(isPendingQueueOpen()).toBe(false);
  });
});

describe("toggleQueuePanel / closeQueuePanel", () => {
  it("toggleQueuePanel opens and closes", () => {
    toggleQueuePanel();
    expect(isPendingQueueOpen()).toBe(true);
    expect(getEl(`${WIDGET_ID}-queue-panel`)!.classList.contains("active")).toBe(true);

    toggleQueuePanel();
    expect(isPendingQueueOpen()).toBe(false);
    expect(getEl(`${WIDGET_ID}-queue-panel`)!.classList.contains("active")).toBe(false);
  });

  it("closeQueuePanel always closes", () => {
    setIsPendingQueueOpen(true);
    getEl(`${WIDGET_ID}-queue-panel`)!.classList.add("active");

    closeQueuePanel();

    expect(isPendingQueueOpen()).toBe(false);
    expect(getEl(`${WIDGET_ID}-queue-panel`)!.classList.contains("active")).toBe(false);
  });
});

describe("deletePendingItem", () => {
  it("removes item from local pending when offline", () => {
    setIsConnected(false);
    setWs(null);
    setLocalPendingItems([makeFeedbackItem({ id: "a" }), makeFeedbackItem({ id: "b" })]);

    deletePendingItem("a");

    expect(localPendingItems.length).toBe(1);
    expect(localPendingItems[0].id).toBe("b");
  });

  it("sends delete message when online", () => {
    const send = vi.fn();
    const mockWs = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    setWs(mockWs);
    setIsConnected(true);
    setPendingItems([makeFeedbackItem({ id: "x" })]);

    deletePendingItem("x");

    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "delete_feedback", id: "x" }));
  });
});

describe("showSuccess / showError / showBatchSuccess / showItemAdded", () => {
  it("showSuccess displays message", () => {
    showSuccess("Done!");
    expect(getEl(`${WIDGET_ID}-success`)!.textContent).toBe("Done!");
    expect(getEl(`${WIDGET_ID}-success`)!.style.display).toBe("block");
  });

  it("showError displays error message", () => {
    showError("Something failed");
    expect(getEl(`${WIDGET_ID}-error`)!.textContent).toContain("Something failed");
    expect(getEl(`${WIDGET_ID}-error`)!.style.display).toBe("block");
  });

  it("showBatchSuccess includes count", () => {
    showBatchSuccess(3);
    expect(getEl(`${WIDGET_ID}-success`)!.textContent).toContain("3 items sent to Claude!");
  });

  it("showBatchSuccess uses singular for 1 item", () => {
    showBatchSuccess(1);
    expect(getEl(`${WIDGET_ID}-success`)!.textContent).toBe("1 item sent to Claude!");
  });

  it("showItemAdded shows 'Item added'", () => {
    showItemAdded();
    expect(getEl(`${WIDGET_ID}-success`)!.textContent).toBe("Item added");
  });
});

describe("downloadFile", () => {
  it("creates and clicks an anchor element", () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;

    downloadFile("# Report", "report.md", "text/markdown");

    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});

describe("addItem", () => {
  it("returns early when no element is selected", async () => {
    setSelectedElement(null);
    await addItem();
    expect(localPendingItems.length).toBe(0);
  });

  it("saves feedback locally when offline", async () => {
    const el = document.createElement("button");
    el.textContent = "Test";
    document.body.appendChild(el);
    setSelectedElement(el);
    setIsConnected(false);
    setWs(null);

    (getEl(`${WIDGET_ID}-description`) as HTMLTextAreaElement).value = "misaligned";
    (getEl(`${WIDGET_ID}-include-screenshot`) as HTMLInputElement).checked = false;
    (getEl(`${WIDGET_ID}-include-logs`) as HTMLInputElement).checked = false;
    (getEl(`${WIDGET_ID}-include-styles`) as HTMLInputElement).checked = false;

    await addItem();

    expect(localPendingItems.length).toBe(1);
    expect(localPendingItems[0].description).toBe("misaligned");
    expect(localPendingItems[0].element.tagName).toBe("button");
    expect(localPendingItems[0].consoleLogs).toEqual([]);
    expect(localPendingItems[0].element.computedStyles).toBeUndefined();
    el.remove();
  });

  it("sends feedback via WebSocket when online", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    setSelectedElement(el);

    const send = vi.fn();
    const mockWs = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    setWs(mockWs);
    setIsConnected(true);

    (getEl(`${WIDGET_ID}-include-screenshot`) as HTMLInputElement).checked = false;

    await addItem();

    expect(send).toHaveBeenCalled();
    const sent = JSON.parse(send.mock.calls[0][0] as string);
    expect(sent.type).toBe("feedback");
    expect(sent.payload.element.tagName).toBe("div");
    el.remove();
  });
});

describe("bindEvents", () => {
  it("wires up button click to start annotation mode", () => {
    bindEvents();

    const button = getEl(`${WIDGET_ID}-button`)!;
    button.click();

    expect(isAnnotationMode()).toBe(true);
  });

  it("wires up cancel button to hide panel", () => {
    bindEvents();
    const panel = getEl(`${WIDGET_ID}-panel`)!;
    panel.classList.add("active");
    setSelectedElement(document.createElement("div"));

    getEl(`${WIDGET_ID}-cancel-btn`)!.click();

    expect(panel.classList.contains("active")).toBe(false);
  });

  it("wires up Escape key to close panel", () => {
    bindEvents();
    const panel = getEl(`${WIDGET_ID}-panel`)!;
    panel.classList.add("active");
    setSelectedElement(document.createElement("div"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(panel.classList.contains("active")).toBe(false);
  });

  it("wires up Escape key to stop annotation mode", () => {
    bindEvents();
    startAnnotationMode();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(isAnnotationMode()).toBe(false);
  });

  it("wires up Escape key to close queue panel", () => {
    bindEvents();
    setIsPendingQueueOpen(true);
    getEl(`${WIDGET_ID}-queue-panel`)!.classList.add("active");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(isPendingQueueOpen()).toBe(false);
  });
});
