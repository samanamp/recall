import { afterEach, describe, expect, it, vi } from "vitest";
import { call, makeEnv } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

afterEach(() => vi.useRealTimers());

function seedDue(d1: ReturnType<typeof makeEnv>["d1"], dues: number[]) {
  const insert = d1.sqlite.prepare(
    "INSERT INTO card_state (card_id, due, state, updated_at) VALUES (?, ?, 2, 0)"
  );
  dues.forEach((due, i) => insert.run(`c${i}`, due));
}

describe("/stats forecast", () => {
  it("counts overdue cards into today and buckets by the client's day", async () => {
    const now = Date.UTC(2026, 5, 10, 22); // 22:00 UTC = 08:00 next day in UTC+10
    vi.useFakeTimers({ now, toFake: ["Date"] });
    const { env, d1 } = makeEnv();
    seedDue(d1, [now - 3 * DAY, now - HOUR, now + HOUR, now + 3 * HOUR, now + 30 * DAY]);

    const utc = (await (await call(env, "GET", "/stats?tz=0")).json()) as { forecast: unknown[] };
    expect(utc.forecast).toEqual([
      { day: "2026-06-10", n: 3 }, // 2 overdue + 1 due later today
      { day: "2026-06-11", n: 1 }, // 01:00 tomorrow
    ]);

    // UTC+10 (getTimezoneOffset = -600): it's already June 11 there.
    const east = (await (await call(env, "GET", "/stats?tz=-600")).json()) as { forecast: unknown[] };
    expect(east.forecast).toEqual([{ day: "2026-06-11", n: 4 }]);
  });

  it("ignores a garbage tz", async () => {
    const { env } = makeEnv();
    expect((await call(env, "GET", "/stats?tz=abc")).status).toBe(200);
  });
});
