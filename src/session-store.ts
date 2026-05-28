import type { WebSocket } from "ws";
import { isValidSessionId } from "./utils.ts";
import * as storage from "./storage.ts";

interface SessionMeta {
  sessionId: string;
  processId: string | null;
  projectDir: string;
  projectUrl: string | null;
  detectedFrom: string | null;
  registeredAt: string;
}

export const sessionRegistry = new Map<string, SessionMeta>();

const pendingFeedbackBySession = new Map<string, unknown[]>();
const connectedClientsBySession = new Map<string, Set<WebSocket>>();
export let connectedClients = new Set<WebSocket>();
let _isHttpServerOwner = false;

export function isHttpServerOwner(): boolean {
  return _isHttpServerOwner;
}

export function setHttpServerOwner(value: boolean): void {
  _isHttpServerOwner = value;
}

export function persistSession(sid: string): void {
  if (!_isHttpServerOwner || !isValidSessionId(sid)) return;
  storage.save(sid, {
    pending: pendingFeedbackBySession.get(sid) || [],
  });
}

export function getSessionPending(sid: string): unknown[] {
  if (!pendingFeedbackBySession.has(sid)) pendingFeedbackBySession.set(sid, []);
  return pendingFeedbackBySession.get(sid)!;
}

export function setSessionPending(sid: string, arr: unknown[]): void {
  pendingFeedbackBySession.set(sid, arr);
  persistSession(sid);
}

export function getSessionClients(sid: string): Set<WebSocket> {
  if (!connectedClientsBySession.has(sid)) connectedClientsBySession.set(sid, new Set());
  return connectedClientsBySession.get(sid)!;
}

export function deleteSession(sessionId: string): void {
  pendingFeedbackBySession.delete(sessionId);
  connectedClientsBySession.delete(sessionId);
}
