// FSRS parameters (server-authoritative, invariant 2) and rescheduling.

import { fsrs } from "ts-fsrs";
import { replayCards, type Scheduler } from "./reviews";
import type { ParamsUpdate } from "./validate";

export interface FsrsParams {
  retention: number;
  weights: number[] | null;
}

/**
 * Cards replayed per PUT /params call: 2 log queries + a few fixed ones keeps
 * each call far inside the D1 query budget, and bounds CPU per invocation.
 */
export const RESCHEDULE_CHUNK_CARDS = 200;

export async function getParams(db: D1Database): Promise<FsrsParams> {
  const row = await db
    .prepare("SELECT retention, weights FROM params WHERE k = 1")
    .first<{ retention: number; weights: string | null }>();
  return {
    retention: row?.retention ?? 0.9,
    weights: row?.weights ? (JSON.parse(row.weights) as number[]) : null,
  };
}

export function mergeParams(current: FsrsParams, update: ParamsUpdate): FsrsParams {
  return {
    retention: update.retention ?? current.retention,
    weights: update.weights === undefined ? current.weights : update.weights,
  };
}

export function makeScheduler(p: FsrsParams): Scheduler {
  try {
    return fsrs({ request_retention: p.retention, ...(p.weights ? { w: p.weights } : {}) });
  } catch {
    return fsrs({ request_retention: p.retention }); // bad weights — fall back
  }
}

interface RescheduleCursor {
  after: string; // last card id done (card ids are walked in order)
  mark: number; // max reviews.rowid when the reschedule started
  done: number; // cards rescheduled so far
}

export type RescheduleResult =
  | { done: false; cursor: string; rescheduled: number }
  | { done: true; rescheduled: number };

/**
 * One page of "reschedule every card under new params". The params row is
 * written in the same batch as the LAST page's states, so an interrupted run
 * leaves params unchanged (and devices on the old schedule) rather than
 * card_state half under each. Until then the sync cursor doesn't move, so
 * idle devices don't pull the intermediate states; the final params write
 * moves it and every device refreshes once.
 */
export async function rescheduleStep(
  db: D1Database,
  next: FsrsParams,
  cursor: RescheduleCursor | null
): Promise<RescheduleResult> {
  const from = cursor ?? { after: "", mark: await maxReviewRowid(db), done: 0 };
  const { results } = await db
    .prepare("SELECT DISTINCT card_id FROM reviews WHERE card_id > ? ORDER BY card_id LIMIT ?")
    .bind(from.after, RESCHEDULE_CHUNK_CARDS + 1)
    .all<{ card_id: string }>();
  const ids = results.slice(0, RESCHEDULE_CHUNK_CARDS).map((r) => r.card_id);
  const done = from.done + ids.length;
  const scheduler = makeScheduler(next);

  if (results.length > RESCHEDULE_CHUNK_CARDS) {
    await replayCards(db, ids, scheduler);
    const after = ids[ids.length - 1];
    return { done: false, cursor: JSON.stringify({ ...from, after, done }), rescheduled: done };
  }

  // Cards reviewed while earlier pages ran were replayed under the old params
  // by /sync; redo them so the final state is uniform.
  const { results: late } = await db
    .prepare("SELECT DISTINCT card_id FROM reviews WHERE rowid > ? LIMIT ?")
    .bind(from.mark, RESCHEDULE_CHUNK_CARDS)
    .all<{ card_id: string }>();
  const finalIds = [...new Set([...ids, ...late.map((r) => r.card_id)])];
  await replayCards(db, finalIds, scheduler, [writeParams(db, next)]);
  return { done: true, rescheduled: done };
}

export function parseRescheduleCursor(raw: unknown): RescheduleCursor | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "invalid";
  try {
    const c = JSON.parse(raw) as Partial<RescheduleCursor>;
    if (typeof c.after === "string" && Number.isInteger(c.mark) && Number.isInteger(c.done)) {
      return c as RescheduleCursor;
    }
  } catch {
    // fall through
  }
  return "invalid";
}

async function maxReviewRowid(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(MAX(rowid), 0) AS m FROM reviews")
    .first<{ m: number }>();
  return row?.m ?? 0;
}

function writeParams(db: D1Database, p: FsrsParams): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO params (k, retention, weights, updated_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET retention = excluded.retention,
         weights = excluded.weights, updated_at = excluded.updated_at`
    )
    .bind(p.retention, p.weights ? JSON.stringify(p.weights) : null, Date.now());
}
