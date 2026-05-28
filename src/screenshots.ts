import fs from "fs";
import path from "path";
import os from "os";
import { isValidSessionId } from "./utils.ts";

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10MB decoded limit
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const MIME_TO_EXT: Record<string, string> = { png: "png", jpeg: "jpg", webp: "webp", gif: "gif", "svg+xml": "svg" };

export function getScreenshotDir(): string {
  return process.env.FEEDBACK_SCREENSHOT_DIR || path.join(os.tmpdir(), "claude-browser-feedback", "screenshots");
}

export function saveScreenshot(id: string, dataUri: string, sessionId: string): string | null {
  if (!isValidSessionId(sessionId)) {
    console.error(`[browser-feedback-mcp] saveScreenshot: invalid sessionId`);
    return null;
  }
  if (!SAFE_ID_RE.test(id)) {
    console.error(`[browser-feedback-mcp] saveScreenshot: invalid id`);
    return null;
  }

  const match = dataUri.match(/^data:image\/([^;]+);base64,(.+)$/);
  if (!match) {
    console.error(`[browser-feedback-mcp] saveScreenshot: invalid data URI for item ${id}`);
    return null;
  }

  const mimeSubtype = match[1];
  const base64Data = match[2];

  const buf = Buffer.from(base64Data, "base64");
  if (buf.length === 0) {
    console.error(`[browser-feedback-mcp] saveScreenshot: empty base64 data for item ${id}`);
    return null;
  }

  if (buf.length > MAX_SCREENSHOT_BYTES) {
    console.error(
      `[browser-feedback-mcp] saveScreenshot: decoded data exceeds 10MB limit for item ${id} (${buf.length} bytes)`
    );
    return null;
  }

  const ext = MIME_TO_EXT[mimeSubtype] ?? "png";
  const screenshotDir = getScreenshotDir();
  const sessionDir = path.join(screenshotDir, sessionId);
  const target = path.join(sessionDir, `${id}.${ext}`);
  const tmp = `${target}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, target);
    return target;
  } catch (err) {
    console.error(
      `[browser-feedback-mcp] saveScreenshot: write failed for item ${id}: ${(err as Error).message}`
    );
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function cleanupScreenshots(sessionId: string): void {
  if (!isValidSessionId(sessionId)) return;
  const sessionDir = path.join(getScreenshotDir(), sessionId);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function sweepOrphanScreenshots(activeSessions: string[]): void {
  const screenshotDir = getScreenshotDir();
  const activeSet = new Set(activeSessions);
  const now = Date.now();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(screenshotDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(screenshotDir, entry.name);

    let isStale = false;
    try {
      const stat = fs.statSync(dirPath);
      isStale = now - stat.mtimeMs > SEVEN_DAYS_MS;
    } catch {
      /* ignore stat errors */
    }

    const isOrphan = !activeSet.has(entry.name);

    if (isOrphan || isStale) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        const reason = isOrphan ? "orphaned" : "stale (>7d)";
        console.error(`[browser-feedback-mcp] sweepOrphanScreenshots: removed ${dirPath} (${reason})`);
      } catch {
        /* silently ignore individual directory errors */
      }
    }
  }
}
