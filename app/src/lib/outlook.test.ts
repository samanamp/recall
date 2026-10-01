import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { loadOutlook } from "./outlook";

const DAY = 86_400_000;
const now = new Date(2026, 8, 30, 15, 0); // mid-afternoon, local time

const card = (id: string) => ({ id, path: `decks/d/${id}.md`, sha: null, deck: "d", front: "q", back: "a", created: "" });
const state = (cardId: string, due: number, st: number, interval: number) => ({
  cardId,
  due,
  state: st,
  fsrsJson: JSON.stringify({ scheduled_days: interval }),
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("loadOutlook", () => {
  it("buckets due dates by local day, folding overdue cards into today", async () => {
    await db.cards.bulkPut(["a", "b", "c", "d", "e"].map(card));
    await db.state.bulkPut([
      state("a", now.getTime() - 3 * DAY, 2, 5), // overdue → today
      state("b", now.getTime() + 6 * 3600_000, 2, 30), // tonight → today, mature
      state("c", now.getTime() + DAY, 1, 0), // tomorrow, learning
      state("d", now.getTime() + 40 * DAY, 2, 40), // beyond the window
    ]);
    const o = await loadOutlook(now, 14);
    expect(o.forecast.slice(0, 3)).toEqual([2, 1, 0]);
    expect(o.forecast.reduce((a, n) => a + n, 0)).toBe(3);
    expect(o.mix).toEqual({ new: 1, learning: 1, young: 1, mature: 2 });
    expect(o.total).toBe(5);
  });

  it("treats unreadable state as young rather than guessing", async () => {
    await db.cards.put(card("x"));
    await db.state.put({ cardId: "x", due: now.getTime(), state: 2, fsrsJson: "{" });
    expect((await loadOutlook(now)).mix.young).toBe(1);
  });
});
