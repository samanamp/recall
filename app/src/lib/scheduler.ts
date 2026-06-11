import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import { db, type StateRow } from "./db";

const scheduler = fsrs();

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
}

/** Due + new counts per deck (new = card without a state row). */
export async function deckCounts(now: Date): Promise<Map<string, DeckCounts>> {
  const [cards, states] = await Promise.all([db.cards.toArray(), db.state.toArray()]);
  const stateById = new Map(states.map((s) => [s.cardId, s]));
  const counts = new Map<string, DeckCounts>();
  for (const deck of await db.decks.toArray()) {
    counts.set(deck.name, { due: 0, newCards: 0 });
  }
  for (const card of cards) {
    const entry = counts.get(card.deck) ?? { due: 0, newCards: 0 };
    const s = stateById.get(card.id);
    if (!s) entry.newCards++;
    else if (s.due <= now.getTime()) entry.due++;
    counts.set(card.deck, entry);
  }
  return counts;
}

/** Build the review queue for a deck: due cards (oldest first), then new. */
export async function buildQueue(deck: string, now: Date): Promise<string[]> {
  const cards = await db.cards.where("deck").equals(deck).toArray();
  const states = await db.state.bulkGet(cards.map((c) => c.id));
  const due: { id: string; due: number }[] = [];
  const fresh: string[] = [];
  cards.forEach((card, i) => {
    const s = states[i];
    if (!s) fresh.push(card.id);
    else if (s.due <= now.getTime()) due.push({ id: card.id, due: s.due });
  });
  due.sort((a, b) => a.due - b.due);
  return [...due.map((d) => d.id), ...fresh];
}
