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
  getSessionClients,
  persistSession,
  deleteSession,
} from "./session-store.ts";
import type { FeedbackItem, PushResult } from "./server.ts";

const MAX_BODY_BYTES = 16 * 1024 * 1024; // 16MB — headroom for MAX_SCREENSHOT_BYTES (10MB) + base64 expansion

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytesReceived = 0;
    let tooLarge = false;
    req.on("error", reject);
    req.on("data", (chunk: Buffer) => {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_BODY_BYTES) {
        tooLarge = true;
        return; // drain without accumulating
      }
      body += chunk;
    });
    req.on("end", () => {
      if (tooLarge) {
        const err = new Error("Payload too large") as NodeJS.ErrnoException;
        err.code = "PAYLOAD_TOO_LARGE";
        reject(err);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function broadcastPendingStatus(sessionId: string): void {
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
  pushFeedback: (items: FeedbackItem[], sessionId: string) => Promise<PushResult>;
}

export function createHttpServer({ port, pkgVersion, srcDir, pushFeedback }: HttpServerOptions) {
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
      const widgetPath = path.join(srcDir, "..", "dist", "widget.js");
      fs.readFile(widgetPath, "utf8", (err, content) => {
        if (err) {
          res.writeHead(500);
          res.end("Error loading widget");
          return;
        }
        const injectedContent = content
          .replaceAll("__WEBSOCKET_BASE_URL__", `ws://localhost:${port}/ws`)
          .replaceAll("__WIDGET_VERSION__", pkgVersion);
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
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    if (urlObj.pathname === "/broadcast" && req.method === "POST") {
      parseJsonBody(req)
        .then((body) => {
          const sessionId = (body.sessionId as string) || urlObj.searchParams.get("session") || "unmatched";
          const processId = body.processId as string | undefined;
          const registered = sessionRegistry.get(sessionId);
          if (registered && registered.processId) {
            if (!processId || registered.processId !== processId) {
              res.writeHead(403, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Unauthorized: processId does not match" }));
              return;
            }
          }
          const message = body.message ?? body;
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
        .catch((err: NodeJS.ErrnoException) => {
          if (err.code === "PAYLOAD_TOO_LARGE") {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Payload too large" }));
            return;
          }
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        });
      return;
    }

    if (urlObj.pathname === "/push-notification" && req.method === "POST") {
      parseJsonBody(req)
        .then(async (data) => {
          const sessionId = data.sessionId as string;
          const processId = data.processId as string;
          if (!sessionId || !processId || !isValidSessionId(sessionId)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "sessionId and processId required" }));
            return;
          }
          const registered = sessionRegistry.get(sessionId);
          if (!registered || !registered.processId || registered.processId !== processId) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized: processId does not match registered session" }));
            return;
          }
          const items = data.items as FeedbackItem[];
          const result = await pushFeedback(items, sessionId);
          res.writeHead(result.ok ? 200 : 502, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch((err: NodeJS.ErrnoException) => {
          if (err.code === "PAYLOAD_TOO_LARGE") {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Payload too large" }));
            return;
          }
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
          const existing = sessionRegistry.get(data.sessionId as string);
          if (existing && existing.processId) {
            if (data.processId && existing.processId !== data.processId) {
              res.writeHead(409, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Session already registered by another process" }));
              return;
            }
            if (!data.processId) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "processId required for already-owned session" }));
              return;
            }
          }
          sessionRegistry.set(data.sessionId as string, {
            sessionId: data.sessionId as string,
            processId: (data.processId as string) || (existing?.processId ?? null),
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

  return { httpServer, broadcastPendingStatus };
}
