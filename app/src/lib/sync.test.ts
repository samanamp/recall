import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeServer } from "./fake-server";

// sync.ts / actions.ts import `api` from here; tests swap in a FakeServer.
const mockApi = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: mockApi,
}));

import { ApiError } from "./api";
import { recordReview, saveCard, setDeckArchived, undoReview } from "./actions";
import { serializeCardFile } from "./cardfile";
import { db, kvGet, kvSet } from "./db";
import { syncAll } from "./sync";

let server: FakeServer;
let fake: ReturnType<FakeServer["api"]>;

const ID_X = "01JXK4M9V7T2C8R0EXAMPLEXXX";
const ID_Y = "01JXK4M9V7T2C8R0EXAMPLEYYY";
const file = (id: string, front: string) =>
  serializeCardFile({ id, created: "2026-01-01", front, back: "back" });

function review(id: string, cardId: string) {
  return { id, cardId, rating: 3, reviewedAt: 1, deviceId: "other" };
}

beforeEach(async () => {
  // Only timers are faked: requestSync()'s debounce must not fire a stray
  // sync mid-test. IndexedDB (fake-indexeddb) schedules via setImmediate.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await Promise.all(db.tables.map((t) => t.clear()));
  await kvSet("appToken", "t");
  await kvSet("welcomeSeeded", true);
  server = new FakeServer();
  fake = server.api();
  Object.assign(mockApi, fake);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Run sync with the real server behaviour but a hook before the request. */
function before<K extends keyof typeof fake>(name: K, hook: () => Promise<unknown>): void {
  const real = fake[name].getMockImplementation()! as (...a: unknown[]) => Promise<unknown>;
  (fake[name] as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
    async (...args: unknown[]) => {
      await hook();
      return real(...args);
    }
  );
}

describe("pull", () => {
  it("a card moved on another device is moved here, not deleted (state kept)", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "q"));
    server.reviews.set("r1", review("r1", ID_X));
    expect((await syncAll()).ok).toBe(true);
    expect(await db.state.get(ID_X)).toBeDefined();

    server.remove(`decks/a/${ID_X}.md`);
    server.write(`decks/b/${ID_X}.md`, file(ID_X, "q"));
    const r = await syncAll();

    expect(r.ok).toBe(true);
    expect(await db.cards.get(ID_X)).toMatchObject({ path: `decks/b/${ID_X}.md`, deck: "b" });
    expect(await db.state.get(ID_X)).toBeDefined();
    expect(await kvGet("syncCursor")).toBe(server.cursor());
  });

  it("a card deleted remotely goes only after two consecutive full pulls", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    server.write(`decks/a/${ID_Y}.md`, file(ID_Y, "y"));
    server.reviews.set("r1", review("r1", ID_X));
    await syncAll();

    server.remove(`decks/a/${ID_X}.md`);
    await syncAll();
    expect(await db.cards.get(ID_X)).toBeDefined(); // first strike
    // Cursor withheld so the next heartbeat pulls in full and re-checks.
    expect(await kvGet("syncCursor")).toBeUndefined();

    await syncAll();
    expect(await db.cards.get(ID_X)).toBeUndefined();
    expect(await db.cards.get(ID_Y)).toBeDefined();
  });

  it("a card back in the manifest after one miss survives", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    await syncAll();
    const saved = server.files.get(`decks/a/${ID_X}.md`)!;
    server.remove(`decks/a/${ID_X}.md`);
    await syncAll();
    server.files.set(`decks/a/${ID_X}.md`, saved);
    server.seq++;
    await syncAll();
    server.seq++;
    await syncAll();
    expect(await db.cards.get(ID_X)).toBeDefined();
  });

  it("an empty manifest never mass-deletes local cards", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    await syncAll();
    server.files.clear();
    server.seq++;

    for (let i = 0; i < 3; i++) {
      const r = await syncAll();
      expect(r.partial).toBe(true);
      expect(r.failures).toEqual([
        { path: "decks/", message: "remote repository returned no cards; skipping deletions" },
      ]);
    }
    expect(await db.cards.get(ID_X)).toBeDefined();
    expect(await db.decks.get("a")).toBeDefined();
  });

  it("a failure after a partial batch doesn't advance the cursor; the next sync completes", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    await syncAll();
    const ids = Array.from({ length: 50 }, (_, i) => `01JXK4M9V7T2C8R0EXAMPLE${String(i).padStart(3, "0")}`);
    for (const id of ids) server.write(`decks/a/${id}.md`, file(id, id));

    const realBatch = fake.batchFiles.getMockImplementation()!;
    fake.batchFiles.mockImplementationOnce(realBatch).mockRejectedValueOnce(new Error("network down"));
    const r = await syncAll();
    expect(r.ok).toBe(false);
    expect(await db.cards.count()).toBe(41); // the first batch of 40 landed
    expect(await kvGet("syncCursor")).toBeUndefined();

    const r2 = await syncAll();
    expect(r2.ok).toBe(true);
    expect(await db.cards.count()).toBe(51);
    expect(await kvGet("syncCursor")).toBe(server.cursor());
  });

  it("re-fetches everything when the local cards table is empty, despite a cursor", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    await syncAll();
    await db.cards.clear();
    await syncAll();
    expect(await db.cards.get(ID_X)).toBeDefined();
  });

  it("a local save during the pull beats the incoming remote version", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "v1"));
    await syncAll();
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "remote v2"));

    before("batchFiles", () => saveCard({ id: ID_X, deck: "a", front: "local v3", back: "b" }));
    await syncAll();
    expect((await db.cards.get(ID_X))!.front).toBe("local v3");
    expect(await db.pendingFiles.get(`decks/a/${ID_X}.md`)).toBeDefined();
  });

  it("duplicate frontmatter ids: the copy gets a fresh id, queued back to the repo", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "original"));
    server.write(`decks/b/copy.md`, file(ID_X, "copy"));
    await syncAll();

    expect(await db.cards.count()).toBe(2);
    expect(await db.cards.get(ID_X)).toMatchObject({ path: `decks/a/${ID_X}.md` });
    const copy = await db.cards.where("path").equals("decks/b/copy.md").first();
    expect(copy!.id).not.toBe(ID_X);
    const queued = await db.pendingFiles.get("decks/b/copy.md");
    expect(queued?.content).toContain(`id: ${copy!.id}`);
  });
});

describe("archived decks", () => {
  it("archiving pushes a marker file; unarchiving removes it", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    await syncAll();

    await setDeckArchived("a", true);
    expect((await syncAll()).ok).toBe(true);
    expect(server.files.has("decks/a/.archived")).toBe(true);
    expect(await db.decks.get("a")).toMatchObject({ archived: true });

    await setDeckArchived("a", false);
    expect((await syncAll()).ok).toBe(true);
    expect(server.files.has("decks/a/.archived")).toBe(false);
    expect((await db.decks.get("a"))?.archived).toBeFalsy();
    expect(await db.cards.get(ID_X)).toBeDefined();
  });

  it("a deck archived on another device is archived here, and back again", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    await syncAll();

    server.write("decks/a/.archived", "");
    await syncAll();
    expect(await db.decks.get("a")).toMatchObject({ archived: true });

    server.remove("decks/a/.archived");
    await syncAll();
    expect((await db.decks.get("a"))?.archived).toBeFalsy();
  });

  it("a cursor saved by a build that ignored markers doesn't hide them from this one", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    server.write("decks/a/.archived", "");
    await syncAll();
    // What an older build left behind: the cursor is current, the flag unset.
    await db.decks.put({ name: "a" });
    await db.kv.delete("mirrorVersion");

    await syncAll();
    expect(await db.decks.get("a")).toMatchObject({ archived: true });
    expect(await kvGet("syncCursor")).toBe(server.cursor());
  });

  it("saving a card into an archived deck leaves it archived", async () => {
    await setDeckArchived("a", true);
    await saveCard({ deck: "a", front: "q", back: "a" });
    expect(await db.decks.get("a")).toMatchObject({ archived: true });
  });

  it("the all-decks queue skips archived decks; asking by name still works", async () => {
    await saveCard({ deck: "a", front: "q", back: "a" });
    await saveCard({ deck: "b", front: "q", back: "a" });
    await setDeckArchived("a", true);
    const { buildQueue } = await import("./scheduler");
    const all = await buildQueue(null, new Date());
    expect(await db.cards.bulkGet(all)).toMatchObject([{ deck: "b" }]);
    expect(await buildQueue("a", new Date())).toHaveLength(1);
  });
});

describe("push", () => {
  it("an edit saved during its own push is kept and rebased onto the new sha", async () => {
    const card = await saveCard({ deck: "a", front: "first", back: "b" });
    before("putFile", () => saveCard({ id: card.id, deck: "a", front: "second", back: "b" }));
    const r = await syncAll();
    expect(r.partial).toBe(false);

    const firstSha = server.files.get(card.path)!.sha;
    expect(server.files.get(card.path)!.content).toContain("first");
    const queued = await db.pendingFiles.get(card.path);
    expect(queued?.content).toContain("second");
    expect(queued?.baseSha).toBe(firstSha);
    expect((await db.cards.get(card.id))!.sha).toBe(firstSha);

    await syncAll();
    expect(server.files.get(card.path)!.content).toContain("second");
    expect(await db.pendingFiles.count()).toBe(0);
    expect(fake.getFile).not.toHaveBeenCalled(); // no 409 retry needed
  });

  it("a card created then deleted during its first push is deleted from the repo too", async () => {
    const card = await saveCard({ deck: "a", front: "oops", back: "b" });
    before("putFile", async () => {
      const { deleteCard } = await import("./actions");
      await deleteCard(card.id);
    });
    await syncAll();
    await syncAll();
    expect(server.files.has(card.path)).toBe(false);
    expect(await db.cards.get(card.id)).toBeUndefined();
  });

  it("push failures surface as a partial result with per-path errors", async () => {
    const card = await saveCard({ deck: "a", front: "q", back: "b" });
    fake.putFile.mockRejectedValueOnce(new ApiError(500, "500: boom"));
    const r = await syncAll();
    expect(r.ok).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.failures).toEqual([{ path: card.path, message: "push failed — 500: boom" }]);
    expect(await db.pendingFiles.get(card.path)).toBeDefined();
  });

  it("media 409 (already in the repo) counts as uploaded; sha comes from the manifest", async () => {
    const path = "media/abc123.webp";
    const sha = server.write(path, "AAAA");
    await db.media.put({ path, sha: "", blob: new Blob(["x"]) });
    await db.pendingFiles.put({ path, op: "put", contentBase64: "AAAA", queuedAt: 1 });

    const r = await syncAll();
    expect(r.partial).toBe(false);
    expect(await db.pendingFiles.count()).toBe(0);
    expect((await db.media.get(path))!.sha).toBe(sha);
    expect(fake.getMediaBlob).not.toHaveBeenCalled();
  });

  it("an edit to a card deleted remotely is recreated (404 → last write wins)", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "v1"));
    await syncAll();
    await saveCard({ id: ID_X, deck: "a", front: "edited", back: "b" });
    fake.putFile.mockRejectedValueOnce(new ApiError(404, "404: not found"));
    server.files.delete(`decks/a/${ID_X}.md`);
    const r = await syncAll();
    expect(r.partial).toBe(false);
    expect(server.files.get(`decks/a/${ID_X}.md`)!.content).toContain("edited");
  });
});

describe("reviews", () => {
  it("undo during an in-flight push is queued, then deleted on the server", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "q"));
    await syncAll();
    const undo = await recordReview(ID_X, 3);

    let status: string | undefined;
    before("sync", async () => {
      status = (await undoReview(undo)).status;
    });
    await syncAll();

    expect(status).toBe("queued");
    expect(server.reviews.has(undo.reviewId)).toBe(true); // the request carried it
    expect(await db.pendingUndos.count()).toBe(1);
    // The response's state includes the review; the restored (new) state wins.
    expect(await db.state.get(ID_X)).toBeUndefined();

    await syncAll();
    expect(server.reviews.has(undo.reviewId)).toBe(false);
    expect(await db.pendingUndos.count()).toBe(0);
    expect(await db.state.get(ID_X)).toBeUndefined();
  });

  it("undo of a pushed review works offline and is sent on the next sync", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "q"));
    await syncAll();
    const undo = await recordReview(ID_X, 3);
    await syncAll();
    expect(server.reviews.has(undo.reviewId)).toBe(true);

    fake.deleteReview.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const res = await undoReview(undo);
    expect(res.status).toBe("queued");
    expect(await db.state.get(ID_X)).toBeUndefined();

    await syncAll();
    expect(server.reviews.has(undo.reviewId)).toBe(false);
    expect(await db.pendingUndos.count()).toBe(0);
  });

  it("undo of a pushed review online deletes it right away", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "q"));
    await syncAll();
    const undo = await recordReview(ID_X, 3);
    await syncAll();
    expect(await undoReview(undo)).toEqual({ status: "server" });
    expect(server.reviews.has(undo.reviewId)).toBe(false);
  });

  it("undo of a review that never left the device is local", async () => {
    const undo = await recordReview(ID_X, 3);
    expect(await undoReview(undo)).toEqual({ status: "local" });
    expect(await db.pendingReviews.count()).toBe(0);
    expect(await db.pendingUndos.count()).toBe(0);
  });

  it("drains more than 500 queued reviews in one sync", async () => {
    await db.pendingReviews.bulkPut(
      Array.from({ length: 1200 }, (_, i) => review(`r${String(i).padStart(5, "0")}`, ID_X))
    );
    const r = await syncAll();
    expect(r.pushedReviews).toBe(1200);
    expect(fake.postReviews).toHaveBeenCalledTimes(2);
    expect(server.reviews.size).toBe(1200);
    expect(await db.pendingReviews.count()).toBe(0);
  });
});

describe("applyState", () => {
  it("drops state rows the server no longer has, except cards with unpushed reviews", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    server.write(`decks/a/${ID_Y}.md`, file(ID_Y, "y"));
    server.reviews.set("rx", review("rx", ID_X));
    server.reviews.set("ry", review("ry", ID_Y));
    await syncAll();
    expect(await db.state.count()).toBe(2);

    // Another device undid both reviews; meanwhile Y is rated here mid-sync.
    server.reviews.clear();
    server.seq++;
    before("sync", () => recordReview(ID_Y, 3));
    expect((await syncAll()).ok).toBe(true);

    expect(await db.state.get(ID_X)).toBeUndefined();
    expect(await db.state.get(ID_Y)).toBeDefined();
  });

  it("a delta state response never deletes rows it doesn't name", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    server.reviews.set("rx", review("rx", ID_X));
    await syncAll();
    server.reviews.clear();
    server.seq++;
    const real = fake.sync.getMockImplementation()!;
    fake.sync.mockImplementationOnce(async (...a) => ({ ...(await real(...a)), stateIsDelta: true }));
    await syncAll();
    expect(await db.state.get(ID_X)).toBeDefined();
  });
});

describe("delta sync", () => {
  it("saves the state watermark with the cursor and sends it next time", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    const real = fake.sync.getMockImplementation()!;
    fake.sync.mockImplementationOnce(async (...a) => {
      const resp = await real(...a);
      return { ...resp, state: [{ card_id: ID_X, due: 1, state: 2, fsrs_json: "{}", updated_at: 5000 }] };
    });
    await syncAll();
    expect(await kvGet("stateWatermark")).toBe(5000);
    server.seq++; // force a non-"unchanged" round trip
    await syncAll();
    expect(fake.sync.mock.calls.at(-1)?.[2]).toBe(5000);
  });

  it("applies tombstones from a delta and leaves cards it doesn't name", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    server.write(`decks/a/${ID_Y}.md`, file(ID_Y, "y"));
    server.reviews.set("rx", review("rx", ID_X));
    server.reviews.set("ry", review("ry", ID_Y));
    await syncAll();
    server.seq++;
    fake.sync.mockImplementationOnce(async () => ({
      cursor: server.cursor(), reviewCount: 2, accepted: 0, filesUnchanged: true as const,
      state: [], stateIsDelta: true as const, deletedState: [ID_X],
      params: { retention: 0.9, weights: null },
    }));
    await syncAll();
    expect(await db.state.get(ID_X)).toBeUndefined();
    expect(await db.state.get(ID_Y)).toBeDefined();
  });

  it("filesUnchanged skips the file pull entirely", async () => {
    server.write(`decks/a/${ID_X}.md`, file(ID_X, "x"));
    await syncAll();
    server.seq++;
    fake.sync.mockImplementationOnce(async () => ({
      cursor: server.cursor(), reviewCount: 0, accepted: 0, filesUnchanged: true as const,
      state: [], stateIsDelta: true as const, deletedState: [],
      params: { retention: 0.9, weights: null },
    }));
    const batches = fake.batchFiles.mock.calls.length;
    expect((await syncAll()).ok).toBe(true);
    expect(fake.batchFiles.mock.calls.length).toBe(batches);
    expect(await db.cards.get(ID_X)).toBeDefined();
    expect(await kvGet("syncCursor")).toBe(server.cursor());
  });
});

describe("run control", () => {
  it("a sync requested mid-sync runs again afterwards instead of being dropped", async () => {
    let second: Promise<unknown> | undefined;
    before("sync", async () => {
      second = syncAll();
    });
    await syncAll();
    await second;
    expect(fake.sync).toHaveBeenCalledTimes(2);
  });
});
