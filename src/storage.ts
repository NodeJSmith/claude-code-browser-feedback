import fs from "fs";
import path from "path";
import os from "os";
import { isValidSessionId } from "./utils.ts";

const ROOT = path.join(os.tmpdir(), "claude-browser-feedback");

function ensureRoot(): void {
  try {
    fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  } catch {
    /* ignore */
  }
}

function fileFor(sessionId: string): string {
  return path.join(ROOT, `${sessionId}.json`);
}

export function getStorageDir(): string {
  return ROOT;
}

interface StorageState {
  pending: unknown[];
}

export function load(sessionId: string): StorageState {
  if (!isValidSessionId(sessionId)) return { pending: [] };
  try {
    const raw = fs.readFileSync(fileFor(sessionId), "utf8");
    const data = JSON.parse(raw);
    return {
      pending: Array.isArray(data.pending) ? data.pending : [],
    };
  } catch {
    return { pending: [] };
  }
}

interface WriteEntry {
  timer?: ReturnType<typeof setTimeout>;
  state?: StorageState & { updatedAt: string };
}

const pendingWrites = new Map<string, WriteEntry>();
const WRITE_DELAY_MS = 50;

export function save(sessionId: string, state: StorageState): void {
  if (!isValidSessionId(sessionId)) return;
  const entry = pendingWrites.get(sessionId) || {};
  entry.state = {
    pending: Array.isArray(state.pending) ? state.pending : [],
    updatedAt: new Date().toISOString(),
  };
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flush(sessionId), WRITE_DELAY_MS);
  pendingWrites.set(sessionId, entry);
}

export function flush(sessionId: string): void {
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
    console.error(
      `[browser-feedback-mcp] storage flush failed for ${sessionId}: ${(err as Error).message}`,
    );
  }
}

export function flushAll(): void {
  for (const sid of Array.from(pendingWrites.keys())) flush(sid);
}

export function remove(sessionId: string): void {
  if (!isValidSessionId(sessionId)) return;
  const entry = pendingWrites.get(sessionId);
  if (entry && entry.timer) clearTimeout(entry.timer);
  pendingWrites.delete(sessionId);
  try {
    fs.unlinkSync(fileFor(sessionId));
  } catch {
    /* ignore */
  }
}

export function listSessions(): string[] {
  ensureRoot();
  let names: string[];
  try {
    names = fs.readdirSync(ROOT);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const sid = name.slice(0, -5);
    if (isValidSessionId(sid)) out.push(sid);
  }
  return out;
}
