import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { createDeck, deleteDeck } from "../lib/actions";
import { db } from "../lib/db";
import { deckColor } from "../lib/deck-color";
import { deckCounts } from "../lib/scheduler";

export default function Decks() {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  async function onCreate() {
    if (!name.trim()) return;
    await createDeck(name);
    setName("");
    setAdding(false);
  }

  async function onDelete(e: React.MouseEvent, deck: string, total: number) {
    e.preventDefault(); // tile is a Link — don't navigate
    e.stopPropagation();
    const what = total > 0 ? `"${deck}" and its ${total} card${total === 1 ? "" : "s"}` : `"${deck}"`;
    if (!confirm(`Delete ${what}?\n\nFiles are removed from your repo (git history keeps them recoverable).`)) {
      return;
    }
    await deleteDeck(deck);
  }

  const decks = useLiveQuery(async () => {
    const counts = await deckCounts(new Date());
    const totals = new Map<string, number>();
    for (const c of await db.cards.toArray()) {
      totals.set(c.deck, (totals.get(c.deck) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, c]) => ({ name, ...c, total: totals.get(name) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  if (!decks) return null;

  const totalCards = decks.reduce((n, d) => n + d.total, 0);
  const totalDue = decks.reduce((n, d) => n + d.due, 0);
  const totalNew = decks.reduce((n, d) => n + d.newCards, 0);

  const newDeckTile = adding ? (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onCreate();
      }}
      className="flex items-center gap-2 rounded-2xl border border-sky-500/50 bg-white p-3 shadow-sm dark:bg-zinc-900/70"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
        placeholder="Deck name"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
      />
      <button
        type="submit"
        disabled={!name.trim()}
        className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setAdding(false)}
        className="px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        ✕
      </button>
    </form>
  ) : (
    <button
      onClick={() => setAdding(true)}
      className="flex min-h-[5.5rem] items-center justify-center rounded-2xl border border-dashed border-zinc-300 text-sm font-medium text-zinc-400 transition-colors hover:border-sky-400 hover:text-sky-500 dark:border-zinc-700"
    >
      + New deck
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight">Decks</h1>
          {totalCards > 0 && (
            <span className="text-sm text-zinc-500">{plural(totalCards, "card")}</span>
          )}
        </div>
        {totalDue + totalNew > 0 ? (
          <Link
            to="/review"
            className="flex items-center gap-2 rounded-full bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-500"
          >
            Study all
            <span className="text-xs font-medium text-sky-200 tabular-nums">
              {totalDue > 0 && `${totalDue} due`}
              {totalDue > 0 && totalNew > 0 && " · "}
              {totalNew > 0 && `${totalNew} new`}
            </span>
          </Link>
        ) : (
          totalCards > 0 && <span className="text-sm text-zinc-400">all done ✓</span>
        )}
      </div>

      {decks.length === 0 && (
        <div className="mb-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
          <p className="text-3xl">🗂️</p>
          <p className="mt-3">No decks yet — create one below, then{" "}
            <Link to="/new" className="font-medium text-sky-500">add a card</Link>.
          </p>
          <p className="mt-2 text-xs">
            Have existing cards? Configure sync in{" "}
            <Link to="/settings" className="text-sky-500">Settings</Link>.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {decks.map((deck) => (
          <Link
            key={deck.name}
            to={`/review/${encodeURIComponent(deck.name)}`}
            className="group flex flex-col justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:border-sky-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-sky-600"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: deckColor(deck.name) }}
                />
                {deck.name}
              </span>
              <span className="flex items-center gap-1">
                <button
                  onClick={(e) => void onDelete(e, deck.name, deck.total)}
                  title="Delete deck"
                  className="rounded-md p-1 text-zinc-300 opacity-60 transition-colors hover:bg-red-50 hover:text-red-500 hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950/50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </button>
                <span className="text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-sky-500 dark:text-zinc-600">
                  →
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {deck.due > 0 && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                  {deck.due} due
                </span>
              )}
              {deck.newCards > 0 && (
                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 font-medium text-sky-600 dark:text-sky-400">
                  {deck.newCards} new
                </span>
              )}
              {deck.due === 0 && deck.newCards === 0 && (
                <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-zinc-500">
                  done ✓
                  {deck.nextInDays !== undefined &&
                    ` · next ${deck.nextInDays === 1 ? "tomorrow" : `in ${deck.nextInDays}d`}`}
                </span>
              )}
              <span className="ml-auto text-zinc-400">{plural(deck.total, "card")}</span>
            </div>
          </Link>
        ))}
        {newDeckTile}
      </div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
