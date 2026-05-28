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

interface OrphanBucket {
  sessionId: string;
  pendingCount: number;
  readyCount: number;
  clientCount: number;
}

type FeedbackResolver = (items: unknown[]) => void;

export const sessionRegistry = new Map<string, SessionMeta>();

const pendingFeedbackBySession = new Map<string, unknown[]>();
const readyFeedbackBySession = new Map<string, unknown[]>();
const feedbackResolversBySession = new Map<string, FeedbackResolver[]>();
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
    ready: readyFeedbackBySession.get(sid) || [],
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

export function getSessionReady(sid: string): unknown[] {
  if (!readyFeedbackBySession.has(sid)) readyFeedbackBySession.set(sid, []);
  return readyFeedbackBySession.get(sid)!;
}

export function setSessionReady(sid: string, arr: unknown[]): void {
  readyFeedbackBySession.set(sid, arr);
  persistSession(sid);
}

export function getSessionResolvers(sid: string): FeedbackResolver[] {
  if (!feedbackResolversBySession.has(sid)) feedbackResolversBySession.set(sid, []);
  return feedbackResolversBySession.get(sid)!;
}

export function getSessionClients(sid: string): Set<WebSocket> {
  if (!connectedClientsBySession.has(sid)) connectedClientsBySession.set(sid, new Set());
  return connectedClientsBySession.get(sid)!;
}

export function findOrphanBuckets(): OrphanBucket[] {
  const orphans: OrphanBucket[] = [];
  const seen = new Set<string>();
  for (const [sid, items] of pendingFeedbackBySession) {
    if (!isValidSessionId(sid)) continue;
    if (sessionRegistry.has(sid)) continue;
    seen.add(sid);
    orphans.push({
      sessionId: sid,
      pendingCount: items.length,
      readyCount: (readyFeedbackBySession.get(sid) || []).length,
      clientCount: (connectedClientsBySession.get(sid) || new Set()).size,
    });
  }
  for (const [sid, items] of readyFeedbackBySession) {
    if (!isValidSessionId(sid)) continue;
    if (sessionRegistry.has(sid) || seen.has(sid)) continue;
    orphans.push({
      sessionId: sid,
      pendingCount: 0,
      readyCount: items.length,
      clientCount: (connectedClientsBySession.get(sid) || new Set()).size,
    });
  }
  return orphans.filter((o) => o.pendingCount > 0 || o.readyCount > 0);
}

export function migrateOrphanInto(targetSid: string, orphanSid: string): void {
  const oldPending = pendingFeedbackBySession.get(orphanSid) || [];
  const oldReady = readyFeedbackBySession.get(orphanSid) || [];
  if (oldPending.length) getSessionPending(targetSid).push(...oldPending);
  if (oldReady.length) getSessionReady(targetSid).push(...oldReady);
  pendingFeedbackBySession.delete(orphanSid);
  readyFeedbackBySession.delete(orphanSid);
  storage.remove(orphanSid);
  persistSession(targetSid);
}

export function deleteSession(sessionId: string): void {
  pendingFeedbackBySession.delete(sessionId);
  readyFeedbackBySession.delete(sessionId);
  feedbackResolversBySession.delete(sessionId);
  connectedClientsBySession.delete(sessionId);
}
