import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { deckCounts } from "../lib/scheduler";

export default function Decks() {
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

  if (decks.length === 0) {
    return (
      <div className="mt-16 text-center text-zinc-500">
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
    );
  }

  return (
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
  );
}
