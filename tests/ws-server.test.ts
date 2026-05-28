import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import WebSocket from "ws";
import { createWsServer } from "../src/ws-server.ts";
import { sessionRegistry, setSessionPending, getSessionPending } from "../src/session-store.ts";
import type { FeedbackItem, PushResult } from "../src/server.ts";

let TEST_PORT = 19988;
const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface TrackedWs extends WebSocket {
  _msgQueue: Record<string, unknown>[];
  _msgWaiters: ((msg: Record<string, unknown>) => void)[];
}

function connectAndTrack(url: string): Promise<TrackedWs> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url) as TrackedWs;
    ws._msgQueue = [];
    ws._msgWaiters = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      const waiter = ws._msgWaiters.shift();
      if (waiter) waiter(msg);
      else ws._msgQueue.push(msg);
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: TrackedWs): Promise<Record<string, unknown>> {
  if (ws._msgQueue.length > 0) return Promise.resolve(ws._msgQueue.shift()!);
  return new Promise((resolve) => ws._msgWaiters.push(resolve));
}

async function nextMessageOfType(ws: TrackedWs, type: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 10; i++) {
    const msg = await nextMessage(ws);
    if (msg.type === type) return msg;
  }
  throw new Error(`Never received message of type: ${type}`);
}

describe("ws-server send_to_claude with pushFeedback", () => {
  let httpServer: http.Server;
  let wss: import("ws").WebSocketServer;
  let pushFeedback: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    TEST_PORT++;
    httpServer = http.createServer();
    pushFeedback = vi.fn();
    ({ wss } = createWsServer({
      httpServer,
      port: TEST_PORT,
      pushFeedback,
      broadcastPendingStatus: () => {},
    }));

    sessionRegistry.set(SESSION_ID, {
      sessionId: SESSION_ID,
      processId: "test-proc",
      projectDir: "/tmp/test",
      projectUrl: null,
      detectedFrom: null,
      registeredAt: new Date().toISOString(),
    });

    await new Promise<void>((resolve) => httpServer.listen(TEST_PORT, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    sessionRegistry.delete(SESSION_ID);
    setSessionPending(SESSION_ID, []);
    // Close all WS connections then the HTTP server
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("calls pushFeedback with the pending items when send_to_claude is received", async () => {
    pushFeedback.mockResolvedValueOnce({ ok: true } as PushResult);

    const item = { id: "fb-1", description: "test" } as unknown as FeedbackItem;
    setSessionPending(SESSION_ID, [item]);

    const ws = await connectAndTrack(`ws://127.0.0.1:${TEST_PORT}/ws?session=${SESSION_ID}`);
    try {
      ws.send(JSON.stringify({ type: "send_to_claude" }));
      const reply = await nextMessageOfType(ws, "sent_to_claude");

      expect(pushFeedback).toHaveBeenCalledWith([item], SESSION_ID);
      expect(reply.type).toBe("sent_to_claude");
      expect(reply.count).toBe(1);
    } finally {
      ws.close();
    }
  });

  it("clears pending queue after successful push", async () => {
    pushFeedback.mockResolvedValueOnce({ ok: true } as PushResult);

    const item = { id: "fb-2", description: "item" } as unknown as FeedbackItem;
    setSessionPending(SESSION_ID, [item]);

    const ws = await connectAndTrack(`ws://127.0.0.1:${TEST_PORT}/ws?session=${SESSION_ID}`);
    try {
      ws.send(JSON.stringify({ type: "send_to_claude" }));
      await nextMessageOfType(ws, "sent_to_claude");

      expect(getSessionPending(SESSION_ID)).toHaveLength(0);
    } finally {
      ws.close();
    }
  });

  it("sends push_failed and keeps pending queue when pushFeedback returns { ok: false }", async () => {
    pushFeedback.mockResolvedValueOnce({ ok: false, reason: "Claude disconnected" } as PushResult);

    const item = { id: "fb-3", description: "item" } as unknown as FeedbackItem;
    setSessionPending(SESSION_ID, [item]);

    const ws = await connectAndTrack(`ws://127.0.0.1:${TEST_PORT}/ws?session=${SESSION_ID}`);
    try {
      ws.send(JSON.stringify({ type: "send_to_claude" }));
      const reply = await nextMessageOfType(ws, "push_failed");

      expect(reply.type).toBe("push_failed");
      expect(reply.reason).toBe("Claude disconnected");
      // Pending queue must NOT be cleared
      expect(getSessionPending(SESSION_ID)).toHaveLength(1);
    } finally {
      ws.close();
    }
  });
});
