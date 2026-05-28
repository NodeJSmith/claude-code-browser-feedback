---
task_id: "T06"
title: "Add shutdown drain, startup sweep, and update documentation"
status: "planned"
depends_on: ["T01", "T02"]
implements: ["FR#9", "AC#6"]
---

## Summary
Wire the screenshot lifecycle into the server's startup and shutdown paths: sweep orphan screenshot directories on startup, drain in-flight pushFeedback calls before cleanup on shutdown. Update CLAUDE.md and README.md to reflect the new channel-based architecture, the `FEEDBACK_SCREENSHOT_DIR` env var, and the security guidance.

## Prompt
### server.ts — shutdown drain

1. **Track in-flight pushFeedback calls** — add a counter (e.g., `let inFlightCount = 0`) incremented before each `pushFeedback` call and decremented in a `finally` block. Expose a `drainInFlight(): Promise<void>` helper that resolves when the counter hits zero (or after the existing 2-second shutdown timeout).

2. **Update `shutdown()` function** — before `storage.flushAll()` and `wss.close()`, await `drainInFlight()`. Then call `cleanupScreenshots(SESSION_ID)` from `src/screenshots.ts`. This ensures screenshots aren't deleted while a notification referencing them is still in flight.

### server.ts — startup sweep

3. **Call `sweepOrphanScreenshots`** during startup — after the storage rehydration loop (around line 163), call `sweepOrphanScreenshots(Array.from(sessionRegistry.keys()))`. This cleans up screenshot directories from crashed prior sessions.

### CLAUDE.md updates

4. Update the **Active Rewrite** section: change epic #2 description to note it's in progress or done.

5. Update the **Architecture** section:
   - `src/server.ts` — add: "Defines `pushFeedback` callback for channel notification delivery. Handles shutdown drain and startup screenshot sweep."
   - `src/ws-server.ts` — update: "WebSocket server creation, connection/message/close handling, broadcast function. The `send_to_claude` handler calls `pushFeedback` to deliver feedback via channel notification."
   - `src/mcp-tools.ts` — update: "MCP tool schemas (ListTools) and tool handler implementations (CallTool). On-demand tools only — polling tools removed."
   - `src/screenshots.ts` — add new entry: "Screenshot file I/O: decode from base64, atomic write to disk, session cleanup, orphan sweep."
   - Remove references to `wait_for_browser_feedback`, `get_pending_feedback`, and other deleted tools from module descriptions.

6. Update the **Configuration** section: add `FEEDBACK_SCREENSHOT_DIR` (default: `os.tmpdir()/claude-browser-feedback/screenshots/`) — directory where screenshots are saved.

### README.md updates

7. Add a note about the `--dangerously-load-development-channels` flag requirement during the research preview period.

8. Update the tool list to show only the 7 on-demand tools. Remove the 5 deleted pull tools.

9. Add a **Security** section: the widget is designed for developer-controlled pages only. The dev-only hostname guard in `install_widget` is a security control against prompt injection, not just a convenience. User-supplied text in feedback is structurally separated from system metadata and marked as untrusted in the server's instructions to Claude.

### Tests

Add to `tests/push-feedback.test.ts` (or a new `tests/lifecycle.test.ts`):
- Startup calls `sweepOrphanScreenshots` with the current session registry keys
- Shutdown calls `cleanupScreenshots` for the current session after draining in-flight calls
- In-flight counter: increment before push, decrement after, drain resolves when zero

## Focus
- The shutdown function (`src/server.ts:51-96`) already has a 2-second `setTimeout(() => process.exit(0))` as a hard cutoff. The drain should use `Promise.race` with this same timeout — don't add a separate timer.
- `sweepOrphanScreenshots` should run AFTER storage rehydration (so `sessionRegistry` is populated) but BEFORE the server starts accepting new connections.
- The in-flight counter must be incremented in `pushFeedback` itself (in server.ts), not in the WS handler — this way it covers both the WS path and the HTTP proxy relay path.
- CLAUDE.md is checked into the repo and serves as onboarding documentation. Keep the updates factual and concise.

## Verify
- [ ] FR#9: Screenshot files are cleaned up on shutdown, after draining in-flight notifications
- [ ] AC#6: After server shutdown, the session's screenshot directory is removed
