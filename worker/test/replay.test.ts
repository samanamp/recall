import { describe, expect, it } from "vitest";
import { fsrs, State } from "ts-fsrs";
import { replayReviews, type ReviewEntry } from "../src/replay";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1, 12); // fixed epoch for determinism

function rev(daysFromStart: number, rating: number): ReviewEntry {
  return { rating, reviewed_at: T0 + daysFromStart * DAY };
}

const scheduler = fsrs();

describe("replayReviews — the scheduling source of truth", () => {
  it("returns null for an empty log", () => {
    expect(replayReviews([], scheduler)).toBeNull();
  });

  it("is deterministic: same log → identical state", () => {
    const log = [rev(0, 3), rev(1, 3), rev(4, 4), rev(12, 3)];
    const a = replayReviews(log, scheduler)!;
    const b = replayReviews(log, scheduler)!;
    expect(a).toEqual(b);
  });

  it("is order-independent: shuffled input converges to the same state", () => {
    const log = [rev(0, 3), rev(1, 2), rev(3, 3), rev(8, 4), rev(20, 3)];
    const shuffled = [log[3], log[0], log[4], log[2], log[1]];
    expect(replayReviews(shuffled, scheduler)).toEqual(replayReviews(log, scheduler));
  });

  it("counts every review and schedules due after the last one", () => {
    const log = [rev(0, 3), rev(1, 3), rev(5, 3)];
    const card = replayReviews(log, scheduler)!;
    expect(card.reps).toBe(3);
    expect(card.due.getTime()).toBeGreaterThan(T0 + 5 * DAY);
  });

  it("a streak of Good graduates the card to Review state with growing stability", () => {
    const short = replayReviews([rev(0, 3), rev(1, 3)], scheduler)!;
    const long = replayReviews(
      [rev(0, 3), rev(1, 3), rev(4, 3), rev(12, 3), rev(30, 3)],
      scheduler
    )!;
    expect(long.state).toBe(State.Review);
    expect(long.stability).toBeGreaterThan(short.stability);
  });

  it("Again on a mature card records a lapse and shortens the next interval", () => {
    const base = [rev(0, 3), rev(1, 3), rev(4, 3), rev(12, 3)];
    const good = replayReviews([...base, rev(30, 3)], scheduler)!;
    const lapsed = replayReviews([...base, rev(30, 1)], scheduler)!;
    expect(lapsed.lapses).toBeGreaterThan(good.lapses);
    expect(lapsed.due.getTime()).toBeLessThan(good.due.getTime());
    expect(lapsed.stability).toBeLessThan(good.stability);
  });

  it("Easy schedules further out than Hard on the same history", () => {
    const base = [rev(0, 3), rev(1, 3), rev(4, 3)];
    const hard = replayReviews([...base, rev(12, 2)], scheduler)!;
    const easy = replayReviews([...base, rev(12, 4)], scheduler)!;
    expect(easy.due.getTime()).toBeGreaterThan(hard.due.getTime());
  });

  it("higher desired retention → shorter intervals", () => {
    const log = [rev(0, 3), rev(1, 3), rev(4, 3), rev(12, 3)];
    const lax = replayReviews(log, fsrs({ request_retention: 0.8 }))!;
    const strict = replayReviews(log, fsrs({ request_retention: 0.97 }))!;
    expect(strict.due.getTime()).toBeLessThan(lax.due.getTime());
  });

  it("clamps out-of-range ratings instead of crashing", () => {
    const card = replayReviews([rev(0, 99), rev(2, 0)], scheduler);
    expect(card).not.toBeNull();
    expect(card!.reps).toBe(2);
  });
});
