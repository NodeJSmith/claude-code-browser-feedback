// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

let loadHtml2Canvas: typeof import("../src/widget/widget-screenshot.ts").loadHtml2Canvas;
let captureScreenshot: typeof import("../src/widget/widget-screenshot.ts").captureScreenshot;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).html2canvas;

  const mod = await import("../src/widget/widget-screenshot.ts");
  loadHtml2Canvas = mod.loadHtml2Canvas;
  captureScreenshot = mod.captureScreenshot;
});

describe("loadHtml2Canvas", () => {
  it("resolves immediately when html2canvas is already loaded", async () => {
    (globalThis as Record<string, unknown>).html2canvas = vi.fn();
    await expect(loadHtml2Canvas("ws://localhost:9877")).resolves.toBeUndefined();
  });

  it("builds correct URL from ws base URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("// mock script", { status: 200 }));

    await loadHtml2Canvas("ws://localhost:9877");

    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:9877/html2canvas.min.js");
  });

  it("builds URL from non-default port", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("// mock", { status: 200 }));

    await loadHtml2Canvas("ws://myhost:4000");

    expect(fetchSpy).toHaveBeenCalledWith("http://myhost:4000/html2canvas.min.js");
  });

  it("falls back to localhost:9877 for invalid ws URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("// mock", { status: 200 }));

    await loadHtml2Canvas("not-a-url");

    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:9877/html2canvas.min.js");
  });

  it("throws on HTTP error and resets cache for retry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    await expect(loadHtml2Canvas("ws://localhost:9877")).rejects.toThrow(
      "Failed to load html2canvas",
    );
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    await expect(loadHtml2Canvas("ws://localhost:9877")).rejects.toThrow(
      "Failed to load html2canvas",
    );
  });

  it("deduplicates concurrent calls", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("// mock", { status: 200 }));

    await Promise.all([
      loadHtml2Canvas("ws://localhost:9877"),
      loadHtml2Canvas("ws://localhost:9877"),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("captureScreenshot", () => {
  it("returns null when html2canvas fails to load", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const result = await captureScreenshot(null, "ws://localhost:9877");
    expect(result).toBeNull();
  });

  it("returns null when html2canvas is undefined after load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("// does not define html2canvas", { status: 200 }),
    );

    const result = await captureScreenshot(null, "ws://localhost:9877");
    expect(result).toBeNull();
  });
});
