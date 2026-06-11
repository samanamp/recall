import { createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";

export interface ReviewEntry {
  rating: number; // 1 Again | 2 Hard | 3 Good | 4 Easy
  reviewed_at: number; // epoch ms
}

/**
 * Derive a card's FSRS state by replaying its full review log.
 * Pure and deterministic: same log (any input order) → same state.
 * This is the single source of scheduling truth (CLAUDE.md invariant 1).
 */
export function replayReviews(
  reviews: ReviewEntry[],
  scheduler: ReturnType<typeof fsrs>
): Card | null {
  if (reviews.length === 0) return null;
  const sorted = [...reviews].sort((a, b) => a.reviewed_at - b.reviewed_at);
  let card = createEmptyCard(new Date(sorted[0].reviewed_at));
  for (const r of sorted) {
    card = scheduler.next(card, new Date(r.reviewed_at), clampGrade(r.rating)).card;
  }
  return card;
}

function clampGrade(rating: number): Grade {
  return Math.min(4, Math.max(1, Math.round(rating))) as Grade;
}
