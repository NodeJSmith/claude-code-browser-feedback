import fs from "fs";
import path from "path";
import os from "os";
import { isValidSessionId } from "./utils.js";

// Disk location for per-session feedback queues. Tmp dir is deliberate:
// it survives the server process (so crashes/restarts don't lose data)
// but doesn't pollute the user's home or the project tree.
const ROOT = path.join(os.tmpdir(), "claude-browser-feedback");

// `mode` only applies on first creation. If ROOT was created by an older
// version without the mode arg, the permissions stay whatever they were —
// usually fine because the OS clears tmp on reboot.
function ensureRoot() {
  try { fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
}

function fileFor(sessionId) {
  return path.join(ROOT, `${sessionId}.json`);
}

export function getStorageDir() {
  return ROOT;
}

// Synchronous load — small payloads, called rarely (boot + first access).
export function load(sessionId) {
  if (!isValidSessionId(sessionId)) return { pending: [], ready: [] };
  try {
    const raw = fs.readFileSync(fileFor(sessionId), "utf8");
    const data = JSON.parse(raw);
    return {
      pending: Array.isArray(data.pending) ? data.pending : [],
      ready: Array.isArray(data.ready) ? data.ready : [],
    };
  } catch {
    return { pending: [], ready: [] };
  }
}

// Debounced write-through. Mutations on `pending` / `ready` are coalesced
// per session into a single atomic rename so we never tear a file mid-write.
const pendingWrites = new Map(); // sessionId -> { timer, state }
const WRITE_DELAY_MS = 50;

export function save(sessionId, state) {
  if (!isValidSessionId(sessionId)) return;
  const entry = pendingWrites.get(sessionId) || {};
  entry.state = {
    pending: Array.isArray(state.pending) ? state.pending : [],
    ready: Array.isArray(state.ready) ? state.ready : [],
    updatedAt: new Date().toISOString(),
  };
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flush(sessionId), WRITE_DELAY_MS);
  pendingWrites.set(sessionId, entry);
}

export function flush(sessionId) {
  const entry = pendingWrites.get(sessionId);
  if (!entry || !entry.state) return;
  pendingWrites.delete(sessionId);
  try {
    ensureRoot();
    const target = fileFor(sessionId);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry.state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error(`[browser-feedback-mcp] storage flush failed for ${sessionId}: ${err.message}`);
  }
}

export function flushAll() {
  for (const sid of Array.from(pendingWrites.keys())) flush(sid);
}

export function remove(sessionId) {
  if (!isValidSessionId(sessionId)) return;
  const entry = pendingWrites.get(sessionId);
  if (entry && entry.timer) clearTimeout(entry.timer);
  pendingWrites.delete(sessionId);
  try { fs.unlinkSync(fileFor(sessionId)); } catch { /* ignore */ }
}

// Enumerate persisted sessions on disk. Used to rehydrate on boot.
export function listSessions() {
  ensureRoot();
  let names;
  try { names = fs.readdirSync(ROOT); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const sid = name.slice(0, -5);
    if (isValidSessionId(sid)) out.push(sid);
  }
  return out;
}
