import { describe, expect, it } from "vitest";
import { fsrs } from "ts-fsrs";
import { replayReviews } from "../src/replay";
import { ingestReviews, replayCards } from "../src/reviews";
import { parseReviews } from "../src/validate";
import { createFakeD1, type FakeD1 } from "./fakeD1";
import { call, makeEnv, sampleReviews, T0 } from "./helpers";

const scheduler = fsrs();

/** The pre-batching implementation: one SELECT + one UPSERT per card. */
async function legacyReplayCard(db: D1Database, cardId: string) {
  const { results } = await db
    .prepare("SELECT rating, reviewed_at FROM reviews WHERE card_id = ? ORDER BY reviewed_at, id")
    .bind(cardId)
    .all<{ rating: number; reviewed_at: number }>();
  const card = replayReviews(results, scheduler);
  if (!card) return;
  await db
    .prepare(
      `INSERT OR REPLACE INTO card_state (card_id, due, stability, difficulty, state, reps, lapses, fsrs_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(cardId, card.due.getTime(), card.stability, card.difficulty, card.state, card.reps, card.lapses, JSON.stringify(card))
    .run();
}

function states(d1: FakeD1) {
  return d1.sqlite
    .prepare(
      "SELECT card_id, due, stability, difficulty, state, reps, lapses, fsrs_json FROM card_state ORDER BY card_id"
    )
    .all()
    .map((r) => ({ ...r }));
}

describe("batched replay", () => {
  it("matches the old per-card replay exactly", async () => {
    const log = sampleReviews(150); // >100 cards: exercises the IN (...) chunking
    const legacy = createFakeD1();
    const batched = createFakeD1();
    const rows = parseReviews(log).valid;
    await ingestReviews(legacy.db, rows);
    const { touched } = await ingestReviews(batched.db, rows);

    for (const id of touched) await legacyReplayCard(legacy.db, id);
    await replayCards(batched.db, touched, scheduler);

    expect(touched).toHaveLength(150);
    expect(states(batched)).toEqual(states(legacy));
  });

  it("drops derived state for a card whose log is now empty", async () => {
    const d1 = createFakeD1();
    await ingestReviews(d1.db, parseReviews(sampleReviews(1)).valid);
    await replayCards(d1.db, ["card-000"], scheduler);
    d1.sqlite.exec("DELETE FROM reviews");
    await replayCards(d1.db, ["card-000"], scheduler);
    expect(states(d1)).toEqual([]);
  });
});

describe("ingestReviews", () => {
  it("bumps sync_stats by rows actually inserted, ignoring duplicates", async () => {
    const d1 = createFakeD1();
    const rows = parseReviews(sampleReviews(30)).valid; // 105 rows → 6 INSERT statements
    const first = await ingestReviews(d1.db, rows);
    expect(first.inserted).toBe(rows.length);
    const again = await ingestReviews(d1.db, [...rows.slice(0, 10), ...parseReviews(sampleReviews(1, "new")).valid]);
    expect(again.inserted).toBe(1);
    const stats = d1.sqlite.prepare("SELECT seq, review_count FROM sync_stats").get();
    expect({ ...stats }).toEqual({ seq: rows.length + 1, review_count: rows.length + 1 });
  });
});

describe("POST /sync query budget", () => {
  it("40 distinct cards stay well within D1's 50 queries per invocation", async () => {
    const { env, d1 } = makeEnv();
    const reviews = sampleReviews(40);
    d1.resetCount();
    const res = await call(env, "POST", "/sync", { reviews });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number; state: unknown[]; reviewCount: number };
    expect(body.accepted).toBe(reviews.length);
    expect(body.state).toHaveLength(40);
    expect(body.reviewCount).toBe(reviews.length);
    expect(d1.queries()).toBeLessThanOrEqual(50);
    expect(d1.queries()).toBeLessThanOrEqual(10); // fixed cost (8 today), not per card
  });

  it("even a full 500-review push touching 500 cards stays within budget", async () => {
    const { env, d1 } = makeEnv();
    const reviews = Array.from({ length: 500 }, (_, i) => ({
      id: `r${i}`,
      cardId: `c${i}`,
      rating: 3,
      reviewedAt: T0 + i,
      deviceId: "d",
    }));
    d1.resetCount();
    const res = await call(env, "POST", "/reviews", reviews);
    expect(res.status).toBe(200);
    expect(d1.queries()).toBeLessThanOrEqual(50);
  });
});

describe("payload validation", () => {
  const good = { id: "r1", cardId: "c1", rating: 3, reviewedAt: T0, deviceId: "d" };

  it("parseReviews drops malformed rows and keeps the rest", () => {
    const bad = [
      { ...good, id: "" },
      { ...good, id: undefined },
      { ...good, cardId: 42 },
      { ...good, rating: 0 },
      { ...good, rating: 5 },
      { ...good, rating: 2.5 },
      { ...good, rating: "3" },
      { ...good, reviewedAt: NaN },
      { ...good, reviewedAt: Infinity },
      { ...good, reviewedAt: "yesterday" },
      { ...good, id: "x".repeat(500) },
      null,
      "nope",
    ];
    const { valid, rejected } = parseReviews([good, ...bad, { ...good, id: "r2", deviceId: undefined }]);
    expect(valid.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(valid[1].deviceId).toBe("unknown");
    expect(rejected).toBe(bad.length);
  });

  it("/sync stores the good rows instead of failing the whole batch", async () => {
    const { env, d1 } = makeEnv();
    const res = await call(env, "POST", "/sync", {
      reviews: [good, { ...good, id: "bad", rating: 9 }, { ...good, id: "bad2", reviewedAt: null }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { accepted: number }).accepted).toBe(1);
    expect(d1.sqlite.prepare("SELECT id FROM reviews").all().map((r) => r.id)).toEqual(["r1"]);
  });

  it("/reviews reports rejected rows", async () => {
    const { env } = makeEnv();
    const res = await call(env, "POST", "/reviews", [good, { ...good, id: "x", rating: 0 }]);
    expect(await res.json()).toEqual({ ok: true, accepted: 1, rejected: 1 });
  });

  it("caps reviews per request", async () => {
    const { env } = makeEnv();
    const many = Array.from({ length: 501 }, (_, i) => ({ ...good, id: `r${i}` }));
    expect((await call(env, "POST", "/sync", { reviews: many })).status).toBe(400);
    expect((await call(env, "POST", "/reviews", many)).status).toBe(400);
    expect((await call(env, "POST", "/sync", { reviews: "nope" })).status).toBe(400);
  });

  it("undo removes the review, fixes the counter and the derived state", async () => {
    const { env, d1 } = makeEnv();
    await call(env, "POST", "/sync", { reviews: [good] });
    const res = await call(env, "DELETE", "/reviews", { id: "r1" });
    expect(await res.json()).toEqual({ ok: true });
    expect({ ...d1.sqlite.prepare("SELECT seq, review_count FROM sync_stats").get() }).toEqual({
      seq: 2,
      review_count: 0,
    });
    expect(d1.sqlite.prepare("SELECT * FROM card_state").all()).toEqual([]);
    expect(await (await call(env, "DELETE", "/reviews", { id: "r1" })).json()).toEqual({
      ok: true,
      missing: true,
    });
  });
});
