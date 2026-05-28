# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser Feedback MCP is an MCP server that injects a visual annotation widget into the browser. Users click elements, add descriptions, and Claude receives screenshots + element metadata + console logs. Being rewritten from plain JS to TypeScript and converting from pull-based MCP to push-based Claude Code channels.

## Commands

```bash
npm install          # Install dependencies
npm run build:widget # Bundle widget TS modules into dist/widget.js (esbuild)
npm start            # Run the MCP server (auto-builds widget via prestart)
npm test             # Run tests (vitest)
npm run test:coverage # Run tests with coverage report
npm run test:watch   # Run tests in watch mode
npm run typecheck    # Type-check with tsc (no emit)
npm run lint         # ESLint
npm run format       # Prettier
```

CI runs on Node 22 (`npm ci && npm test`).

## Architecture

TypeScript (strict mode, ES modules), run via Node 22's `--experimental-strip-types`. No build step for server code — `tsc` is used only for type checking (`npm run typecheck`). Imports use `.ts` extensions.

**Server modules** (run directly via Node):

- `src/server.ts` — Entry point: constants, lifecycle, wiring. Creates MCP/HTTP/WS servers and wires modules together. Defines `pushFeedback` callback for channel notification delivery. Handles shutdown drain (waits for in-flight pushes before cleanup) and startup screenshot sweep.
- `src/session-store.ts` — Session state (Maps, Sets, `isHttpServerOwner` flag), accessor functions.
- `src/proxy-client.ts` — Factory for HTTP helpers used by secondary (non-owner) MCP instances to reach the owner server.
- `src/http-server.ts` — HTTP server creation, REST routes, static asset serving (widget, html2canvas, demo page).
- `src/ws-server.ts` — WebSocket server creation, connection/message/close handling, broadcast function. The `send_to_claude` handler calls `pushFeedback` to deliver feedback via channel notification.
- `src/mcp-tools.ts` — MCP tool schemas (ListTools) and tool handler implementations (CallTool). On-demand tools only — polling tools removed.
- `src/utils.ts` — Shared helpers: `deriveSessionId`, `isValidSessionId`, project URL detection.
- `src/storage.ts` — Disk-backed feedback persistence with debounced atomic writes.
- `src/screenshots.ts` — Screenshot file I/O: decode from base64, atomic write to disk, session cleanup, orphan sweep.

**Widget modules** (bundled by esbuild into `dist/widget.js`):

- `src/widget/widget.ts` — Entry point: init guard, console capture, init/destroy, self-healing.
- `src/widget/widget-state.ts` — All mutable state, typed accessors, constants (`WIDGET_ID`, `SESSION_ID_RE`).
- `src/widget/widget-dom.ts` — CSS string, HTML template, `createWidget()`.
- `src/widget/widget-selection.ts` — Pure functions: `getElementSelector`, `getTruncatedSelector`, `getFullSelector`, `getElementInfo`.
- `src/widget/widget-screenshot.ts` — html2canvas loading + screenshot capture.
- `src/widget/widget-connection.ts` — WebSocket lifecycle, session resolution, message dispatch, `sendMessage`/`isSocketOpen` API.
- `src/widget/widget-annotation.ts` — Annotation mode, pending queue UI, event binding, export helpers, notifications.

**Other:**

- `extension/` — Chrome/Firefox MV3 browser extension for toggling the widget.

### Key patterns

- `__WEBSOCKET_BASE_URL__` and `__WIDGET_VERSION__` placeholders in the bundled widget are replaced at serve-time by the HTTP server.
- Widget internal DOM access uses `getEl()` helper (queries shadow root, not `document`).
- `window.__claudeFeedbackDestroy()` handles clean teardown (used by the browser extension).
- Session isolation: deterministic UUID derived from `process.cwd()`. All storage, WebSocket broadcasts, and MCP responses are partitioned by session ID.
- Multi-process: first process owns the HTTP server port; subsequent processes register via `POST /register-session` and run in proxy mode.

## Active Rewrite (3 epics)

Work these in order — each depends on the previous:

1. **#1 TypeScript conversion + code quality** — Done. All server and widget code is TypeScript. Server modules run via `--experimental-strip-types`; widget modules bundled by esbuild into `dist/widget.js`.

2. **#2 Convert to Claude Code channels** — Done. Added `experimental.claude/channel` capability. Feedback pushed via `mcp.notification()` instead of polling. Screenshots saved to disk with file paths in channel messages. Pull-based tools removed; on-demand tools kept. Shutdown drain and startup screenshot sweep wired in.

3. **#3 Testing backfill** — Done. All 7 widget modules have test coverage (200 tests across 11 files). Existing test files converted from JS to TS. Coverage enforcement via `vitest --coverage` with per-directory thresholds (75%+ statements/lines for widget code). DOM tests use happy-dom environment.

## Configuration

- `FEEDBACK_PORT` (default: `9877`) — HTTP/WebSocket server port.
- `FEEDBACK_HOST` (default: `127.0.0.1`) — Bind address. Listens on localhost only by default.
- `FEEDBACK_SCREENSHOT_DIR` (default: `os.tmpdir()/claude-browser-feedback/screenshots/`) — Directory where screenshots are saved. Each session gets a subdirectory named by session ID; the directory is cleaned up on shutdown and orphan directories are swept on startup.
