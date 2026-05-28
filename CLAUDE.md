# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser Feedback MCP is an MCP server that injects a visual annotation widget into the browser. Users click elements, add descriptions, and Claude receives screenshots + element metadata + console logs. Being rewritten from plain JS to TypeScript and converting from pull-based MCP to push-based Claude Code channels.

## Commands

```bash
npm install          # Install dependencies
npm start            # Run the MCP server (node src/server.js)
npm test             # Run tests (vitest)
npm run test:watch   # Run tests in watch mode
```

CI runs on Node 22 (`npm ci && npm test`).

## Architecture

Plain JavaScript (ES modules), no TypeScript or build step yet. Two large files dominate:

- `src/server.js` (~2K lines) — HTTP server + WebSocket server + MCP server (stdio transport). Being split into separate modules per issue #1.
- `src/widget.js` (~2K lines) — Browser-side annotation UI. Uses Shadow DOM for style isolation. Stays JS even after the TS conversion.
- `src/storage.js` — Disk-backed feedback persistence with debounced writes.
- `src/utils.js` — Helpers: `deriveSessionId`, `formatFeedback`, project URL detection.
- `extension/` — Chrome/Firefox MV3 browser extension for toggling the widget.

### Key patterns

- `__WEBSOCKET_BASE_URL__` and `__WIDGET_VERSION__` placeholders in widget.js are replaced at serve-time by the HTTP server.
- Widget internal DOM access uses `getEl()` helper (queries shadow root, not `document`).
- `window.__claudeFeedbackDestroy()` handles clean teardown (used by the browser extension).
- Session isolation: deterministic UUID derived from `process.cwd()`. All storage, WebSocket broadcasts, and MCP responses are partitioned by session ID.
- Multi-process: first process owns the HTTP server port; subsequent processes register via `POST /register-session` and run in proxy mode.

## Active Rewrite (3 epics)

Work these in order — each depends on the previous:

1. **#1 TypeScript conversion + code quality** — Convert server-side to TS (strict mode), add ESLint, bind to `127.0.0.1` (not `0.0.0.0`), split the god files, replace 26+ silent catch blocks, extract magic numbers into constants.

2. **#2 Convert to Claude Code channels** — Add `experimental.claude/channel` capability. Push feedback via `mcp.notification()` instead of polling. Save screenshots to disk, include file path in channel message. Delete pull-based tools (`wait_for_browser_feedback`, `get_pending_feedback`, etc.), keep on-demand tools (`install_widget`, `get_connection_status`, `request_annotation`, etc.). Add sender gating for prompt injection prevention.

3. **#3 Testing backfill** — Widget has zero test coverage. Backfill widget tests, update existing tests for channels architecture, add coverage enforcement (80%+ target).

## Configuration

- `FEEDBACK_PORT` (default: 9877) — HTTP/WebSocket server port.
- `FEEDBACK_HOST` — planned in #1 to make bind address configurable (currently hardcoded to `0.0.0.0`).
