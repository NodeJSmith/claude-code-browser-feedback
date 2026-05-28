---
task_id: "T01"
title: "Add screenshots module for disk-based screenshot storage"
status: "planned"
depends_on: []
implements: ["FR#4", "FR#5", "AC#3"]
---

## Summary
Create the new `src/screenshots.ts` module that handles saving browser feedback screenshots to disk, cleaning up session directories, and sweeping orphan directories on startup. This is the foundational file I/O layer that the push notification path depends on. Screenshots are decoded from base64 data URIs, written as PNG files using atomic temp-file-then-rename, and organized by session ID.

## Prompt
Create `src/screenshots.ts` with these exports:

1. `getScreenshotDir(): string` — returns `process.env.FEEDBACK_SCREENSHOT_DIR || path.join(os.tmpdir(), "claude-browser-feedback", "screenshots")`.

2. `saveScreenshot(id: string, dataUri: string, sessionId: string): Promise<string | null>` — decode the base64 data URI (`data:image/...;base64,...`), write the decoded buffer to `<screenshotDir>/<sessionId>/<id>.png` using atomic temp-file-then-rename (see `src/storage.ts:64-79` for the pattern). Set file permissions to `0o600`. Return the absolute path on success. Return `null` and log a warning if: the decoded data exceeds 10MB, the base64 is malformed, or the write fails. Create the session subdirectory (`<screenshotDir>/<sessionId>/`) on first write using `fs.mkdirSync({ recursive: true, mode: 0o700 })`.

3. `cleanupScreenshots(sessionId: string): void` — remove the entire `<screenshotDir>/<sessionId>/` directory. Use `fs.rmSync({ recursive: true, force: true })`. Silently ignore errors (directory may already be gone).

4. `sweepOrphanScreenshots(activeSessions: string[]): void` — enumerate subdirectories under `getScreenshotDir()`. Remove any directory whose name is not in `activeSessions` or whose mtime is older than 7 days. Log each removal. Silently ignore errors on individual directories.

Follow the conventions in `src/storage.ts` for file operations: sync I/O with try/catch, `[browser-feedback-mcp]` log prefix, session ID as the scoping parameter.

Write unit tests in `tests/screenshots.test.ts`:
- `saveScreenshot` writes a PNG file at the expected path and returns the absolute path
- `saveScreenshot` returns null for invalid base64 data
- `saveScreenshot` returns null when decoded data exceeds 10MB
- `saveScreenshot` creates the session subdirectory if it doesn't exist
- `cleanupScreenshots` removes the session directory
- `cleanupScreenshots` does not throw for a non-existent directory
- `sweepOrphanScreenshots` removes directories not in activeSessions
- `sweepOrphanScreenshots` preserves directories that are in activeSessions
- `getScreenshotDir` respects `FEEDBACK_SCREENSHOT_DIR` env var
- `getScreenshotDir` falls back to the default temp path

Use a unique temp directory per test (via `fs.mkdtempSync`) and clean up in `afterEach`.

## Focus
- Follow the atomic write pattern from `src/storage.ts:64-79`: write to `<target>.${process.pid}.tmp`, then `fs.renameSync` to the final path. This prevents partial writes from being read.
- The 10MB limit is on the decoded binary data, not the base64 string. A 10MB image is ~13.3MB as base64.
- Data URIs from the widget look like `data:image/png;base64,iVBOR...` — strip the prefix before decoding. Also handle `data:image/jpeg;base64,...` since the widget uses JPEG at quality 0.7 (`src/widget/widget-screenshot.ts`).
- The `os.tmpdir()` path persists across reboots on macOS but not always on Linux. The sweep function exists to handle this.
- `isValidSessionId` from `src/utils.ts` can be used to validate directory names during sweep.

## Verify
- [ ] FR#4: `saveScreenshot` writes a PNG file to disk and returns the absolute path
- [ ] FR#5: `getScreenshotDir` returns env var value when set, default temp path when not
- [ ] AC#3: Screenshot files appear in the configured directory with correct content
