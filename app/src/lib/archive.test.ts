import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts imports `api` (via sync.ts); nothing here talks to a server.
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {},
}));

import { saveCard, setCardArchived } from "./actions";
import { parseCardFile, serializeCardFile } from "./cardfile";
import { db, kvSet } from "./db";
import { loadOutlook } from "./outlook";
import { buildAheadQueue, buildQueue, deckCounts } from "./scheduler";

const DECK = "d";
const NEW = "01M3N88Q00AAAAAAAAAAAAAAAA";
const DUE = "01M3N88Q01AAAAAAAAAAAAAAAA";
const SOON = "01M3N88Q02AAAAAAAAAAAAAAAA";
const path = (id: string) => `decks/d/${id.toLowerCase()}.md`;
const DAY = 86_400_000;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await Promise.all(db.tables.map((t) => t.clear()));
  await kvSet("newPerDay", 100);
  await db.decks.put({ name: DECK });
  await db.cards.bulkPut(
    [NEW, DUE, SOON].map((id) => ({ id, path: path(id), sha: "s", deck: DECK, front: id, back: "b", created: "2026-09-28" }))
  );
  await db.state.bulkPut([
    { cardId: DUE, due: Date.now() - DAY, state: 2, fsrsJson: JSON.stringify({ scheduled_days: 30 }) },
    { cardId: SOON, due: Date.now() + 2 * DAY, state: 2, fsrsJson: JSON.stringify({ scheduled_days: 5 }) },
  ]);
});
afterEach(() => vi.useRealTimers());

describe("setCardArchived", () => {
  it("takes a card out of every queue and count", async () => {
    for (const id of [NEW, DUE, SOON]) await setCardArchived(id, true);
    const now = new Date();
    expect(await buildQueue(DECK, now)).toEqual([]);
    expect(await buildQueue(null, now)).toEqual([]);
    expect(await buildAheadQueue(DECK, now)).toEqual([]);
    expect((await deckCounts(now)).get(DECK)).toEqual({ due: 0, newCards: 0 });
    const outlook = await loadOutlook(now);
    expect(outlook.total).toBe(0);
    expect(outlook.forecast.every((n) => n === 0)).toBe(true);
  });

  it("writes the flag to the card file and keeps the schedule", async () => {
    await setCardArchived(DUE, true);
    const pending = await db.pendingFiles.get(path(DUE));
    expect(parseCardFile(pending!.content!).archived).toBe(true);
    expect(await db.state.get(DUE)).toBeDefined();
  });

  it("restoring puts it straight back, overdue cards as due", async () => {
    await setCardArchived(DUE, true);
    await setCardArchived(DUE, false);
    expect(await buildQueue(DECK, new Date())).toEqual([DUE, NEW]);
    expect((await db.cards.get(DUE))?.archived).toBeUndefined();
    expect(parseCardFile((await db.pendingFiles.get(path(DUE)))!.content!).archived).toBeUndefined();
  });

  it("an edit keeps a card archived", async () => {
    await setCardArchived(NEW, true);
    await saveCard({ id: NEW, deck: DECK, front: "edited", back: "b" });
    expect((await db.cards.get(NEW))?.archived).toBe(true);
  });
});

describe("archived in the card file", () => {
  it("round-trips, and is omitted when unset", () => {
    const base = { id: NEW, created: "2026-09-28", front: "q", back: "a" };
    expect(serializeCardFile(base)).not.toContain("archived");
    const text = serializeCardFile({ ...base, order: "X~", archived: true });
    expect(text).toContain("order: X~\narchived: true\n---\nq");
    expect(parseCardFile(text)).toMatchObject({ archived: true, order: "X~" });
    expect(parseCardFile(text.replace("archived: true", "archived: false")).archived).toBeUndefined();
  });
});
