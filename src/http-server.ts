import http from "http";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { WebSocket } from "ws";
import { isValidSessionId, getPendingSummary } from "./utils.ts";
import * as storage from "./storage.ts";
import {
  sessionRegistry,
  connectedClients,
  getSessionPending,
  setSessionPending,
  getSessionReady,
  setSessionReady,
  getSessionClients,
  findOrphanBuckets,
  migrateOrphanInto,
  persistSession,
  deleteSession,
} from "./session-store.ts";

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });
}

export function broadcastPendingStatus(sessionId: string): void {
  const status = getPendingSummary(getSessionPending(sessionId));
  const message = JSON.stringify({ type: "pending_status", ...status });
  for (const client of getSessionClients(sessionId)) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

interface HttpServerOptions {
  port: number;
  pkgVersion: string;
  srcDir: string;
}

export function createHttpServer({ port, pkgVersion, srcDir }: HttpServerOptions) {
  const httpServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const urlObj = new URL(req.url!, `http://localhost:${port}`);

    if (urlObj.pathname === "/widget.js") {
      const widgetPath = path.join(srcDir, "widget.js");
      fs.readFile(widgetPath, "utf8", (err, content) => {
        if (err) {
          res.writeHead(500);
          res.end("Error loading widget");
          return;
        }
        const injectedContent = content
          .replace("__WEBSOCKET_BASE_URL__", `ws://localhost:${port}/ws`)
          .replace("__WIDGET_VERSION__", pkgVersion);
        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-store",
        });
        res.end(injectedContent);
      });
      return;
    }

    if (urlObj.pathname === "/html2canvas.min.js") {
      const require = createRequire(import.meta.url);
      const html2canvasPath = path.join(
        path.dirname(require.resolve("html2canvas/package.json")),
        "dist",
        "html2canvas.min.js",
      );
      fs.readFile(html2canvasPath, "utf8", (err, content) => {
        if (err) {
          res.writeHead(404);
          res.end("html2canvas not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(content);
      });
      return;
    }

    if (urlObj.pathname === "/demo/index.html" || urlObj.pathname === "/demo/") {
      const demoPath = path.join(srcDir, "..", "demo", "index.html");
      fs.readFile(demoPath, "utf8", (err, content) => {
        if (err) {
          res.writeHead(404);
          res.end("Demo page not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
      });
      return;
    }

    if (urlObj.pathname === "/status") {
      const sessionId = urlObj.searchParams.get("session");
      const response = {
        status: "running",
        port,
        connectedClients: sessionId ? getSessionClients(sessionId).size : connectedClients.size,
        pendingFeedback: sessionId ? getSessionPending(sessionId).length : 0,
        sessions: sessionRegistry.size,
        orphanSessions: findOrphanBuckets(),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    if (urlObj.pathname === "/feedback" && req.method === "GET") {
      const shouldClear = urlObj.searchParams.get("clear") !== "false";
      const sessionId = urlObj.searchParams.get("session") || "unmatched";
      const sessionReady = getSessionReady(sessionId);
      let feedback = [...sessionReady];
      if (shouldClear) {
        setSessionReady(sessionId, []);
      }
      let orphans = findOrphanBuckets();
      if (feedback.length === 0 && isValidSessionId(sessionId) && sessionRegistry.has(sessionId)) {
        if (orphans.length > 0 && sessionRegistry.size === 1) {
          for (const o of orphans) {
            console.error(
              `[browser-feedback-mcp] /feedback rescuing orphan ${o.sessionId} into ${sessionId}`,
            );
            migrateOrphanInto(sessionId, o.sessionId);
          }
          const rescuedReady = getSessionReady(sessionId);
          const rescuedPending = getSessionPending(sessionId);
          feedback = [...rescuedReady, ...rescuedPending];
          if (shouldClear) {
            setSessionReady(sessionId, []);
            setSessionPending(sessionId, []);
          }
          orphans = [];
        }
      } else {
        orphans = [];
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ feedback, orphans }));
      return;
    }

    if (urlObj.pathname === "/pending-summary" && req.method === "GET") {
      const sessionId = urlObj.searchParams.get("session") || "unmatched";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getPendingSummary(getSessionPending(sessionId))));
      return;
    }

    const deleteMatch = urlObj.pathname.match(/^\/feedback\/([^/]+)$/);
    if (deleteMatch && req.method === "DELETE") {
      const idToDelete = deleteMatch[1];
      const sessionId = urlObj.searchParams.get("session") || "unmatched";
      const pending = getSessionPending(sessionId) as { id?: string }[];
      const initialLength = pending.length;
      setSessionPending(
        sessionId,
        pending.filter((f) => f.id !== idToDelete),
      );
      const deleted = getSessionPending(sessionId).length < initialLength;

      if (deleted) {
        broadcastPendingStatus(sessionId);
      }

      res.writeHead(deleted ? 200 : 404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: deleted,
          message: deleted ? "Feedback deleted" : "Feedback not found",
        }),
      );
      return;
    }

    if (urlObj.pathname === "/broadcast" && req.method === "POST") {
      const sessionId = urlObj.searchParams.get("session") || "unmatched";
      parseJsonBody(req)
        .then((message) => {
          const data = JSON.stringify(message);
          let sentCount = 0;
          for (const client of getSessionClients(sessionId)) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(data);
              sentCount++;
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, clientCount: sentCount }));
        })
        .catch(() => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        });
      return;
    }

    if (urlObj.pathname === "/sessions" && req.method === "GET") {
      const sessions = Array.from(sessionRegistry.values());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    if (urlObj.pathname === "/register-session" && req.method === "POST") {
      parseJsonBody(req)
        .then((data) => {
          if (!isValidSessionId(data.sessionId)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid session ID format" }));
            return;
          }
          for (const [existingId, existingMeta] of sessionRegistry) {
            if (existingId !== data.sessionId && existingMeta.projectDir === data.projectDir) {
              const oldPending = getSessionPending(existingId);
              if (oldPending.length > 0) {
                getSessionPending(data.sessionId as string).push(...oldPending);
              }
              const oldReady = getSessionReady(existingId);
              if (oldReady.length > 0) {
                getSessionReady(data.sessionId as string).push(...oldReady);
              }
              const oldClients = getSessionClients(existingId);
              if (oldClients.size > 0) {
                const newClients = getSessionClients(data.sessionId as string);
                for (const client of oldClients) {
                  (client as unknown as { _sessionId: string })._sessionId = data.sessionId as string;
                  newClients.add(client);
                }
              }
              deleteSession(existingId);
              sessionRegistry.delete(existingId);
              storage.remove(existingId);
              persistSession(data.sessionId as string);
              console.error(
                `[browser-feedback-mcp] Migrated session data: ${existingId} -> ${data.sessionId}`,
              );
            }
          }
          sessionRegistry.set(data.sessionId as string, {
            sessionId: data.sessionId as string,
            processId: (data.processId as string) || null,
            projectDir: data.projectDir as string,
            projectUrl: (data.projectUrl as string) || null,
            detectedFrom: (data.detectedFrom as string) || null,
            registeredAt: new Date().toISOString(),
          });
          console.error(
            `[browser-feedback-mcp] Session registered: ${data.sessionId} (${data.projectDir})`,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        })
        .catch(() => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        });
      return;
    }

    if (urlObj.pathname === "/unregister-session" && req.method === "POST") {
      parseJsonBody(req)
        .then((data) => {
          if (!isValidSessionId(data.sessionId)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid session ID format" }));
            return;
          }
          const existing = sessionRegistry.get(data.sessionId as string);
          if (
            existing &&
            data.processId &&
            existing.processId &&
            existing.processId !== data.processId
          ) {
            console.error(
              `[browser-feedback-mcp] Skipping unregister: session ${data.sessionId} owned by different process`,
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, skipped: true }));
            return;
          }
          sessionRegistry.delete(data.sessionId as string);
          deleteSession(data.sessionId as string);
          console.error(`[browser-feedback-mcp] Session unregistered: ${data.sessionId}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        })
        .catch(() => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  return { httpServer };
}
