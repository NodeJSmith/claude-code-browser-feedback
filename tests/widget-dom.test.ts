// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createWidget, getStyles } from "../src/widget/widget-dom.ts";
import { WIDGET_ID, shadowRoot, setShadowRoot } from "../src/widget/widget-state.ts";

beforeEach(() => {
  setShadowRoot(null);
  const existing = document.getElementById(WIDGET_ID);
  if (existing) existing.remove();
});

describe("getStyles", () => {
  it("returns a non-empty CSS string", () => {
    const css = getStyles();
    expect(css.length).toBeGreaterThan(100);
  });

  it("contains :host rule", () => {
    expect(getStyles()).toContain(":host");
  });

  it("references widget ID in selectors", () => {
    expect(getStyles()).toContain(`#${WIDGET_ID}-button`);
    expect(getStyles()).toContain(`#${WIDGET_ID}-panel`);
  });
});

describe("createWidget", () => {
  it("creates a host element with the widget ID", () => {
    const onReady = vi.fn();
    createWidget(onReady);

    const host = document.getElementById(WIDGET_ID);
    expect(host).not.toBeNull();
  });

  it("attaches a shadow root", () => {
    createWidget(vi.fn());
    expect(shadowRoot).not.toBeNull();
  });

  it("calls onReady callback", () => {
    const onReady = vi.fn();
    createWidget(onReady);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("injects styles into shadow root", () => {
    createWidget(vi.fn());
    const style = shadowRoot!.querySelector("style");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain(":host");
  });

  it("creates all key UI elements", () => {
    createWidget(vi.fn());

    const expected = [
      "button",
      "button-group",
      "overlay",
      "highlight",
      "tooltip",
      "instructions",
      "panel",
      "description",
      "cancel-btn",
      "send-btn",
      "queue-panel",
      "queue-list",
      "pending-count",
      "success",
      "error",
    ];

    for (const suffix of expected) {
      const el = shadowRoot!.getElementById(`${WIDGET_ID}-${suffix}`);
      expect(el, `missing element: ${WIDGET_ID}-${suffix}`).not.toBeNull();
    }
  });

  it("creates description as a textarea", () => {
    createWidget(vi.fn());
    const desc = shadowRoot!.getElementById(`${WIDGET_ID}-description`);
    expect(desc!.tagName.toLowerCase()).toBe("textarea");
  });

  it("starts with button in disconnected state", () => {
    createWidget(vi.fn());
    const button = shadowRoot!.getElementById(`${WIDGET_ID}-button`);
    expect(button!.classList.contains("disconnected")).toBe(true);
  });

  it("removes existing widget before creating new one", () => {
    createWidget(vi.fn());
    createWidget(vi.fn());

    const hosts = document.querySelectorAll(`#${WIDGET_ID}`);
    expect(hosts.length).toBe(1);
  });

  it("includes checkbox options for screenshot, logs, styles", () => {
    createWidget(vi.fn());
    expect(shadowRoot!.getElementById(`${WIDGET_ID}-include-screenshot`)).not.toBeNull();
    expect(shadowRoot!.getElementById(`${WIDGET_ID}-include-logs`)).not.toBeNull();
    expect(shadowRoot!.getElementById(`${WIDGET_ID}-include-styles`)).not.toBeNull();
  });
});
