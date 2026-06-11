import { api } from "./api";

/**
 * Fit FSRS parameters to the user's own review log using fsrs-browser
 * (the official Rust optimizer compiled to WASM, run client-side — $0).
 *
 * computeParameters wants the log flattened per card:
 *   ratings  — every review's rating (1-4), cards back to back
 *   delta_ts — days since that card's previous review (0 for the first)
 *   lengths  — reviews per card, delimiting the flat arrays
 */
export interface TrainingData {
  ratings: number[];
  deltas: number[]; // whole days since the card's previous review
  lengths: number[]; // reviews per card
}

/** Pure data prep — exported for tests. */
export function prepTrainingData(
  reviews: { card_id: string; rating: number; reviewed_at: number }[]
): TrainingData {
  const byCard = new Map<string, { rating: number; t: number }[]>();
  for (const r of reviews) {
    const list = byCard.get(r.card_id) ?? [];
    list.push({ rating: r.rating, t: r.reviewed_at });
    byCard.set(r.card_id, list);
  }

  const ratings: number[] = [];
  const deltas: number[] = [];
  const lengths: number[] = [];
  const DAY = 86_400_000;
  for (const revs of byCard.values()) {
    if (revs.length < 2) continue; // single-review cards carry no signal
    revs.sort((a, b) => a.t - b.t);
    let prevDay: number | null = null;
    for (const r of revs) {
      const day = Math.floor(r.t / DAY);
      ratings.push(Math.min(4, Math.max(1, r.rating)));
      deltas.push(prevDay === null ? 0 : Math.max(0, day - prevDay));
      prevDay = day;
    }
    lengths.push(revs.length);
  }
  return { ratings, deltas, lengths };
}

export async function optimizeParameters(): Promise<{ weights: number[]; reviews: number }> {
  const [{ reviews }, mod] = await Promise.all([
    api.exportReviews(),
    import("fsrs-browser"),
  ]);
  await mod.default();

  const { ratings, deltas, lengths } = prepTrainingData(reviews);
  if (lengths.length === 0) throw new Error("not enough multi-review cards to optimize yet");

  const fsrs = new mod.Fsrs();
  try {
    const w = fsrs.computeParameters(
      new Uint32Array(ratings),
      new Uint32Array(deltas),
      new Uint32Array(lengths),
      undefined,
      true // short-term (same-day) memory component
    );
    return { weights: [...w], reviews: ratings.length };
  } finally {
    fsrs.free();
  }
}
