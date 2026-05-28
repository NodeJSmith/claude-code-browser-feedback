import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import * as screenshots from "../src/screenshots.ts";
import { deriveSessionId } from "../src/utils.ts";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "screenshots-test-"));
}

let seed = 0;
function makeSessionId(): string {
  return deriveSessionId(`/tmp/screenshots-test-${++seed}-${Date.now()}-${Math.random()}`);
}

function makeBase64Png(sizeBytes = 100): string {
  // Create a buffer with some bytes and encode it
  const buf = Buffer.alloc(sizeBytes, 0x89);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function makeBase64Jpeg(sizeBytes = 100): string {
  const buf = Buffer.alloc(sizeBytes, 0xff);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

describe("screenshots", () => {
  let tempDir: string;
  let sessionId: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
    sessionId = makeSessionId();
    originalEnv = process.env.FEEDBACK_SCREENSHOT_DIR;
    process.env.FEEDBACK_SCREENSHOT_DIR = tempDir;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.FEEDBACK_SCREENSHOT_DIR = originalEnv;
    } else {
      delete process.env.FEEDBACK_SCREENSHOT_DIR;
    }
    // Clean up temp dir
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe("getScreenshotDir", () => {
    it("respects FEEDBACK_SCREENSHOT_DIR env var", () => {
      expect(screenshots.getScreenshotDir()).toBe(tempDir);
    });

    it("falls back to default temp path when env var not set", () => {
      delete process.env.FEEDBACK_SCREENSHOT_DIR;
      const dir = screenshots.getScreenshotDir();
      expect(dir).toBe(path.join(os.tmpdir(), "claude-browser-feedback", "screenshots"));
    });
  });

  describe("saveScreenshot", () => {
    it("writes a PNG file at the expected path and returns the absolute path", () => {
      const dataUri = makeBase64Png(200);
      const result = screenshots.saveScreenshot("item-1", dataUri, sessionId);

      expect(result).not.toBeNull();
      expect(result).toBe(path.join(tempDir, sessionId, "item-1.png"));
      expect(fs.existsSync(result!)).toBe(true);
    });

    it("also works with JPEG data URIs", () => {
      const dataUri = makeBase64Jpeg(200);
      const result = screenshots.saveScreenshot("item-jpeg", dataUri, sessionId);

      expect(result).not.toBeNull();
      expect(result).toBe(path.join(tempDir, sessionId, "item-jpeg.jpg"));
      expect(fs.existsSync(result!)).toBe(true);
    });

    it("writes the decoded binary data correctly", () => {
      const rawBytes = Buffer.alloc(50, 0xab);
      const dataUri = `data:image/png;base64,${rawBytes.toString("base64")}`;
      const result = screenshots.saveScreenshot("item-verify", dataUri, sessionId);

      expect(result).not.toBeNull();
      const written = fs.readFileSync(result!);
      expect(written.equals(rawBytes)).toBe(true);
    });

    it("creates the session subdirectory if it doesn't exist", () => {
      const dataUri = makeBase64Png(100);
      const sessionDir = path.join(tempDir, sessionId);

      expect(fs.existsSync(sessionDir)).toBe(false);

      const result = screenshots.saveScreenshot("item-1", dataUri, sessionId);

      expect(result).not.toBeNull();
      expect(fs.existsSync(sessionDir)).toBe(true);
    });

    it("returns null for empty base64 data", () => {
      const result = screenshots.saveScreenshot("bad", "data:image/png;base64,", sessionId);
      expect(result).toBeNull();
    });

    it("returns null for invalid data URI format", () => {
      const result = screenshots.saveScreenshot("bad", "not-a-data-uri", sessionId);
      expect(result).toBeNull();
    });

    it("returns null when decoded data exceeds 10MB", () => {
      const bigBuf = Buffer.alloc(11 * 1024 * 1024, 0x00);
      const dataUri = `data:image/png;base64,${bigBuf.toString("base64")}`;
      const result = screenshots.saveScreenshot("toobig", dataUri, sessionId);
      expect(result).toBeNull();
    });

    it("returns null for missing data URI prefix", () => {
      const result = screenshots.saveScreenshot("noprefix", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", sessionId);
      expect(result).toBeNull();
    });

    it("returns null for a sessionId with path traversal characters", () => {
      const result = screenshots.saveScreenshot("item-1", makeBase64Png(), "../../evil");
      expect(result).toBeNull();
    });

    it("returns null for an id with path traversal characters", () => {
      const result = screenshots.saveScreenshot("../../evil", makeBase64Png(), sessionId);
      expect(result).toBeNull();
    });

    it("returns null for a non-UUID sessionId", () => {
      const result = screenshots.saveScreenshot("item-1", makeBase64Png(), "not-a-valid-session");
      expect(result).toBeNull();
    });
  });

  describe("cleanupScreenshots", () => {
    it("removes the session directory", () => {
      const dataUri = makeBase64Png(100);
      screenshots.saveScreenshot("item-1", dataUri, sessionId);

      const sessionDir = path.join(tempDir, sessionId);
      expect(fs.existsSync(sessionDir)).toBe(true);

      screenshots.cleanupScreenshots(sessionId);

      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it("does not throw for a non-existent directory", () => {
      const unusedSession = makeSessionId();
      expect(() => {
        screenshots.cleanupScreenshots(unusedSession);
      }).not.toThrow();
    });
  });

  describe("sweepOrphanScreenshots", () => {
    it("removes directories not in activeSessions", () => {
      const dataUri = makeBase64Png(100);
      screenshots.saveScreenshot("item-1", dataUri, sessionId);

      const sessionDir = path.join(tempDir, sessionId);
      expect(fs.existsSync(sessionDir)).toBe(true);

      screenshots.sweepOrphanScreenshots([]);

      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it("preserves directories that are in activeSessions", () => {
      const dataUri = makeBase64Png(100);
      screenshots.saveScreenshot("item-1", dataUri, sessionId);

      const sessionDir = path.join(tempDir, sessionId);
      expect(fs.existsSync(sessionDir)).toBe(true);

      screenshots.sweepOrphanScreenshots([sessionId]);

      expect(fs.existsSync(sessionDir)).toBe(true);
    });

    it("removes stale directories older than 7 days", () => {
      // Create a directory and set mtime to 8 days ago
      const oldSessionId = "b1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const oldDir = path.join(tempDir, oldSessionId);
      fs.mkdirSync(oldDir, { recursive: true });
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldDir, eightDaysAgo, eightDaysAgo);

      screenshots.sweepOrphanScreenshots([oldSessionId]); // even in activeSessions

      expect(fs.existsSync(oldDir)).toBe(false);
    });

    it("does not throw when screenshot directory doesn't exist", () => {
      // Use a non-existent directory
      process.env.FEEDBACK_SCREENSHOT_DIR = path.join(tempDir, "nonexistent");
      expect(() => {
        screenshots.sweepOrphanScreenshots([]);
      }).not.toThrow();
    });
  });
});
