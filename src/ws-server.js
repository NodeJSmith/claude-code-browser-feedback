import { WebSocketServer, WebSocket } from "ws";
import { getPendingSummary } from "./utils.ts";
import {
  sessionRegistry,
  connectedClients,
  persistSession,
  getSessionPending,
  setSessionPending,
  getSessionReady,
  setSessionReady,
  getSessionResolvers,
  getSessionClients,
} from "./session-store.ts";
import { broadcastPendingStatus } from "./http-server.js";

export function createWsServer({ httpServer, port }) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws", clientTracking: true });

  wss.on("error", (err) => {
    console.error("[browser-feedback-mcp] WebSocket server error:", err.message);
  });

  wss.on("connection", (ws, req) => {
    const reqUrl = new URL(req.url, `http://localhost:${port}`);
    const rawSession = reqUrl.searchParams.get("session");
    let sessionId = rawSession || "unmatched";
    let rebindReason = null;

    if (rawSession && !sessionRegistry.has(rawSession)) {
      const registered = Array.from(sessionRegistry.keys());
      if (registered.length === 1) {
        const target = registered[0];
        console.error(
          `[browser-feedback-mcp] Rebinding WS client from unknown session ${rawSession} -> ${target}`,
        );
        rebindReason = { from: rawSession, to: target };
        sessionId = target;
      } else if (registered.length > 1) {
        console.error(
          `[browser-feedback-mcp] WS client connected with unknown session ${rawSession}; ${registered.length} sessions registered. Sending session_invalid.`,
        );
        try {
          ws.send(
            JSON.stringify({
              type: "session_invalid",
              providedSession: rawSession,
              knownSessions: registered,
              reason: "Session ID not recognized. Reload the page to fetch the current widget.",
            }),
          );
        } catch (_) {
          /* ignore */
        }
        ws.close(4001, "session_invalid");
        return;
      }
    }
    ws._sessionId = sessionId;

    if (!rawSession) {
      console.error(
        `[browser-feedback-mcp] WARNING: WebSocket connection without session param. Client placed in 'unmatched' bucket.`,
      );
    }

    connectedClients.add(ws);
    const sessionClients = getSessionClients(sessionId);
    const existingCount = sessionClients.size;
    sessionClients.add(ws);
    console.error(
      `[browser-feedback-mcp] Client connected (session: ${sessionId}). Total: ${connectedClients.size}`,
    );

    const connectionMsg = {
      type: "connected",
      message: "Connected to Claude Code feedback server",
      sessionId,
      sessionClientCount: existingCount + 1,
    };
    if (!rawSession) {
      connectionMsg.sessionWarning =
        "No session ID provided. This connection is not linked to any Claude Code session.";
    }
    if (rebindReason) {
      connectionMsg.rebound = rebindReason;
    }
    if (existingCount > 0) {
      connectionMsg.duplicateWarning = `This session already has ${existingCount} other connected client(s). The same site may be open in another tab.`;
    }
    ws.send(JSON.stringify(connectionMsg));

    const status = getPendingSummary(getSessionPending(sessionId));
    ws.send(JSON.stringify({ type: "pending_status", ...status }));

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const sid = ws._sessionId;

        if (message.type === "feedback") {
          console.error(`[browser-feedback-mcp] Received feedback from browser (session: ${sid})`);

          const feedback = {
            ...message.payload,
            receivedAt: new Date().toISOString(),
          };

          getSessionPending(sid).push(feedback);
          persistSession(sid);

          ws.send(JSON.stringify({ type: "feedback_received", id: feedback.id }));
          broadcastPendingStatus(sid);
        }

        if (message.type === "send_to_claude") {
          const pending = getSessionPending(sid);
          const ready = getSessionReady(sid);
          ready.push(...pending);
          setSessionPending(sid, []);
          broadcastPendingStatus(sid);

          const count = ready.length;

          const resolvers = getSessionResolvers(sid);
          if (resolvers.length > 0) {
            while (resolvers.length > 0) {
              const resolver = resolvers.shift();
              resolver([...ready]);
            }
            setSessionReady(sid, []);
          }

          ws.send(
            JSON.stringify({
              type: "sent_to_claude",
              count: count,
            }),
          );
        }

        if (message.type === "delete_feedback") {
          const idToDelete = message.id;
          const pending = getSessionPending(sid);
          const initialLength = pending.length;
          setSessionPending(
            sid,
            pending.filter((f) => f.id !== idToDelete),
          );
          const deleted = getSessionPending(sid).length < initialLength;

          if (deleted) {
            console.error(`[browser-feedback-mcp] Deleted feedback: ${idToDelete} (session: ${sid})`);
            broadcastPendingStatus(sid);
          }

          ws.send(
            JSON.stringify({
              type: "feedback_deleted",
              id: idToDelete,
              success: deleted,
            }),
          );
        }
      } catch (err) {
        console.error("[browser-feedback-mcp] Error parsing message:", err);
      }
    });

    ws.on("close", () => {
      connectedClients.delete(ws);
      getSessionClients(ws._sessionId).delete(ws);
      console.error(
        `[browser-feedback-mcp] Client disconnected (session: ${ws._sessionId}). Total: ${connectedClients.size}`,
      );
    });
  });

  function broadcast(message, sessionId) {
    const data = JSON.stringify(message);
    const clients = sessionId ? getSessionClients(sessionId) : connectedClients;
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  return { wss, broadcast };
}
