// Review ingest + batched replay.
//
// Free-tier D1 allows ~50 queries per Worker invocation (a db.batch() counts
// as one). Replaying card by card cost two queries per card, so an offline
// session touching ~23+ cards overflowed the budget, failed, and was resent
// forever. Here the cost is fixed: one batch to insert, one query per 100
// touched cards to load their logs, one batch to write the derived state.

import type { Card, fsrs } from "ts-fsrs";
import { replayReviews, type ReviewEntry } from "./replay";
import { MAX_REVIEWS_PER_REQUEST, parseReviews, type ReviewRow } from "./validate";

export type Scheduler = ReturnType<typeof fsrs>;

/** D1 rejects statements with more than 100 bound parameters. */
const MAX_BOUND_PARAMS = 100;
const INSERT_ROWS_PER_STATEMENT = Math.floor(MAX_BOUND_PARAMS / 5); // 5 columns per review
const IDS_PER_QUERY = MAX_BOUND_PARAMS;

/**
 * Distinct cards one request may touch: 5 log queries at 100 ids each, well
 * inside the budget next to /sync's fixed ~7 queries.
 */
export const MAX_CARDS_PER_REQUEST = 500;

/** Validate a pushed batch: a string is the reason for a 400. */
export function checkReviewBatch(input: unknown): { valid: ReviewRow[]; rejected: number } | string {
  if (!Array.isArray(input)) return "reviews must be an array";
  if (input.length > MAX_REVIEWS_PER_REQUEST) {
    return `too many reviews (${input.length}); max ${MAX_REVIEWS_PER_REQUEST} per request`;
  }
  const parsed = parseReviews(input);
  const cards = new Set(parsed.valid.map((r) => r.cardId)).size;
  if (cards > MAX_CARDS_PER_REQUEST) {
    return `too many distinct cards (${cards}); max ${MAX_CARDS_PER_REQUEST} per request`;
  }
  return parsed;
}

/**
 * Insert reviews (duplicates ignored — ids are device-generated ULIDs) and
 * bump sync_stats in the same transaction. `changes()` is the row count of the
 * INSERT just before it, so the counter moves by exactly what was added.
 * Returns the ids of every card the batch mentions.
 */
export async function ingestReviews(
  db: D1Database,
  rows: ReviewRow[]
): Promise<{ inserted: number; touched: string[] }> {
  if (rows.length === 0) return { inserted: 0, touched: [] };
  const bump = db.prepare(
    "UPDATE sync_stats SET seq = seq + changes(), review_count = review_count + changes()"
  );
  const statements: D1PreparedStatement[] = [];
  for (const chunk of chunked(rows, INSERT_ROWS_PER_STATEMENT)) {
    const values = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO reviews (id, card_id, rating, reviewed_at, device_id) VALUES ${values}`
        )
        .bind(...chunk.flatMap((r) => [r.id, r.cardId, r.rating, r.reviewedAt, r.deviceId])),
      bump
    );
  }
  const results = await db.batch(statements);
  const inserted = results
    .filter((_, i) => i % 2 === 0) // the INSERTs, not the bumps
    .reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return { inserted, touched: [...new Set(rows.map((r) => r.cardId))] };
}

/** Remove one review (undo) and re-derive its card. Returns false if absent. */
export async function deleteReview(db: D1Database, id: string, scheduler: Scheduler): Promise<boolean> {
  const row = await db
    .prepare("SELECT card_id FROM reviews WHERE id = ?")
    .bind(id)
    .first<{ card_id: string }>();
  if (!row) return false;
  await db.batch([
    db.prepare("DELETE FROM reviews WHERE id = ?").bind(id),
    db.prepare("UPDATE sync_stats SET seq = seq + changes(), review_count = review_count - changes()"),
  ]);
  await replayCards(db, [row.card_id], scheduler);
  return true;
}

/**
 * Re-derive card_state for these cards from their full logs (invariant 1:
 * card_state is only ever written here). A card with no reviews left loses
 * its state — it is new again. `extra` statements join the same batch, so
 * they commit together with the states.
 */
export async function replayCards(
  db: D1Database,
  cardIds: string[],
  scheduler: Scheduler,
  extra: D1PreparedStatement[] = []
): Promise<void> {
  const logs = await loadLogs(db, cardIds);
  const now = Date.now();
  const writes = cardIds.map((id) => {
    const card = replayReviews(logs.get(id) ?? [], scheduler);
    return card
      ? upsertState(db, id, card, now)
      : db.prepare("DELETE FROM card_state WHERE card_id = ?").bind(id);
  });
  const statements = [...writes, ...extra];
  if (statements.length > 0) await db.batch(statements);
}

/** Review logs for many cards, one query per 100 ids (D1's parameter cap). */
async function loadLogs(db: D1Database, cardIds: string[]): Promise<Map<string, ReviewEntry[]>> {
  const pages = await Promise.all(
    chunked(cardIds, IDS_PER_QUERY).map(async (ids) => {
      const { results } = await db
        .prepare(
          `SELECT card_id, rating, reviewed_at FROM reviews
           WHERE card_id IN (${ids.map(() => "?").join(", ")})
           ORDER BY reviewed_at, id`
        )
        .bind(...ids)
        .all<{ card_id: string; rating: number; reviewed_at: number }>();
      return results;
    })
  );
  const logs = new Map<string, ReviewEntry[]>();
  for (const row of pages.flat()) {
    let log = logs.get(row.card_id);
    if (!log) logs.set(row.card_id, (log = []));
    log.push({ rating: row.rating, reviewed_at: row.reviewed_at });
  }
  return logs;
}

function upsertState(db: D1Database, cardId: string, card: Card, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO card_state (card_id, due, stability, difficulty, state, reps, lapses, fsrs_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET
         due = excluded.due, stability = excluded.stability,
         difficulty = excluded.difficulty, state = excluded.state,
         reps = excluded.reps, lapses = excluded.lapses,
         fsrs_json = excluded.fsrs_json, updated_at = excluded.updated_at`
    )
    .bind(
      cardId,
      card.due.getTime(),
      card.stability,
      card.difficulty,
      card.state,
      card.reps,
      card.lapses,
      JSON.stringify(card),
      now
    );
}

export function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
