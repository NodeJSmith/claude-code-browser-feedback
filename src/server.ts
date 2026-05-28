#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { fileURLToPath } from "url";
import { deriveSessionId, detectProjectUrl } from "./utils.ts";
import * as storage from "./storage.ts";
import {
  sessionRegistry,
  connectedClients,
  isHttpServerOwner,
  setHttpServerOwner,
  setSessionPending,
  setSessionReady,
} from "./session-store.ts";
import { createProxyClient } from "./proxy-client.ts";
import { createHttpServer } from "./http-server.ts";
import { createWsServer } from "./ws-server.ts";
import { registerMcpHandlers } from "./mcp-tools.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.FEEDBACK_PORT || "9877");
const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
).version;

const PROJECT_DIR = process.cwd();
const SESSION_ID = deriveSessionId(PROJECT_DIR);
const PROCESS_ID = crypto.randomUUID();
const proxy = createProxyClient({ port: PORT, sessionId: SESSION_ID, processId: PROCESS_ID, projectDir: PROJECT_DIR });

const { httpServer } = createHttpServer({ port: PORT, pkgVersion: PKG_VERSION, srcDir: __dirname });
const { wss, broadcast } = createWsServer({ httpServer, port: PORT });

const mcpServer = new Server(
  { name: "browser-feedback-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

registerMcpHandlers({ mcpServer, port: PORT, sessionId: SESSION_ID, srcDir: __dirname, proxy, broadcast });

let isShuttingDown = false;

function shutdown(reason: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.error(`[browser-feedback-mcp] Shutting down: ${reason}`);

  if (isHttpServerOwner()) {
    try {
      storage.flushAll();
    } catch {
      /* ignore */
    }

    const ownSession = sessionRegistry.get(SESSION_ID);
    if (ownSession && ownSession.processId === PROCESS_ID) {
      sessionRegistry.delete(SESSION_ID);
    }

    for (const client of connectedClients) {
      try {
        client.close();
      } catch {
        // Ignore errors during shutdown
      }
    }

    wss.close(() => {
      console.error("[browser-feedback-mcp] WebSocket server closed");
    });

    httpServer.close(() => {
      console.error("[browser-feedback-mcp] HTTP server closed");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("[browser-feedback-mcp] Forcing exit after timeout");
      process.exit(0);
    }, 2000);
  } else {
    proxy.unregisterSession().finally(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000);
  }
}

process.stdin.on("end", () => shutdown("stdin ended"));
process.stdin.on("close", () => shutdown("stdin closed"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function tryListenWithRetry(maxRetries = 3, retryDelay = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          httpServer.removeListener("error", onError);
          reject(err);
        };
        httpServer.on("error", onError);
        httpServer.listen(PORT, () => {
          httpServer.removeListener("error", onError);
          resolve();
        });
      });
      setHttpServerOwner(true);
      console.error(
        `[browser-feedback-mcp] HTTP/WebSocket server running on http://localhost:${PORT}`,
      );
      console.error(
        `[browser-feedback-mcp] Widget available at http://localhost:${PORT}/widget.js`,
      );
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" && (err as NodeJS.ErrnoException).code !== "EPERM") {
        console.error(`[browser-feedback-mcp] HTTP server error:`, err);
        return;
      }

      const status = await proxy.fetchServerStatus();
      if (status) {
        console.error(`[browser-feedback-mcp] Port ${PORT} is in use by a healthy server.`);
        console.error(
          `[browser-feedback-mcp] MCP tools will proxy requests to the running server.`,
        );
        return;
      }

      if (attempt <= maxRetries) {
        console.error(
          `[browser-feedback-mcp] Port ${PORT} is held by an unresponsive process. Retrying in ${retryDelay}ms... (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, retryDelay));
      } else {
        console.error(
          `[browser-feedback-mcp] Port ${PORT} still unavailable after ${maxRetries} retries. Running in proxy mode.`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[browser-feedback-mcp] MCP server connected via stdio");

  await tryListenWithRetry();

  const detected = detectProjectUrl(PROJECT_DIR);
  if (isHttpServerOwner()) {
    try {
      for (const sid of storage.listSessions()) {
        const { pending, ready } = storage.load(sid);
        if (pending.length || ready.length) {
          setSessionPending(sid, pending);
          setSessionReady(sid, ready);
          console.error(
            `[browser-feedback-mcp] Rehydrated session ${sid}: ${pending.length} pending, ${ready.length} ready`,
          );
        }
      }
    } catch (err) {
      console.error(`[browser-feedback-mcp] Rehydrate failed: ${(err as Error).message}`);
    }
    sessionRegistry.set(SESSION_ID, {
      sessionId: SESSION_ID,
      processId: PROCESS_ID,
      projectDir: PROJECT_DIR,
      projectUrl: detected.url,
      detectedFrom: detected.detectedFrom,
      registeredAt: new Date().toISOString(),
    });
    console.error(`[browser-feedback-mcp] Session: ${SESSION_ID}`);
  } else {
    await proxy.registerSession();
    console.error(`[browser-feedback-mcp] Session registered: ${SESSION_ID}`);
  }
}

main().catch((error) => {
  console.error("[browser-feedback-mcp] Fatal error:", error);
  process.exit(1);
});
