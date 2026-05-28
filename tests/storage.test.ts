import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import * as storage from "../src/storage.ts";
import { deriveSessionId } from "../src/utils.ts";

function makeSessionId(seed: string): string {
  return deriveSessionId(`/tmp/storage-test-${seed}-${Date.now()}-${Math.random()}`);
}

// Storage writes are debounced (50ms). Tests need to wait past that window
// before checking disk.
function flushDelay() {
  return new Promise((r) => setTimeout(r, 80));
}

describe("storage", () => {
  // Each test uses a unique session ID so they don't collide on the shared
  // tmpdir directory.
  let sid: string;

  beforeEach(() => {
    sid = makeSessionId("case");
  });

  afterEach(() => {
    storage.remove(sid);
  });

  it("returns empty object for an unknown session", () => {
    const data = storage.load(sid);
    expect(data).toEqual({ pending: [] });
  });

  it("persists pending array across load", async () => {
    storage.save(sid, {
      pending: [{ id: "p1", description: "first" }],
    });
    await flushDelay();
    const loaded = storage.load(sid);
    expect(loaded.pending).toEqual([{ id: "p1", description: "first" }]);
  });

  it("coalesces rapid saves via debounce", async () => {
    storage.save(sid, { pending: [{ id: "a" }] });
    storage.save(sid, { pending: [{ id: "a" }, { id: "b" }] });
    storage.save(sid, { pending: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    await flushDelay();
    const loaded = storage.load(sid);
    expect(loaded.pending.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("flush forces an immediate write", () => {
    storage.save(sid, { pending: [{ id: "sync" }] });
    storage.flush(sid);
    const loaded = storage.load(sid);
    expect(loaded.pending).toEqual([{ id: "sync" }]);
  });

  it("remove deletes the file", async () => {
    storage.save(sid, { pending: [{ id: "x" }] });
    await flushDelay();
    storage.remove(sid);
    const loaded = storage.load(sid);
    expect(loaded).toEqual({ pending: [] });
  });

  it("listSessions enumerates persisted sessions", async () => {
    const sidA = makeSessionId("a");
    const sidB = makeSessionId("b");
    try {
      storage.save(sidA, { pending: [{ id: "pa" }] });
      storage.save(sidB, { pending: [{ id: "pb" }] });
      await flushDelay();
      const list = storage.listSessions();
      expect(list).toEqual(expect.arrayContaining([sidA, sidB]));
    } finally {
      storage.remove(sidA);
      storage.remove(sidB);
    }
  });

  it("rejects writes for malformed session IDs", () => {
    storage.save("not-a-uuid", { pending: [{ id: "x" }] });
    storage.flush("not-a-uuid");
    expect(fs.existsSync(path.join(storage.getStorageDir(), "not-a-uuid.json"))).toBe(false);
  });

  it("ignores legacy ready field when loading old files", async () => {
    // Write a legacy file with a ready field directly to disk
    const storageDir = storage.getStorageDir();
    fs.mkdirSync(storageDir, { recursive: true });
    const legacyFile = path.join(storageDir, `${sid}.json`);
    fs.writeFileSync(
      legacyFile,
      JSON.stringify({
        pending: [{ id: "p1" }],
        ready: [{ id: "r1" }],
        updatedAt: new Date().toISOString(),
      }),
      { encoding: "utf8" },
    );
    const loaded = storage.load(sid);
    expect(loaded.pending).toEqual([{ id: "p1" }]);
    expect((loaded as Record<string, unknown>).ready).toBeUndefined();
  });
});
