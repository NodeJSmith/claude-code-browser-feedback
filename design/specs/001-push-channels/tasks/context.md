# Context: Push-Based Claude Code Channels

## Problem & Motivation
The browser feedback MCP server uses pull-based tools that require Claude to actively call `wait_for_browser_feedback` or similar tools to receive user annotations. This forces a broken UX flow: Claude must start a feedback-specific skill, tell the user to go ahead, then sit in a polling loop. The user has to coordinate with Claude's tool-calling rhythm rather than submitting feedback whenever they notice something. With push-based channels, feedback arrives in Claude's context like a message — no tool call, no polling loop, no coordination overhead.

## Visual Artifacts
None.

## Key Decisions
1. Use Claude Code's `experimental.claude/channel` capability with `notifications/claude/channel` notification method. The MCP SDK already supports this — no upgrade needed.
2. One notification per "Send to Claude" click, containing all items in a single JSON array in `content`. Avoids ordering uncertainty from multiple simultaneous notifications.
3. Screenshots saved to disk as PNG files; absolute file paths included per-item in the content JSON. Channel `content` is a plain string — base64 images cannot be sent inline.
4. `pushFeedback` returns a typed `PushResult` (`{ ok: true } | { ok: false; reason: string }`). Error handling stays in `server.ts`; `ws-server.ts` branches on the result without knowing MCP transport details.
5. Per-session serialization via a `Map<string, Promise>` promise chain prevents concurrent sends from racing.
6. Server retries notification delivery up to 2 times with 1-second delays before returning `{ ok: false }`. Widget handles final failure.
7. Proxy instances relay feedback via `POST /push-notification` (processId-authenticated) to the owner instance, which saves screenshots and emits the notification.
8. Screenshot directory configurable via `FEEDBACK_SCREENSHOT_DIR` env var, default `os.tmpdir()/claude-browser-feedback/screenshots/`.

## Constraints & Anti-Patterns
- Channel `content` is a plain string, not MCP content blocks. Do NOT send base64 image data in notifications.
- `meta` attribute keys must be alphanumeric + underscores only. Hyphens are silently dropped.
- The `source` attribute on `<channel>` tags is set automatically by Claude Code — the server cannot override it.
- Only the MCP instance connected via stdio transport can emit notifications. Proxy instances must relay through the owner.
- Do NOT implement dual-mode operation (keeping pull tools as fallback). All 5 pull tools are deleted.
- Do NOT redesign the widget UI. Only two widget-connection changes: reconnect flush and push_failed handler.
- Clear pending queue only AFTER pushFeedback succeeds. Never clear before confirming delivery.
- `POST /push-notification` must validate `processId` against `sessionRegistry` — any localhost process can reach it due to CORS wildcard.

## Design Doc References
- `## Architecture` — full implementation details for each module change
- `## Replacement Targets` — 14 items being removed/replaced
- `## Edge Cases` — 7 failure modes with specified handling
- `## Test Strategy` — existing tests to adapt, new coverage, tests to remove
- `## Key Constraints` — 4 protocol-level constraints from Claude Code channels

## Convention Examples

### Module factory pattern

**Source:** `src/ws-server.ts:26-27`

```ts
export function createWsServer({ httpServer, port }: WsServerOptions) {
  // ... setup ...
  return { wss, broadcast };
}
```

New code (e.g., `createWsServer` gaining a `pushFeedback` parameter) should follow this options-object-in, named-exports-out pattern.

### Session-scoped state operations

**Source:** `src/session-store.ts:48-56`

```ts
export function getSessionPending(sid: string): unknown[] {
  if (!pendingFeedbackBySession.has(sid)) pendingFeedbackBySession.set(sid, []);
  return pendingFeedbackBySession.get(sid)!;
}

export function setSessionPending(sid: string, arr: unknown[]): void {
  pendingFeedbackBySession.set(sid, arr);
  persistSession(sid);
}
```

New screenshot operations should take `sessionId` as the scoping parameter.

### Atomic file writes

**Source:** `src/storage.ts:64-79`

```ts
export function flush(sessionId: string): void {
  const entry = pendingWrites.get(sessionId);
  if (!entry || !entry.state) return;
  pendingWrites.delete(sessionId);
  try {
    ensureRoot();
    const target = fileFor(sessionId);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry.state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error(`[browser-feedback-mcp] storage flush failed for ${sessionId}: ${(err as Error).message}`);
  }
}
```

Screenshot writes should use the same atomic temp-file-then-rename pattern with restrictive permissions.

### Dependency injection via options object

**Source:** `src/mcp-tools.ts:26-33, 38`

```ts
interface McpHandlersOptions {
  mcpServer: Server;
  port: number;
  sessionId: string;
  srcDir: string;
  proxy: ReturnType<typeof createProxyClient>;
  broadcast: (message: unknown, sessionId?: string) => void;
}

export function registerMcpHandlers({ mcpServer, port, sessionId, srcDir, proxy, broadcast }: McpHandlersOptions): void {
```

The `pushFeedback` callback should be threaded through options objects the same way, not via module-level imports.
