---
task_id: "T03"
title: "Convert WS send_to_claude handler and add widget push support"
status: "done"
depends_on: ["T02"]
implements: ["FR#3", "AC#2"]
---

## Summary
Replace the promise-resolver-based `send_to_claude` WebSocket handler with the `pushFeedback` callback from T02, and add two widget-connection changes: a `push_failed` message handler and a reconnect flush for offline-queued items. After this task, the end-to-end push path works: user clicks "Send to Claude" in the browser, the server pushes a notification to Claude, and the widget handles success/failure feedback.

## Prompt
### ws-server.ts changes

1. **Add `pushFeedback` to options** — extend the `WsServerOptions` interface (or create one if inline) to accept `pushFeedback: (items: FeedbackItem[]) => Promise<PushResult>`. Thread it from `createWsServer`'s options parameter.

2. **Replace `send_to_claude` handler** — in `ws.on("message", ...)` (around line 126), replace the current handler:
   ```ts
   // Current: moves pending → ready, resolves blocking promises
   // New: calls pushFeedback, clears only on success
   if (message.type === "send_to_claude") {
     const pending = getSessionPending(sid);
     const items = [...pending];
     const result = await pushFeedback(items);
     if (result.ok) {
       setSessionPending(sid, []);
       broadcastPendingStatus(sid);
       ws.send(JSON.stringify({ type: "sent_to_claude", count: items.length }));
     } else {
       ws.send(JSON.stringify({ type: "push_failed", reason: result.reason }));
     }
   }
   ```
   Note: the handler must be `async` — the current WS message handler wraps in try/catch which is fine.

3. **Wire in server.ts** — update the `createWsServer` call in `src/server.ts` to pass the `pushFeedback` callback. The callback is defined in server.ts (from T02).

4. **Remove stale imports** from ws-server.ts: `getSessionReady`, `setSessionReady`, `getSessionResolvers` will no longer be used by the send_to_claude handler. However, do NOT remove them yet if other code in ws-server.ts still references them — T04 handles the full cleanup.

### widget-connection.ts changes

5. **Add `push_failed` handler** — in `handleServerMessage()` (around line 94), add a new case:
   ```ts
   } else if (message.type === "push_failed") {
     handlers?.onError((message.reason as string) || "Failed to send feedback to Claude");
   }
   ```
   This reuses the existing `onError` handler callback which shows an error notification in the widget.

6. **Add reconnect flush** — in `connectWebSocket()`, inside `socket.onopen` (around line 63), after setting `isConnected = true`, flush any `localPendingItems`:
   ```ts
   import { localPendingItems, setLocalPendingItems } from "./widget-state.ts";
   // ... in socket.onopen:
   if (localPendingItems.length > 0) {
     for (const item of localPendingItems) {
       socket.send(JSON.stringify({ type: "feedback", payload: item }));
     }
     setLocalPendingItems([]);
   }
   ```
   This fixes the pre-existing bug where items queued offline were silently lost.

### Tests

Update `tests/widget-connection.test.ts`:
- Test that `push_failed` message calls `handlers.onError` with the reason string
- Test that `push_failed` without a reason uses a default message
- Test reconnect flush: mock `localPendingItems` with items, trigger `onopen`, verify each was sent as `{ type: "feedback", payload: item }` and `localPendingItems` was cleared

## Focus
- The WS `message` handler is synchronous at entry but becomes async with `await pushFeedback(...)`. Make sure the handler function is `async` — the outer try/catch at `ws-server.ts:106` already wraps the handler, so rejected promises will be caught.
- `broadcastPendingStatus` is imported from `src/http-server.ts` — keep this import, it's still needed.
- The `sent_to_claude` response type is unchanged — the widget already handles it (line 137 of widget-connection.ts). Only `push_failed` is new.
- For the reconnect flush, `localPendingItems` is exported from `src/widget/widget-state.ts`. `sendMessage` is already available in widget-connection.ts but sends via the module-level `ws` variable — use `socket.send` directly in `onopen` since the module-level `ws` may not be set yet at that point in the handler.
- The reconnect flush sends items as `{ type: "feedback", payload: item }` — the same format the widget uses in `addItem()` at `widget-annotation.ts:147`. The server's existing `feedback` WS message handler in ws-server.ts stores them in pending.

## Verify
- [ ] FR#3: When user clicks "Send to Claude", server pushes notification without Claude calling a tool
- [ ] AC#2: Push notification delivered with user-supplied text separate from system metadata, no tool call required
