import { describe, expect, it } from "vitest";
import { lapseRate, prepTrainingData } from "./optimize";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1, 12);

function r(card: string, day: number, rating: number) {
  return { card_id: card, rating, reviewed_at: T0 + day * DAY };
}

describe("optimizer training-data prep (FSRS prefix items)", () => {
  it("emits one history-prefix item per cross-day review", () => {
    const data = prepTrainingData([r("a", 0, 3), r("a", 1, 3), r("a", 4, 4)]);
    // two cross-day reviews -> two items: [d0,d1] and [d0,d1,d4]
    expect(data.lengths).toEqual([2, 3]);
    expect(data.ratings).toEqual([3, 3, 3, 3, 4]);
    expect(data.deltas).toEqual([0, 1, 0, 1, 3]);
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

  it("produces no items for cards whose reviews all fall on one day", () => {
    const data = prepTrainingData([
      { card_id: "a", rating: 1, reviewed_at: T0 },
      { card_id: "a", rating: 3, reviewed_at: T0 + 600_000 }, // 10 min later
      r("b", 0, 3),
      r("b", 2, 3),
    ]);
    expect(data.lengths).toEqual([2]); // only card b yields an item
    expect(data.deltas).toEqual([0, 2]);
  });

  it("same-day learning steps stay inside the prefix of a cross-day item", () => {
    const data = prepTrainingData([
      { card_id: "a", rating: 3, reviewed_at: T0 },
      { card_id: "a", rating: 3, reviewed_at: T0 + 600_000 },
      r("a", 3, 3),
    ]);
    expect(data.lengths).toEqual([3]); // one item: the full 3-review prefix
    expect(data.deltas).toEqual([0, 0, 3]);
  });

  it("handles an empty log", () => {
    expect(prepTrainingData([])).toEqual({ ratings: [], deltas: [], lengths: [] });
  });
});

describe("lapseRate (optimizer failure-signal guard)", () => {
  it("computes the share of Again ratings", () => {
    expect(lapseRate([{ rating: 1 }, { rating: 3 }, { rating: 3 }, { rating: 1 }])).toBe(0.5);
    expect(lapseRate([{ rating: 2 }, { rating: 3 }])).toBe(0); // Hard is a pass
    expect(lapseRate([])).toBe(0);
  });
});
