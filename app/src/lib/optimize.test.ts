import { describe, expect, it } from "vitest";
import { prepTrainingData } from "./optimize";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1, 12);

function r(card: string, day: number, rating: number) {
  return { card_id: card, rating, reviewed_at: T0 + day * DAY };
}

describe("optimizer training-data prep", () => {
  it("groups reviews per card with day-granularity deltas", () => {
    const data = prepTrainingData([r("a", 0, 3), r("a", 1, 3), r("a", 4, 4)]);
    expect(data.lengths).toEqual([3]);
    expect(data.ratings).toEqual([3, 3, 4]);
    expect(data.deltas).toEqual([0, 1, 3]); // first review delta is 0
  });

  it("drops single-review cards (no signal)", () => {
    const data = prepTrainingData([r("solo", 0, 3), r("b", 0, 3), r("b", 2, 3)]);
    expect(data.lengths).toEqual([2]);
    expect(data.ratings).toEqual([3, 3]);
  });

  it("sorts out-of-order reviews and clamps ratings", () => {
    const data = prepTrainingData([r("a", 5, 99), r("a", 0, 0)]);
    expect(data.ratings).toEqual([1, 4]); // clamped, in time order
    expect(data.deltas).toEqual([0, 5]);
  });

  it("drops cards whose reviews all fall on one day (fsrs-rs rejects them)", () => {
    const data = prepTrainingData([
      { card_id: "a", rating: 1, reviewed_at: T0 },
      { card_id: "a", rating: 3, reviewed_at: T0 + 600_000 }, // 10 min later
      r("b", 0, 3),
      r("b", 2, 3),
    ]);
    expect(data.lengths).toEqual([2]); // only card b survives
    expect(data.deltas).toEqual([0, 2]);
  });

  it("keeps same-day learning steps when the card also has cross-day reviews", () => {
    const data = prepTrainingData([
      { card_id: "a", rating: 3, reviewed_at: T0 },
      { card_id: "a", rating: 3, reviewed_at: T0 + 600_000 },
      r("a", 3, 3),
    ]);
    expect(data.lengths).toEqual([3]);
    expect(data.deltas).toEqual([0, 0, 3]);
  });

  it("handles an empty log", () => {
    expect(prepTrainingData([])).toEqual({ ratings: [], deltas: [], lengths: [] });
  });
});
