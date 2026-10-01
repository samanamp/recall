import { describe, expect, it } from "vitest";
import { call, makeEnv, sampleReviews } from "./helpers";

type SyncBody = {
  unchanged?: true;
  cursor: string;
  files?: unknown[];
  filesUnchanged?: true;
  state: { card_id: string; updated_at: number }[];
  stateIsDelta?: true;
  deletedState?: string[];
};

const sync = async (env: Parameters<typeof call>[0], body: object) =>
  (await (await call(env, "POST", "/sync", body)).json()) as SyncBody;

describe("delta /sync", () => {
  it("older clients (no delta flag) still get files and the whole table", async () => {
    const { env } = makeEnv();
    await sync(env, { reviews: sampleReviews(3) });
    const body = await sync(env, { reviews: [] });
    expect(body.files).toEqual([]);
    expect(body.state).toHaveLength(3);
    expect(body.stateIsDelta).toBeUndefined();
    expect(body.filesUnchanged).toBeUndefined();
  });

  it("a delta client gets only rows changed after its watermark, and no files when the manifest is unchanged", async () => {
    const { env, d1 } = makeEnv();
    const first = await sync(env, { reviews: sampleReviews(3), delta: true });
    expect(first.state).toHaveLength(3); // no watermark yet: full table
    expect(first.stateIsDelta).toBeUndefined();
    const watermark = Math.max(...first.state.map((r) => r.updated_at));
    // Age the existing rows well past the watermark and the server's skew
    // overlap, so only new writes count as changed.
    d1.sqlite.prepare("UPDATE card_state SET updated_at = updated_at - 120000").run();

    const more = sampleReviews(1, "other");
    const body = await sync(env, { reviews: more, cursor: first.cursor, delta: true, stateSince: watermark - 60000 });
    expect(body.filesUnchanged).toBe(true);
    expect(body.files).toBeUndefined();
    expect(body.stateIsDelta).toBe(true);
    expect(body.state.map((r) => r.card_id)).toEqual(["other-000"]);
    expect(body.deletedState).toEqual([]);
  });

  it("reports a card whose only review was undone as deleted", async () => {
    const { env, d1 } = makeEnv();
    const review = { id: "r1", cardId: "solo", rating: 3, reviewedAt: Date.now(), deviceId: "d" };
    const first = await sync(env, { reviews: [review], delta: true });
    const since = Math.max(...first.state.map((r) => r.updated_at)) - 60000;
    d1.sqlite.prepare("UPDATE card_state SET updated_at = updated_at - 60000").run();

    await call(env, "DELETE", "/reviews", { id: "r1" });
    const body = await sync(env, { reviews: [], cursor: "stale", delta: true, stateSince: since });
    expect(body.stateIsDelta).toBe(true);
    expect(body.state).toEqual([]);
    expect(body.deletedState).toEqual(["solo"]);
  });

  it("a re-reviewed card clears its tombstone", async () => {
    const { env, d1 } = makeEnv();
    const review = { id: "r1", cardId: "solo", rating: 3, reviewedAt: Date.now(), deviceId: "d" };
    await sync(env, { reviews: [review], delta: true });
    await call(env, "DELETE", "/reviews", { id: "r1" });
    await sync(env, { reviews: [{ ...review, id: "r2" }], delta: true });
    expect(d1.sqlite.prepare("SELECT card_id FROM card_state_tombstones").all()).toEqual([]);
  });

  it("sends files again when the manifest version moved past the client's cursor", async () => {
    const { env, d1 } = makeEnv();
    const first = await sync(env, { reviews: [], delta: true });
    d1.sqlite.prepare("UPDATE manifest_cache SET version = version + 1").run();
    const body = await sync(env, { reviews: [], cursor: first.cursor, delta: true, stateSince: 0 });
    expect(body.files).toEqual([]);
    expect(body.filesUnchanged).toBeUndefined();
  });
});
