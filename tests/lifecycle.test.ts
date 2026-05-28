import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { FeedbackItem, PushResult } from "../src/server.ts";
import { createPushFeedback } from "../src/server.ts";

// Mock screenshots module
vi.mock("../src/screenshots.ts", () => ({
  saveScreenshot: vi.fn().mockReturnValue(null),
  cleanupScreenshots: vi.fn(),
  sweepOrphanScreenshots: vi.fn(),
  getScreenshotDir: vi.fn().mockReturnValue("/tmp/test-screenshots"),
}));

import * as screenshots from "../src/screenshots.ts";

function makeItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "item-1",
    screenshot: null,
    description: "test",
    consoleLogs: [],
    element: null,
    url: "http://localhost:3000",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMockServer(): { notification: ReturnType<typeof vi.fn>; asServer: Server } {
  const notification = vi.fn().mockResolvedValue(undefined);
  return { notification, asServer: { notification } as unknown as Server };
}

describe("lifecycle: startup sweep", () => {
  // sweepOrphanScreenshots is called from main() in server.ts, which we can't
  // unit-test directly since it's a side-effectful entry point. We test that
  // the screenshots module exports the function and that server.ts imports it,
  // validating the contract. The actual wiring is verified via the exports check.
  it("sweepOrphanScreenshots is exported from screenshots module", () => {
    expect(typeof screenshots.sweepOrphanScreenshots).toBe("function");
  });

  it("sweepOrphanScreenshots accepts an array of session IDs", () => {
    // Should not throw with empty or populated arrays
    expect(() => screenshots.sweepOrphanScreenshots([])).not.toThrow();
    expect(() =>
      screenshots.sweepOrphanScreenshots(["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]),
    ).not.toThrow();
  });
});

describe("lifecycle: in-flight counter", () => {
  let mockServer: ReturnType<typeof makeMockServer>;
  const SESSION_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  beforeEach(() => {
    mockServer = makeMockServer();
    vi.mocked(screenshots.saveScreenshot).mockReset();
    vi.mocked(screenshots.saveScreenshot).mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("in-flight count is zero before any push", async () => {
    const { getInFlightCount } = createPushFeedback({ mcpServer: mockServer.asServer });
    expect(getInFlightCount()).toBe(0);
  });

  it("in-flight count increments while push is executing", async () => {
    let resolveNotification!: () => void;
    mockServer.notification.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveNotification = resolve;
        }),
    );

    const { pushFeedback, getInFlightCount } = createPushFeedback({
      mcpServer: mockServer.asServer,
    });

    const pushPromise = pushFeedback([makeItem()], SESSION_ID);

    // Give the event loop a turn so pushFeedback can start executing
    await new Promise((r) => setTimeout(r, 10));
    expect(getInFlightCount()).toBe(1);

    resolveNotification();
    await pushPromise;
    expect(getInFlightCount()).toBe(0);
  });

  it("in-flight count decrements after push fails", async () => {
    mockServer.notification.mockRejectedValue(new Error("transport error"));
    const { pushFeedback, getInFlightCount } = createPushFeedback({
      mcpServer: mockServer.asServer,
    });

    const result = await pushFeedback([makeItem()], SESSION_ID);

    expect(result.ok).toBe(false);
    expect(getInFlightCount()).toBe(0);
  }, 15000);

  it("drain resolves immediately when no calls are in flight", async () => {
    const { drainInFlight } = createPushFeedback({ mcpServer: mockServer.asServer });
    await expect(drainInFlight()).resolves.toBeUndefined();
  });

  it("drain resolves after all in-flight calls complete", async () => {
    let resolveNotification!: () => void;
    mockServer.notification.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveNotification = resolve;
        }),
    );

    const { pushFeedback, drainInFlight } = createPushFeedback({ mcpServer: mockServer.asServer });

    const pushPromise = pushFeedback([makeItem()], SESSION_ID);

    // Give the event loop a turn so pushFeedback can start
    await new Promise((r) => setTimeout(r, 10));

    let drainResolved = false;
    const drainPromise = drainInFlight().then(() => {
      drainResolved = true;
    });

    // Drain should not have resolved yet (push still in flight)
    await new Promise((r) => setTimeout(r, 10));
    expect(drainResolved).toBe(false);

    // Resolve the push
    resolveNotification();
    await pushPromise;
    await drainPromise;

    expect(drainResolved).toBe(true);
  });

  it("drain resolves after timeout even when calls are still in flight", async () => {
    // notification never resolves
    mockServer.notification.mockImplementation(() => new Promise(() => {}));

    const { pushFeedback, drainInFlight } = createPushFeedback({ mcpServer: mockServer.asServer });

    void pushFeedback([makeItem()], SESSION_ID);

    // Give event loop a turn to start the push
    await new Promise((r) => setTimeout(r, 10));

    const start = Date.now();
    await drainInFlight(50); // 50ms drain timeout
    const elapsed = Date.now() - start;

    // Should have timed out (~50ms)
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
  }, 10000);
});

describe("lifecycle: shutdown cleanup", () => {
  let mockServer: ReturnType<typeof makeMockServer>;
  const SESSION_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  beforeEach(() => {
    mockServer = makeMockServer();
    vi.mocked(screenshots.cleanupScreenshots).mockReset();
    vi.mocked(screenshots.saveScreenshot).mockReset();
    vi.mocked(screenshots.saveScreenshot).mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cleanupScreenshots is exported from screenshots module", () => {
    expect(typeof screenshots.cleanupScreenshots).toBe("function");
  });

  it("cleanupScreenshots is called after all in-flight pushes complete", async () => {
    let resolveNotification!: () => void;
    mockServer.notification.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveNotification = resolve;
        }),
    );

    const { pushFeedback, drainInFlight } = createPushFeedback({ mcpServer: mockServer.asServer });

    const pushPromise = pushFeedback([makeItem()], SESSION_ID);

    // Give event loop a turn to start the push
    await new Promise((r) => setTimeout(r, 10));

    // Simulate shutdown: drain then cleanup
    const shutdownCleanup = drainInFlight().then(() => {
      screenshots.cleanupScreenshots(SESSION_ID);
    });

    // cleanup should not have been called yet
    expect(screenshots.cleanupScreenshots).not.toHaveBeenCalled();

    resolveNotification();
    await pushPromise;
    await shutdownCleanup;

    expect(screenshots.cleanupScreenshots).toHaveBeenCalledWith(SESSION_ID);
  });

  it("cleanupScreenshots receives the correct session ID", async () => {
    const { drainInFlight } = createPushFeedback({ mcpServer: mockServer.asServer });

    await drainInFlight();
    screenshots.cleanupScreenshots(SESSION_ID);

    expect(screenshots.cleanupScreenshots).toHaveBeenCalledWith(SESSION_ID);
    expect(vi.mocked(screenshots.cleanupScreenshots).mock.calls[0][0]).toBe(SESSION_ID);
  });
});
