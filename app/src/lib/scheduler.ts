import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import { db, introducedToday, kvGet, type StateRow } from "./db";

let scheduler = fsrs();

/** Apply synced FSRS params (desired retention + optional optimized weights). */
export function configureScheduler(retention: number, weights: number[] | null): void {
  try {
    scheduler = fsrs({ request_retention: retention, ...(weights ? { w: weights } : {}) });
  } catch {
    scheduler = fsrs({ request_retention: retention });
  }
}

export { Rating, State };

function reviveCard(json: string): FsrsCard {
  const raw = JSON.parse(json) as FsrsCard & { due: string; last_review?: string };
  return {
    ...raw,
    due: new Date(raw.due),
    last_review: raw.last_review ? new Date(raw.last_review) : undefined,
  };
}

function cardOf(row: StateRow | undefined, now: Date): FsrsCard {
  return row ? reviveCard(row.fsrsJson) : createEmptyCard(now);
}

/** Apply a rating locally; returns the updated state row to persist. */
export function rateCard(
  row: StateRow | undefined,
  cardId: string,
  rating: 1 | 2 | 3 | 4,
  now: Date
): StateRow {
  const next = scheduler.next(cardOf(row, now), now, rating as Grade).card;
  return {
    cardId,
    due: next.due.getTime(),
    state: next.state,
    fsrsJson: JSON.stringify(next),
  };
}

/** Human-readable predicted interval per rating, e.g. {1: "<10m", 3: "3d"}. */
export function previewIntervals(
  row: StateRow | undefined,
  now: Date
): Record<1 | 2 | 3 | 4, string> {
  const card = cardOf(row, now);
  const result = {} as Record<1 | 2 | 3 | 4, string>;
  for (const grade of [1, 2, 3, 4] as const) {
    const due = scheduler.next(card, now, grade as Grade).card.due;
    result[grade] = humanInterval(due.getTime() - now.getTime());
  }
  return result;
}

function humanInterval(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d`;
  const mo = Math.round(d / 30.4);
  if (mo < 12) return `${mo}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

export interface DeckCounts {
  due: number;
  newCards: number;
  /** Days until the next scheduled card when nothing is due (1 = tomorrow). */
  nextInDays?: number;
}

const DAY = 86_400_000;

/**
 * Day-granularity due cutoff (Anki convention): a card due any time today
 * counts as due now — nobody wants cards trickling in at 7:51pm.
 */
function dueCutoff(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

/** Due + new counts per deck (new = card without a state row). */
export async function deckCounts(now: Date): Promise<Map<string, DeckCounts>> {
  const [cards, states] = await Promise.all([db.cards.toArray(), db.state.toArray()]);
  const stateById = new Map(states.map((s) => [s.cardId, s]));
  const cutoff = dueCutoff(now);
  const counts = new Map<string, DeckCounts>();
  for (const deck of await db.decks.toArray()) {
    counts.set(deck.name, { due: 0, newCards: 0 });
  }
  for (const card of cards) {
    const entry = counts.get(card.deck) ?? { due: 0, newCards: 0 };
    const s = stateById.get(card.id);
    if (!s) entry.newCards++;
    else if (s.due <= cutoff) entry.due++;
    else {
      const days = Math.ceil((s.due - cutoff) / DAY);
      if (entry.nextInDays === undefined || days < entry.nextInDays) entry.nextInDays = days;
    }
    counts.set(card.deck, entry);
  }
  return counts;
}

/**
 * Build the review queue (deck, or all decks when null): due first, then new.
 * New cards are capped per day (avalanche prevention — every new card is a
 * scheduling commitment that comes due within days).
 */
/** Remaining new-card introductions allowed today. */
export async function newBudget(now: Date): Promise<number> {
  const newPerDay = (await kvGet<number>("newPerDay")) ?? 20;
  return Math.max(0, newPerDay - (await introducedToday(now)));
}

export async function buildQueue(deck: string | null, now: Date): Promise<string[]> {
  const cutoff = dueCutoff(now);
  const budget = await newBudget(now);
  const cards = deck
    ? await db.cards.where("deck").equals(deck).toArray()
    : await db.cards.toArray();
  const states = await db.state.bulkGet(cards.map((c) => c.id));
  const due: { id: string; due: number }[] = [];
  const fresh: string[] = [];
  cards.forEach((card, i) => {
    const s = states[i];
    if (!s) fresh.push(card.id);
    else if (s.due <= cutoff) due.push({ id: card.id, due: s.due });
  });
  due.sort((a, b) => a.due - b.due);
  return [...due.map((d) => d.id), ...fresh.slice(0, budget)];
}

/**
 * Cards due within the next `days` beyond today — for studying ahead.
 * Reviewing early is sound: FSRS factors the shorter elapsed time in.
 */
export async function buildAheadQueue(
  deck: string | null,
  now: Date,
  days = 7
): Promise<string[]> {
  const cutoff = dueCutoff(now);
  const horizon = cutoff + days * DAY;
  const cards = deck
    ? await db.cards.where("deck").equals(deck).toArray()
    : await db.cards.toArray();
  const states = await db.state.bulkGet(cards.map((c) => c.id));
  const upcoming: { id: string; due: number }[] = [];
  cards.forEach((card, i) => {
    const s = states[i];
    if (s && s.due > cutoff && s.due <= horizon) upcoming.push({ id: card.id, due: s.due });
  });
  upcoming.sort((a, b) => a.due - b.due);
  return upcoming.map((u) => u.id);
}
