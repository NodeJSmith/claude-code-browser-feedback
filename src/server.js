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
import { createHttpServer } from "./http-server.js";
import { createWsServer } from "./ws-server.js";
import { registerMcpHandlers } from "./mcp-tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.FEEDBACK_PORT || "9877");
const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
).version;

// Session identity for this MCP server process
const PROJECT_DIR = process.cwd();
const SESSION_ID = deriveSessionId(PROJECT_DIR);
const PROCESS_ID = crypto.randomUUID();
const proxy = createProxyClient({ port: PORT, sessionId: SESSION_ID, processId: PROCESS_ID, projectDir: PROJECT_DIR });


const { httpServer } = createHttpServer({ port: PORT, pkgVersion: PKG_VERSION, srcDir: __dirname });

const { wss, broadcast } = createWsServer({ httpServer, port: PORT });

// ============================================
// MCP Server - interface for Claude Code
// ============================================

const mcpServer = new Server(
  {
    name: "browser-feedback-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

registerMcpHandlers({ mcpServer, port: PORT, sessionId: SESSION_ID, srcDir: __dirname, proxy, broadcast });


// ============================================
// Graceful shutdown handling
// ============================================

let isShuttingDown = false;

function shutdown(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.error(`[browser-feedback-mcp] Shutting down: ${reason}`);

  // Only close HTTP server if we own it
  if (isHttpServerOwner()) {
    // Flush any pending disk writes before exiting so debounced feedback
    // isn't lost on shutdown.
    try {
      storage.flushAll();
    } catch {
      /* ignore */
    }

    // Remove own session from registry only if we still own it
    const ownSession = sessionRegistry.get(SESSION_ID);
    if (ownSession && ownSession.processId === PROCESS_ID) {
      sessionRegistry.delete(SESSION_ID);
    }

    // Close all WebSocket connections
    for (const client of connectedClients) {
      try {
        client.close();
      } catch (err) {
        // Ignore errors during shutdown
      }
    }

    // Close the WebSocket server
    wss.close(() => {
      console.error("[browser-feedback-mcp] WebSocket server closed");
    });

    // Close the HTTP server
    httpServer.close(() => {
      console.error("[browser-feedback-mcp] HTTP server closed");
      process.exit(0);
    });

    // Force exit after timeout if graceful shutdown fails
    setTimeout(() => {
      console.error("[browser-feedback-mcp] Forcing exit after timeout");
      process.exit(0);
    }, 2000);
  } else {
    // Unregister from owner server before exit
    proxy.unregisterSession().finally(() => {
      process.exit(0);
    });
    // Force exit after timeout
    setTimeout(() => process.exit(0), 2000);
  }
}

// Listen for stdin close (MCP client disconnected)
process.stdin.on("end", () => shutdown("stdin ended"));
process.stdin.on("close", () => shutdown("stdin closed"));

// Handle signals
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ============================================
// Start servers
// ============================================

// Try to bind the HTTP server with health-check-and-retry for stale processes.
// When EADDRINUSE/EPERM occurs, we check if the existing server is healthy (GET /status).
// If healthy, we accept proxy mode. If not (zombie process), we wait and retry.
async function tryListenWithRetry(maxRetries = 3, retryDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          httpServer.removeListener("error", onError);
          reject(err);
        };
        httpServer.on("error", onError);
        httpServer.listen(PORT, () => {
          httpServer.removeListener("error", onError);
          resolve();
        });
      });
      // Successfully bound the port
      setHttpServerOwner(true);
      console.error(
        `[browser-feedback-mcp] HTTP/WebSocket server running on http://localhost:${PORT}`,
      );
      console.error(
        `[browser-feedback-mcp] Widget available at http://localhost:${PORT}/widget.js`,
      );
      return;
    } catch (err) {
      if (err.code !== "EADDRINUSE" && err.code !== "EPERM") {
        console.error(`[browser-feedback-mcp] HTTP server error:`, err);
        return; // Non-retryable error, fall back to proxy mode
      }

      // Port in use — check if the existing server is actually healthy
      const status = await proxy.fetchServerStatus();
      if (status) {
        console.error(`[browser-feedback-mcp] Port ${PORT} is in use by a healthy server.`);
        console.error(
          `[browser-feedback-mcp] MCP tools will proxy requests to the running server.`,
        );
        return; // Healthy server exists, use proxy mode
      }

      // Server on the port is unresponsive (zombie/stale process)
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

async function main() {
  // Start MCP server first (this is the critical part for Claude Code)
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[browser-feedback-mcp] MCP server connected via stdio");

  // Start HTTP/WebSocket server (may fail if port is in use, but MCP will still work)
  await tryListenWithRetry();

  // Register this session
  const detected = detectProjectUrl(PROJECT_DIR);
  if (isHttpServerOwner()) {
    // Rehydrate any persisted feedback queues from disk so feedback submitted
    // before a crash/restart isn't lost (fix for #46).
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
      console.error(`[browser-feedback-mcp] Rehydrate failed: ${err.message}`);
    }
    // Owner registers directly
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
    // Proxy registers via HTTP
    await proxy.registerSession();
    console.error(`[browser-feedback-mcp] Session registered: ${SESSION_ID}`);
  }
}

main().catch((error) => {
  console.error("[browser-feedback-mcp] Fatal error:", error);
  process.exit(1);
});
