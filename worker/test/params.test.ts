import { describe, expect, it } from "vitest";
import { makeScheduler, RESCHEDULE_CHUNK_CARDS } from "../src/params";
import { replayReviews } from "../src/replay";
import { call, makeEnv, sampleReviews } from "./helpers";

const W19 = Array.from({ length: 19 }, (_, i) => [0.4, 1.2, 3.2, 15.7, 7.2, 0.53, 1.46, 0.005, 1.55, 0.12, 1.0, 1.9, 0.11, 0.29, 2.27, 0.23, 2.99, 0.52, 0.66][i]);

describe("PUT /params", () => {
  it("pages through every card within budget and commits params only at the end", async () => {
    const { env, d1 } = makeEnv();
    const cards = RESCHEDULE_CHUNK_CARDS * 2 + 50;
    const log = sampleReviews(cards);
    for (let i = 0; i < log.length; i += 500) {
      expect((await call(env, "POST", "/reviews", log.slice(i, i + 500))).status).toBe(200);
    }

    const body = { retention: 0.85, weights: W19 };
    let cursor: string | undefined;
    let calls = 0;
    let last: { done: boolean; cursor?: string; rescheduled: number };
    do {
      d1.resetCount();
      const res = await call(env, "PUT", "/params", { ...body, cursor });
      expect(res.status).toBe(200);
      expect(d1.queries()).toBeLessThanOrEqual(50);
      last = (await res.json()) as typeof last;
      calls++;
      const p = d1.sqlite.prepare("SELECT retention FROM params").get() as { retention: number };
      expect(p.retention).toBe(last.done ? 0.85 : 0.9); // old params until the last page
      cursor = last.cursor;
    } while (!last.done);

    expect(calls).toBe(3);
    expect(last.rescheduled).toBe(cards);

    // Every card now matches a from-scratch replay under the new params.
    const scheduler = makeScheduler({ retention: 0.85, weights: W19 });
    const rows = d1.sqlite.prepare("SELECT card_id, due FROM card_state").all() as {
      card_id: string;
      due: number;
    }[];
    expect(rows).toHaveLength(cards);
    for (const row of rows) {
      const own = log
        .filter((r) => r.cardId === row.card_id)
        .map((r) => ({ rating: r.rating, reviewed_at: r.reviewedAt }));
      expect(row.due).toBe(replayReviews(own, scheduler)!.due.getTime());
    }
  });

  it("finishes in one call for a small collection and an empty one", async () => {
    const { env } = makeEnv();
    let res = await call(env, "PUT", "/params", { retention: 0.8 });
    expect(await res.json()).toEqual({ ok: true, done: true, rescheduled: 0 });
    await call(env, "POST", "/reviews", sampleReviews(5));
    res = await call(env, "PUT", "/params", { weights: null });
    expect(await res.json()).toEqual({ ok: true, done: true, rescheduled: 5 });
  });

  it("rejects bad retention, weights and cursors", async () => {
    const { env } = makeEnv();
    for (const body of [
      { retention: 0.5 },
      { retention: 1 },
      { retention: "0.9" },
      { weights: [1, 2, 3] },
      { weights: Array(19).fill(Number.NaN) },
      { weights: "x" },
      { retention: 0.9, cursor: "{not json" },
      { retention: 0.9, cursor: 7 },
    ]) {
      expect((await call(env, "PUT", "/params", body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const n of [17, 19, 21]) {
      const res = await call(env, "PUT", "/params", { weights: W19.concat(W19).slice(0, n) });
      expect(res.status).toBe(200);
    }
  });
});
