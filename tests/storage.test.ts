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

  it("returns empty arrays for an unknown session", () => {
    const data = storage.load(sid);
    expect(data).toEqual({ pending: [], ready: [] });
  });

  it("persists pending and ready arrays across load", async () => {
    storage.save(sid, {
      pending: [{ id: "p1", description: "first" }],
      ready: [{ id: "r1", description: "ready item" }],
    });
    await flushDelay();
    const loaded = storage.load(sid);
    expect(loaded.pending).toEqual([{ id: "p1", description: "first" }]);
    expect(loaded.ready).toEqual([{ id: "r1", description: "ready item" }]);
  });

  it("coalesces rapid saves via debounce", async () => {
    storage.save(sid, { pending: [{ id: "a" }], ready: [] });
    storage.save(sid, { pending: [{ id: "a" }, { id: "b" }], ready: [] });
    storage.save(sid, { pending: [{ id: "a" }, { id: "b" }, { id: "c" }], ready: [] });
    await flushDelay();
    const loaded = storage.load(sid);
    expect(loaded.pending.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("flush forces an immediate write", () => {
    storage.save(sid, { pending: [{ id: "sync" }], ready: [] });
    storage.flush(sid);
    const loaded = storage.load(sid);
    expect(loaded.pending).toEqual([{ id: "sync" }]);
  });

  it("remove deletes the file", async () => {
    storage.save(sid, { pending: [{ id: "x" }], ready: [] });
    await flushDelay();
    storage.remove(sid);
    const loaded = storage.load(sid);
    expect(loaded).toEqual({ pending: [], ready: [] });
  });

  it("listSessions enumerates persisted sessions", async () => {
    const sidA = makeSessionId("a");
    const sidB = makeSessionId("b");
    try {
      storage.save(sidA, { pending: [{ id: "pa" }], ready: [] });
      storage.save(sidB, { pending: [], ready: [{ id: "rb" }] });
      await flushDelay();
      const list = storage.listSessions();
      expect(list).toEqual(expect.arrayContaining([sidA, sidB]));
    } finally {
      storage.remove(sidA);
      storage.remove(sidB);
    }
  });

  it("rejects writes for malformed session IDs", () => {
    storage.save("not-a-uuid", { pending: [{ id: "x" }], ready: [] });
    storage.flush("not-a-uuid");
    expect(fs.existsSync(path.join(storage.getStorageDir(), "not-a-uuid.json"))).toBe(false);
  });
});
