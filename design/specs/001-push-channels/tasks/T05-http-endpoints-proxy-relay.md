---
task_id: "T05"
title: "Clean up HTTP endpoints and add proxy push relay"
status: "planned"
depends_on: ["T02", "T04"]
implements: ["FR#10", "AC#7"]
---

## Summary
Add the authenticated `POST /push-notification` proxy relay endpoint, harden `parseJsonBody`, and update `proxy-client.ts` to replace polling methods with the new push relay. After this task, proxy instances (secondary MCP processes sharing the same port) can relay feedback through the owner for notification delivery. (The 3 pull HTTP endpoints were already removed in T04 alongside the session-store functions they depended on.)

## Prompt
### http-server.ts changes

1. **Add `pushFeedback` to options** — extend `HttpServerOptions` to accept `pushFeedback: (items: FeedbackItem[]) => Promise<PushResult>`. Thread it from the `createHttpServer` call in `server.ts`.

2. **Add `POST /push-notification` endpoint** — after the existing `POST /broadcast` handler:
   ```ts
   if (urlObj.pathname === "/push-notification" && req.method === "POST") {
     parseJsonBody(req)
       .then(async (data) => {
         // Validate processId against sessionRegistry
         const sessionId = data.sessionId as string;
         const processId = data.processId as string;
         if (!sessionId || !processId) {
           res.writeHead(400, { "Content-Type": "application/json" });
           res.end(JSON.stringify({ error: "sessionId and processId required" }));
           return;
         }
         const registered = sessionRegistry.get(sessionId);
         if (!registered || registered.processId !== processId) {
           res.writeHead(403, { "Content-Type": "application/json" });
           res.end(JSON.stringify({ error: "Unauthorized: processId does not match registered session" }));
           return;
         }
         const items = data.items as FeedbackItem[];
         const result = await pushFeedback(items);
         res.writeHead(result.ok ? 200 : 502, { "Content-Type": "application/json" });
         res.end(JSON.stringify(result));
       })
       .catch(() => {
         res.writeHead(400, { "Content-Type": "application/json" });
         res.end(JSON.stringify({ error: "Invalid JSON" }));
       });
     return;
   }
   ```

4. **Harden `parseJsonBody`**:
   - Add `req.on("error", reject)` to handle mid-stream aborts
   - Add a byte accumulator: reject with a `PayloadTooLarge` error when accumulated bytes exceed `16 * 1024 * 1024` (16MB)

### proxy-client.ts changes

5. **Remove polling methods**: `pollForFeedback`, `fetchReadyFeedback`, `fetchPendingSummary`, `deleteFeedbackViaHttp`.

6. **Add `pushFeedbackViaHttp`**:
   ```ts
   async function pushFeedbackViaHttp(items: unknown[]): Promise<{ ok: boolean; reason?: string }> {
     const response = await fetch(`${baseUrl}/push-notification`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ sessionId, processId, items }),
       signal: AbortSignal.timeout(5000),
     });
     if (response.ok) {
       return (await response.json()) as { ok: boolean; reason?: string };
     }
     return { ok: false, reason: `HTTP ${response.status}` };
   }
   ```

7. **Add timeouts to all remaining `fetch()` calls** — add `signal: AbortSignal.timeout(5000)` to `fetchServerStatus`, `broadcastViaHttp`, `registerSession`, `unregisterSession`.

### server.ts wiring

8. Update the `createHttpServer` call to pass `pushFeedback`.

### Tests

Update `tests/http-endpoints.test.ts` (pull endpoint tests and orphan tests were already removed in T04):
- Add tests for `POST /push-notification`:
  - Returns 400 when sessionId or processId missing
  - Returns 403 when processId doesn't match registered session
  - Returns 200 with `{ ok: true }` when processId matches and push succeeds
  - Returns 502 with `{ ok: false }` when push fails
- Add test for `parseJsonBody` rejecting payloads over 16MB (HTTP 413)
- Add test for `parseJsonBody` handling mid-stream abort gracefully

## Focus
- The `parseJsonBody` function is used by ALL POST endpoints (broadcast, register-session, unregister-session, and now push-notification). The byte limit and error handler apply globally.
- T04 already removed ready-related code from `/register-session` and the 3 pull HTTP endpoints. Only pending migration and WebSocket client rebinding remain.
- `broadcastPendingStatus` function (line 38) stays — it's used by ws-server.ts. It only reads `getSessionPending` which is still present.
- For the proxy-client, `AbortSignal.timeout()` is available in Node 18+. The project runs on Node 22.
- The test for POST /push-notification needs a registered session. Use the existing `registerSession` helper in the test file (line 250) to set up the session before testing the endpoint.

## Verify
- [ ] FR#10: Feedback submitted through a secondary instance triggers POST /push-notification on owner, which pushes the notification
- [ ] AC#7: Proxy-submitted feedback results in a push notification from the primary instance
