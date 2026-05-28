import { isValidSessionId } from "./utils.ts";
import * as storage from "./storage.ts";

// Session registry (owner server only): sessionId -> metadata
export const sessionRegistry = new Map();

// Session-partitioned feedback storage
const pendingFeedbackBySession = new Map();
const readyFeedbackBySession = new Map();
const feedbackResolversBySession = new Map();
const connectedClientsBySession = new Map();
export let connectedClients = new Set();
let _isHttpServerOwner = false;

export function isHttpServerOwner() {
  return _isHttpServerOwner;
}

export function setHttpServerOwner(value) {
  _isHttpServerOwner = value;
}

export function persistSession(sid) {
  if (!_isHttpServerOwner || !isValidSessionId(sid)) return;
  storage.save(sid, {
    pending: pendingFeedbackBySession.get(sid) || [],
    ready: readyFeedbackBySession.get(sid) || [],
  });
}

export function getSessionPending(sid) {
  if (!pendingFeedbackBySession.has(sid)) pendingFeedbackBySession.set(sid, []);
  return pendingFeedbackBySession.get(sid);
}

export function setSessionPending(sid, arr) {
  pendingFeedbackBySession.set(sid, arr);
  persistSession(sid);
}

export function getSessionReady(sid) {
  if (!readyFeedbackBySession.has(sid)) readyFeedbackBySession.set(sid, []);
  return readyFeedbackBySession.get(sid);
}

export function setSessionReady(sid, arr) {
  readyFeedbackBySession.set(sid, arr);
  persistSession(sid);
}

export function getSessionResolvers(sid) {
  if (!feedbackResolversBySession.has(sid)) feedbackResolversBySession.set(sid, []);
  return feedbackResolversBySession.get(sid);
}

export function getSessionClients(sid) {
  if (!connectedClientsBySession.has(sid)) connectedClientsBySession.set(sid, new Set());
  return connectedClientsBySession.get(sid);
}

export function findOrphanBuckets() {
  const orphans = [];
  const seen = new Set();
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

export function migrateOrphanInto(targetSid, orphanSid) {
  const oldPending = pendingFeedbackBySession.get(orphanSid) || [];
  const oldReady = readyFeedbackBySession.get(orphanSid) || [];
  if (oldPending.length) getSessionPending(targetSid).push(...oldPending);
  if (oldReady.length) getSessionReady(targetSid).push(...oldReady);
  pendingFeedbackBySession.delete(orphanSid);
  readyFeedbackBySession.delete(orphanSid);
  storage.remove(orphanSid);
  persistSession(targetSid);
}

export function deleteSession(sessionId) {
  pendingFeedbackBySession.delete(sessionId);
  readyFeedbackBySession.delete(sessionId);
  feedbackResolversBySession.delete(sessionId);
  connectedClientsBySession.delete(sessionId);
}
