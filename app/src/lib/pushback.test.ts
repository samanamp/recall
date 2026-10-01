import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts imports `api` (via sync.ts); nothing here talks to a server.
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {},
}));

import { pushBack, saveCard, undoPushBack } from "./actions";
import { parseCardFile, serializeCardFile } from "./cardfile";
import { db, kvSet } from "./db";
import { buildQueue } from "./scheduler";

const DECK = "d";
/** 30 new cards whose ids sort in creation order, like real ULIDs. */
const ids = Array.from({ length: 30 }, (_, i) => `01M3N88Q${String(i).padStart(2, "0")}AAAAAAAAAAAAAAAA`);

beforeEach(async () => {
  // requestSync()'s debounce must not start a real sync mid-test
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await Promise.all(db.tables.map((t) => t.clear()));
  await kvSet("newPerDay", 100);
  await db.decks.put({ name: DECK });
  await db.cards.bulkPut(
    ids.map((id) => ({ id, path: `decks/d/${id.toLowerCase()}.md`, sha: "s", deck: DECK, front: id, back: "b", created: "2026-09-28" }))
  );
});
afterEach(() => vi.useRealTimers());

const queue = () => buildQueue(DECK, new Date());

describe("pushBack", () => {
  it("moves a new card after the next 20 new cards, and again on a second push", async () => {
    expect((await queue()).indexOf(ids[2])).toBe(2);
    await pushBack(ids[2], DECK);
    expect((await queue()).indexOf(ids[2])).toBe(22); // after ids[3]..ids[22]
    expect((await queue())[21]).toBe(ids[22]);
    await pushBack(ids[2], DECK);
    expect((await queue()).at(-1)).toBe(ids[2]); // fewer than 20 left: goes last
  });

  it("writes the position into the card file so it syncs", async () => {
    await pushBack(ids[0], DECK);
    const pending = await db.pendingFiles.get(`decks/d/${ids[0].toLowerCase()}.md`);
    expect(parseCardFile(pending!.content!).order).toBe(`${ids[20]}~`);
  });

  it("keeps cards it is pushed past in their order", async () => {
    await pushBack(ids[5], DECK);
    await pushBack(ids[6], DECK);
    const q = await queue();
    expect(q.filter((id) => id !== ids[5] && id !== ids[6])).toEqual(ids.filter((id) => id !== ids[5] && id !== ids[6]));
    expect(q.indexOf(ids[5])).toBeLessThan(q.indexOf(ids[6]));
  });

  it("leaves the last new card where it is", async () => {
    expect(await pushBack(ids[29], DECK)).toBeNull();
  });


  it("undo puts the card back, and an edit keeps the new position", async () => {
    const undo = await pushBack(ids[3], DECK);
    await saveCard({ id: ids[3], deck: DECK, front: "edited", back: "b" });
    expect((await queue()).indexOf(ids[3])).toBe(23);
    await undoPushBack(undo!);
    expect((await queue()).indexOf(ids[3])).toBe(3);
    expect((await db.cards.get(ids[3]))?.order).toBeUndefined();
  });
});

describe("pushBack on a card in review", () => {
  const DUE = ids[1];
  const dueState = { cardId: DUE, due: 0, state: 2, fsrsJson: "{}" };
  const pathOf = (id: string) => `decks/d/${id.toLowerCase()}.md`;

  it("replaces it with a new copy after the first 20 new cards", async () => {
    await db.state.put(dueState);
    const undo = await pushBack(DUE, DECK);
    expect(undo?.kind).toBe("reset");
    if (undo?.kind !== "reset") return;

    // the original is gone locally and its file is queued for deletion
    expect(await db.cards.get(DUE)).toBeUndefined();
    expect((await db.pendingFiles.get(pathOf(DUE)))?.op).toBe("delete");

    // the copy is a new card with the same text, 20 new cards from now
    const copy = (await db.cards.get(undo.copyId))!;
    expect(copy).toMatchObject({ deck: DECK, front: DUE, back: "b", sha: null });
    expect(await db.state.get(copy.id)).toBeUndefined();
    const q = await queue();
    const newOnly = q.filter((id) => id !== copy.id);
    expect(q.indexOf(copy.id)).toBe(20);
    expect(newOnly.slice(0, 20)).toEqual(ids.filter((id) => id !== DUE).slice(0, 20));
    expect((await db.pendingFiles.get(copy.path))?.op).toBe("put");
  });

  it("goes last when fewer than 20 new cards are left", async () => {
    await db.state.bulkPut(ids.slice(10).map((id) => ({ ...dueState, cardId: id })));
    await db.state.put(dueState);
    const undo = await pushBack(DUE, DECK);
    if (undo?.kind !== "reset") throw new Error("expected a reset");
    const copy = (await db.cards.get(undo.copyId))!;
    expect(copy.order).toBeUndefined(); // a fresh ULID already sorts last
    const fresh = (await queue()).filter((id) => !ids.slice(10).includes(id));
    expect(fresh.at(-1)).toBe(copy.id);
  });

  it("undo brings the original back with its schedule and drops the copy", async () => {
    await db.state.put(dueState);
    const undo = await pushBack(DUE, DECK);
    if (undo?.kind !== "reset") throw new Error("expected a reset");
    const copyPath = (await db.cards.get(undo.copyId))!.path;
    expect(await db.pendingFiles.get(copyPath)).toBeDefined();
    await undoPushBack(undo);
    expect(await db.cards.get(undo.copyId)).toBeUndefined();
    expect(await db.pendingFiles.get(copyPath)).toBeUndefined(); // never pushed: create dropped
    expect(await db.cards.get(DUE)).toMatchObject({ path: pathOf(DUE), sha: "s" });
    expect(await db.state.get(DUE)).toEqual(dueState);
    expect(await db.pendingFiles.get(pathOf(DUE))).toMatchObject({ op: "put", baseSha: "s" });
  });
});

describe("order in the card file", () => {
  it("round-trips, and is omitted when unset", () => {
    const base = { id: ids[0], created: "2026-09-28", front: "q", back: "a" };
    expect(serializeCardFile(base)).not.toContain("order:");
    const text = serializeCardFile({ ...base, order: `${ids[9]}~` });
    expect(text).toContain(`order: ${ids[9]}~\n---\nq`);
    expect(parseCardFile(text).order).toBe(`${ids[9]}~`);
  });
});
