import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { createDeck } from "../lib/actions";
import { db } from "../lib/db";
import { deckCounts } from "../lib/scheduler";
import { syncAll } from "../lib/sync";

export default function Decks() {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  async function onCreate() {
    if (!name.trim()) return;
    await createDeck(name);
    setName("");
    setAdding(false);
    void syncAll();
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

  const newDeckControl = adding ? (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onCreate();
      }}
      className="flex gap-2"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
        placeholder="Deck name"
        className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={!name.trim()}
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setAdding(false)}
        className="rounded-lg px-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        ✕
      </button>
    </form>
  ) : (
    <button
      onClick={() => setAdding(true)}
      className="w-full rounded-xl border border-dashed border-zinc-300 py-3 text-sm text-zinc-500 transition-colors hover:border-sky-400 hover:text-sky-500 dark:border-zinc-700"
    >
      + New deck
    </button>
  );

  if (decks.length === 0) {
    return (
      <div className="space-y-6">
        {newDeckControl}
        <div className="mt-10 text-center text-zinc-500">
          <p className="text-4xl">🗂️</p>
          <p className="mt-4">No cards yet.</p>
          <Link to="/new" className="mt-2 inline-block font-medium text-sky-500">
            Add your first card →
          </Link>
          <p className="mt-6 text-sm">
            (If you have existing cards, configure sync in{" "}
            <Link to="/settings" className="text-sky-500">Settings</Link>.)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
    <ul className="space-y-2">
      {decks.map((deck) => (
        <li key={deck.name}>
          <Link
            to={`/review/${encodeURIComponent(deck.name)}`}
            className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-sky-400 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-sky-600"
          >
            <div>
              <div className="font-medium">{deck.name}</div>
              <div className="text-xs text-zinc-500">{deck.total} cards</div>
            </div>
            <div className="flex gap-3 text-sm tabular-nums">
              {deck.due > 0 && (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {deck.due} due
                </span>
              )}
              {deck.newCards > 0 && (
                <span className="font-semibold text-sky-600 dark:text-sky-400">
                  {deck.newCards} new
                </span>
              )}
              {deck.due === 0 && deck.newCards === 0 && (
                <span className="text-zinc-400">done ✓</span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
    {newDeckControl}
    </div>
  );
}
