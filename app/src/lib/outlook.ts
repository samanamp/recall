import { db, type StateRow } from "./db";

const DAY = 86_400_000;
/** Anki's line between young and mature: a review interval of three weeks. */
const MATURE_DAYS = 21;

export interface Mix {
  new: number;
  learning: number;
  young: number;
  mature: number;
}

export interface Outlook {
  /** Reviews due per local day, starting today; today includes overdue cards. */
  forecast: number[];
  mix: Mix;
  total: number;
  /** The same, per deck (decks with no cards are absent). */
  byDeck: Map<string, { forecast: number[]; mix: Mix }>;
}

/**
 * What this device knows about the road ahead, from local state alone — so the
 * home rail and Stats have something true to show offline. New cards (no state
 * row yet) are not in the forecast; they arrive at the user's own pace.
 */
export async function loadOutlook(now: Date, days = 14): Promise<Outlook> {
  const [cards, states] = await Promise.all([db.cards.toArray(), db.state.toArray()]);
  const stateById = new Map(states.map((s) => [s.cardId, s]));
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const forecast = new Array<number>(days).fill(0);
  const mix = emptyMix();
  const byDeck = new Map<string, { forecast: number[]; mix: Mix }>();

  for (const card of cards) {
    let deck = byDeck.get(card.deck);
    if (!deck) byDeck.set(card.deck, (deck = { forecast: new Array<number>(days).fill(0), mix: emptyMix() }));
    const s = stateById.get(card.id);
    const st = s ? stage(s) : "new";
    mix[st]++;
    deck.mix[st]++;
    if (!s) continue;
    const day = Math.max(0, Math.floor((s.due - start.getTime()) / DAY));
    if (day < days) {
      forecast[day]++;
      deck.forecast[day]++;
    }
  }
  return { forecast, mix, total: cards.length, byDeck };
}

function emptyMix(): Mix {
  return { new: 0, learning: 0, young: 0, mature: 0 };
}

function stage(s: StateRow): Exclude<keyof Mix, "new"> {
  // ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning
  if (s.state === 1 || s.state === 3) return "learning";
  if (s.state === 0) return "learning"; // rated but still in its first steps
  let interval = 0;
  try {
    interval = (JSON.parse(s.fsrsJson) as { scheduled_days?: number }).scheduled_days ?? 0;
  } catch {
    // unreadable state: count it as young rather than guess maturity
  }
  return interval >= MATURE_DAYS ? "mature" : "young";
}
