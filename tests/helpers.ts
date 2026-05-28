import type { FeedbackItem } from "../src/widget/widget-state.ts";

export function makeFeedbackItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "fb-1",
    timestamp: new Date().toISOString(),
    url: "http://localhost:3000",
    viewport: { width: 1024, height: 768, devicePixelRatio: 1 },
    userAgent: "test",
    element: {
      tagName: "div",
      id: null,
      className: null,
      selector: "div",
      fullSelector: "body > div",
      text: null,
      innerHTML: null,
      outerHTML: null,
      attributes: {},
      boundingRect: { top: 0, left: 0, width: 100, height: 50 },
    },
    description: "test feedback",
    screenshot: null,
    consoleLogs: [],
    ...overrides,
  };
}
