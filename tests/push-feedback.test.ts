import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { FeedbackItem, PushResult } from "../src/server.ts";
import { createPushFeedback, MCP_INSTRUCTIONS } from "../src/server.ts";

// Mock saveScreenshot at the module boundary
vi.mock("../src/screenshots.ts", () => ({
  saveScreenshot: vi.fn(),
  cleanupScreenshots: vi.fn(),
  sweepOrphanScreenshots: vi.fn(),
  getScreenshotDir: vi.fn().mockReturnValue("/tmp/test-screenshots"),
}));

import * as screenshots from "../src/screenshots.ts";

function makeItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "item-1",
    screenshot: null,
    description: "test description",
    consoleLogs: [],
    element: { selector: "div.foo", tagName: "div", id: null, className: null, fullSelector: "body > div.foo", text: null, innerHTML: null, outerHTML: null, attributes: {}, boundingRect: { top: 0, left: 0, width: 100, height: 50 } },
    url: "http://localhost:3000",
    timestamp: "2026-01-01T00:00:00.000Z",
    viewport: { width: 1024, height: 768, devicePixelRatio: 1 },
    userAgent: "test",
    ...overrides,
  };
}

describe("Server constructor capabilities", () => {
  it("Server constructor accepts channel capability without throwing", () => {
    expect(() =>
      new Server(
        { name: "browser-feedback-mcp", version: "0.1.0" },
        {
          capabilities: {
            experimental: { "claude/channel": {} },
            tools: {},
          },
          instructions: MCP_INSTRUCTIONS,
        },
      ),
    ).not.toThrow();
  });

  it("instructions string identifies user-supplied text as untrusted", () => {
    expect(MCP_INSTRUCTIONS).toContain("untrusted user input");
    expect(MCP_INSTRUCTIONS).toContain("description");
    expect(MCP_INSTRUCTIONS).toContain("consoleLogs");
  });

  it("instructions string documents the channel payload structure", () => {
    expect(MCP_INSTRUCTIONS).toContain("<channel>");
    expect(MCP_INSTRUCTIONS).toContain("image_path");
    expect(MCP_INSTRUCTIONS).toContain("session_id");
    expect(MCP_INSTRUCTIONS).toContain("item_count");
  });
});

describe("createPushFeedback", () => {
  let mockNotification: ReturnType<typeof vi.fn>;
  let mockMcpServer: { notification: ReturnType<typeof vi.fn> };
  const SESSION_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  beforeEach(() => {
    mockNotification = vi.fn().mockResolvedValue(undefined);
    mockMcpServer = { notification: mockNotification };
    vi.mocked(screenshots.saveScreenshot).mockReset();
    vi.mocked(screenshots.saveScreenshot).mockReturnValue("/tmp/test-screenshots/session/item-1.png");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls saveScreenshot for items with screenshots", async () => {
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });
    const item = makeItem({ id: "item-1", screenshot: "data:image/png;base64,abc123" });

    await pushFeedback([item]);

    expect(screenshots.saveScreenshot).toHaveBeenCalledWith("item-1", "data:image/png;base64,abc123", SESSION_ID);
  });

  it("does not call saveScreenshot for items without screenshots", async () => {
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });
    const item = makeItem({ screenshot: null });

    await pushFeedback([item]);

    expect(screenshots.saveScreenshot).not.toHaveBeenCalled();
  });

  it("constructs notification content with user-supplied data", async () => {
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });
    const item = makeItem({
      id: "item-1",
      description: "button looks wrong",
      consoleLogs: [{ type: "error", timestamp: "2026-01-01T00:00:00.000Z", message: "JS error" }],
    });

    await pushFeedback([item]);

    expect(mockNotification).toHaveBeenCalledOnce();
    const call = mockNotification.mock.calls[0][0];
    const payload = JSON.parse(call.params.content);
    expect(payload).toHaveLength(1);
    expect(payload[0].description).toBe("button looks wrong");
    expect(payload[0].consoleLogs).toEqual([{ type: "error", timestamp: "2026-01-01T00:00:00.000Z", message: "JS error" }]);
  });

  it("constructs notification content with system-derived data", async () => {
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });
    const item = makeItem({
      id: "item-1",
      element: { selector: "button.submit", tagName: "button", id: "btn", className: "submit", fullSelector: "body > button.submit", text: null, innerHTML: null, outerHTML: null, attributes: {}, boundingRect: { top: 0, left: 0, width: 80, height: 30 } },
      url: "http://localhost:3000/page",
      timestamp: "2026-05-28T12:00:00.000Z",
    });

    await pushFeedback([item]);

    const call = mockNotification.mock.calls[0][0];
    const payload = JSON.parse(call.params.content);
    expect(payload[0].element_selector).toBe("button.submit");
    expect(payload[0].url).toBe("http://localhost:3000/page");
    expect(payload[0].timestamp).toBe("2026-05-28T12:00:00.000Z");
  });

  it("includes image_path in content when screenshot is saved successfully", async () => {
    vi.mocked(screenshots.saveScreenshot).mockReturnValue("/tmp/screenshots/session/item-1.png");
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });
    const item = makeItem({ id: "item-1", screenshot: "data:image/png;base64,validdata" });

    await pushFeedback([item]);

    const call = mockNotification.mock.calls[0][0];
    const payload = JSON.parse(call.params.content);
    expect(payload[0].image_path).toBe("/tmp/screenshots/session/item-1.png");
  });

  it("omits image_path in content when screenshot save fails", async () => {
    vi.mocked(screenshots.saveScreenshot).mockReturnValue(null);
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });
    const item = makeItem({ id: "item-1", screenshot: "data:image/png;base64,baddata" });

    await pushFeedback([item]);

    const call = mockNotification.mock.calls[0][0];
    const payload = JSON.parse(call.params.content);
    expect(payload[0].image_path).toBeUndefined();
  });

  it("puts only session_id and item_count in meta", async () => {
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });
    const items = [makeItem({ id: "item-1" }), makeItem({ id: "item-2" })];

    await pushFeedback(items);

    const call = mockNotification.mock.calls[0][0];
    expect(call.params.meta).toEqual({
      session_id: SESSION_ID,
      item_count: "2",
    });
    // Ensure no user-supplied data is in meta
    expect(Object.keys(call.params.meta)).toEqual(["session_id", "item_count"]);
  });

  it("returns { ok: true } on successful notification", async () => {
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });
    const result = await pushFeedback([makeItem()]);

    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false } when notification rejects after all retries", async () => {
    mockNotification.mockRejectedValue(new Error("transport closed"));
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });

    const result = await pushFeedback([makeItem()]);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("transport closed");
    // Should have tried 3 times
    expect(mockNotification).toHaveBeenCalledTimes(3);
  }, 10000);

  it("retries on failure before giving up", async () => {
    // First attempt fails, second succeeds
    mockNotification
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValue(undefined);
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });

    const result = await pushFeedback([makeItem()]);

    expect(result).toEqual({ ok: true });
    expect(mockNotification).toHaveBeenCalledTimes(2);
  }, 10000);

  it("times out after 5 seconds and returns { ok: false }", async () => {
    // notification never resolves
    mockNotification.mockImplementation(() => new Promise(() => {}));
    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });

    const start = Date.now();
    const result = await pushFeedback([makeItem()]);
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    // Should have timed out (with retries, max ~15s, but first timeout is 5s)
    expect(elapsed).toBeGreaterThanOrEqual(4500);
  }, 30000);

  it("per-session serialization: two concurrent calls execute sequentially", async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;

    mockNotification.mockImplementationOnce(() => {
      return new Promise<void>((resolve) => {
        resolveFirst = () => {
          order.push("first-done");
          resolve();
        };
      });
    }).mockImplementationOnce(() => {
      order.push("second-started");
      return Promise.resolve();
    });

    const { pushFeedback } = createPushFeedback({ mcpServer: mockMcpServer as unknown as Server, sessionId: SESSION_ID });

    const first = pushFeedback([makeItem({ id: "item-1" })]);
    order.push("first-queued");

    const second = pushFeedback([makeItem({ id: "item-2" })]);
    order.push("second-queued");

    // Let the event loop run — second should NOT start yet (waiting for first)
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(["first-queued", "second-queued"]);
    expect(mockNotification).toHaveBeenCalledTimes(1); // only first started

    // Now resolve the first
    resolveFirst();
    await first;
    await second;

    expect(order).toEqual(["first-queued", "second-queued", "first-done", "second-started"]);
    expect(mockNotification).toHaveBeenCalledTimes(2);
  });
});
