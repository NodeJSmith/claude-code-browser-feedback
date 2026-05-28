---
task_id: "T04"
title: "Delete pull-based tools and simplify session state"
status: "planned"
depends_on: ["T03"]
implements: ["FR#7", "FR#8", "AC#4", "AC#5"]
---

## Summary
Remove all 5 pull-based MCP tools and their handlers, simplify session-store by removing the ready queue, resolvers, and orphan recovery, drop the `ready` field from storage, and remove `formatFeedbackAsContent` from utils. This is the big cleanup task — pure subtraction. After T03 converted the push path, nothing references these anymore.

## Prompt
### mcp-tools.ts — remove 5 tools

1. **Remove tool schemas** from the `ListToolsRequestSchema` handler (lines 107–181): `wait_for_browser_feedback`, `get_pending_feedback`, `preview_pending_feedback`, `delete_pending_feedback`, `wait_for_multiple_feedback`.

2. **Remove tool handlers** from the `CallToolRequestSchema` handler: cases `wait_for_browser_feedback` (lines 568–616), `get_pending_feedback` (lines 618–727), `preview_pending_feedback` (lines 729–784), `delete_pending_feedback` (lines 786–845), `wait_for_multiple_feedback` (lines 847–981).

3. **Remove constants**: `DEFAULT_TIMEOUT_SECONDS` (line 35) and `IDLE_TIMEOUT_MS` (line 36).

4. **Update `request_annotation` description** (line 196): remove "After calling this, use wait_for_browser_feedback ONCE to receive the response. Do not loop - act on the feedback received." Replace with "After calling this, the user's response will arrive as a channel notification."

5. **Update `install_widget` response text** (around line 416): replace `2. Use \`wait_for_browser_feedback\` to receive feedback from the browser` with `2. Feedback will arrive automatically as channel notifications`. Add a line: `**Security note:** The widget is designed for developer-controlled pages only. The dev-only hostname guard is a security control against prompt injection, not just a convenience feature.`

6. **Clean up imports**: remove `formatFeedbackAsContent` from `./utils.ts` import; remove `getSessionReady`, `setSessionReady`, `getSessionResolvers`, `findOrphanBuckets`, `migrateOrphanInto` from `./session-store.ts` import; remove `broadcastPendingStatus` from `./http-server.ts` import (verify it's no longer used in mcp-tools.ts after removing the 5 handlers); remove `getPendingSummary` if no longer used.

### session-store.ts — remove dead state

7. Remove `readyFeedbackBySession` map (line 26) and its accessors `getSessionReady` / `setSessionReady`.
8. Remove `feedbackResolversBySession` map (line 27) and its accessor `getSessionResolvers`. Remove the `FeedbackResolver` type.
9. Remove `findOrphanBuckets` function.
10. Remove `migrateOrphanInto` function.
11. Update `deleteSession` to remove only the maps that still exist (`pendingFeedbackBySession`, `connectedClientsBySession`).
12. Update `persistSession` — it currently saves both pending and ready. Change to save only pending (ready is gone).

### storage.ts — drop ready field

13. Remove `ready` from `StorageState` interface.
14. Update `save()` — write only `{ pending, updatedAt }`.
15. Update `load()` — return only `{ pending }`. Ignore any `ready` field in legacy files.

### utils.ts — remove formatFeedbackAsContent

16. Remove `formatFeedbackAsContent` function and its supporting types (`TextContent`, `ImageContent`, `ContentBlock`).

### server.ts — clean up imports

17. Remove `setSessionReady` import from `./session-store.ts` (line 17).
18. In the storage rehydration loop (lines 163–172), remove the `ready` destructuring and the `setSessionReady` call. Only rehydrate `pending`.

### Update tests

19. **tests/storage.test.ts**: Update assertions from `{ pending: [], ready: [] }` to `{ pending: [] }`. Update save/load tests to not include `ready`. Add a test that loading a legacy file with a `ready` field returns only `{ pending }` (ready is ignored).

20. **tests/utils.test.ts**: Remove the entire `describe("formatFeedbackAsContent", ...)` block (lines 136–end). Keep tests for `deriveSessionId`, `isValidSessionId`, `getPendingSummary`, `detectProjectUrl`.

21. **tests/http-endpoints.test.ts**: Remove the test `GET /feedback?session=<id> returns empty for unknown session` (line 187). Remove the test `DELETE /feedback/<id>?session=<id> returns 404` (line 195). Remove the `describe("orphan bucket reporting", ...)` block (line 444).

## Focus
- This is a big diff but it's all deletion. Verify with `npm run typecheck` that no remaining code references the removed exports.
- `broadcastPendingStatus` in `http-server.ts` is still needed (used by ws-server.ts). Do NOT remove it. Only remove its import from mcp-tools.ts.
- `getPendingSummary` in utils.ts is still needed (used by ws-server.ts and http-server.ts via `broadcastPendingStatus`). Only remove its import from mcp-tools.ts if `preview_pending_feedback` was the only user there.
- The `get_connection_status` tool handler (line 982) references `findOrphanBuckets()` at line 1042. This reference must be removed — the orphan bucket info was returned in the status JSON. Remove the `orphanSessions` field from the `get_connection_status` response for the owner path. The proxy path also references `status.orphanSessions` — remove that field too.
- `http-server.ts` imports `getSessionReady`, `setSessionReady`, `findOrphanBuckets`, `migrateOrphanInto` — these will be cleaned up in T05 when the HTTP endpoints are removed.

## Verify
- [ ] FR#7: ListTools response contains zero polling-based tools (verify the 5 names are absent)
- [ ] FR#8: All 7 on-demand tools still appear in ListTools and their handlers respond correctly
- [ ] AC#4: Tool catalog contains zero pull tools
- [ ] AC#5: On-demand tools respond correctly to CallTool requests
