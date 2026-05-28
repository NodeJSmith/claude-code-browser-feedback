// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { formatRelativeTime, generateMarkdown } from "../src/widget/widget-annotation.ts";
import { makeFeedbackItem } from "./helpers.ts";

describe("formatRelativeTime", () => {
  it("returns 'just now' for timestamps less than 60 seconds ago", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("returns minutes ago for recent timestamps", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago for timestamps within 24 hours", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns date string for timestamps older than 24 hours", () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(twoDaysAgo);
    expect(result).not.toContain("ago");
    expect(result).not.toBe("just now");
  });
});

describe("generateMarkdown", () => {
  it("includes report header with URL and item count", () => {
    const items = [makeFeedbackItem({ url: "http://localhost:3000/page" })];
    const md = generateMarkdown(items);

    expect(md).toContain("# Browser Feedback Report");
    expect(md).toContain("**URL:** http://localhost:3000/page");
    expect(md).toContain("**Items:** 1");
  });

  it("includes element selector and full path", () => {
    const items = [
      makeFeedbackItem({
        element: {
          ...makeFeedbackItem().element,
          selector: "#submit",
          fullSelector: "body > form > #submit",
        },
      }),
    ];
    const md = generateMarkdown(items);

    expect(md).toContain("**Element:** `#submit`");
    expect(md).toContain("**Full path:** `body > form > #submit`");
  });

  it("includes description when present", () => {
    const items = [makeFeedbackItem({ description: "Alignment issue" })];
    const md = generateMarkdown(items);

    expect(md).toContain("**Description:** Alignment issue");
  });

  it("omits description section when empty", () => {
    const items = [makeFeedbackItem({ description: "" })];
    const md = generateMarkdown(items);

    expect(md).not.toContain("**Description:**");
  });

  it("includes HTML block from outerHTML", () => {
    const items = [
      makeFeedbackItem({
        element: {
          ...makeFeedbackItem().element,
          outerHTML: '<button id="submit" class="btn primary">Click me</button>',
        },
      }),
    ];
    const md = generateMarkdown(items);

    expect(md).toContain("**HTML:**");
    expect(md).toContain("```html");
    expect(md).toContain('<button id="submit"');
  });

  it("includes computed styles when present", () => {
    const items = [
      makeFeedbackItem({
        element: {
          ...makeFeedbackItem().element,
          computedStyles: {
            display: "block",
            position: "relative",
            color: "rgb(0, 0, 0)",
            backgroundColor: "transparent",
            fontSize: "14px",
            fontWeight: "400",
            padding: "8px",
            margin: "0px",
            border: "none",
            opacity: "1",
            visibility: "visible",
            zIndex: "auto",
          },
        },
      }),
    ];
    const md = generateMarkdown(items);

    expect(md).toContain("**Computed Styles:**");
    expect(md).toContain("display: block");
  });

  it("includes console logs when present", () => {
    const items = [
      makeFeedbackItem({
        consoleLogs: [
          { type: "error", timestamp: "t", message: "Uncaught TypeError" },
          { type: "warn", timestamp: "t", message: "Deprecation notice" },
        ],
      }),
    ];
    const md = generateMarkdown(items);

    expect(md).toContain("**Console Logs (2):**");
    expect(md).toContain("[error] Uncaught TypeError");
    expect(md).toContain("[warn] Deprecation notice");
  });

  it("notes screenshot size when present", () => {
    const screenshot = "data:image/jpeg;base64," + "A".repeat(4096);
    const items = [makeFeedbackItem({ screenshot })];
    const md = generateMarkdown(items);

    expect(md).toContain("**Screenshot:** Captured");
    expect(md).toContain("KB base64");
  });

  it("numbers multiple items", () => {
    const items = [makeFeedbackItem({ id: "fb-1" }), makeFeedbackItem({ id: "fb-2" })];
    const md = generateMarkdown(items);

    expect(md).toContain("## Item 1");
    expect(md).toContain("## Item 2");
  });

  it("falls back to item.selector when element.selector missing", () => {
    const item = makeFeedbackItem();
    item.selector = ".fallback-selector";
    (item.element as Record<string, unknown>).selector = undefined;
    const md = generateMarkdown([item]);

    expect(md).toContain("**Element:** `.fallback-selector`");
  });
});
