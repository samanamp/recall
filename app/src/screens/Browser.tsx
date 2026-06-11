import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { deleteCard } from "../lib/actions";
import { db } from "../lib/db";

export default function Browser() {
  const [query, setQuery] = useState("");

  const cards = useLiveQuery(async () => {
    const all = await db.cards.toArray();
    const q = query.toLowerCase();
    return all
      .filter(
        (c) =>
          !q ||
          c.front.toLowerCase().includes(q) ||
          c.back.toLowerCase().includes(q) ||
          c.deck.toLowerCase().includes(q)
      )
      .sort((a, b) => b.id.localeCompare(a.id)); // ULIDs sort by creation time
  }, [query]);

  async function onDelete(id: string) {
    if (!confirm("Delete this card? The file is removed from your repo too.")) return;
    await deleteCard(id);
  }

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search cards…"
        className="mb-3 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700"
      />
      <div className="mb-2 text-xs text-zinc-500">{cards?.length ?? 0} cards</div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {cards?.map((card) => (
          <li key={card.id} className="flex items-center gap-3 py-2">
            <Link to={`/edit/${card.id}`} className="min-w-0 flex-1">
              <div className="truncate text-sm">{card.front.split("\n")[0]}</div>
              <div className="text-xs text-zinc-500">{card.deck}</div>
            </Link>
            <button
              onClick={() => void onDelete(card.id)}
              className="shrink-0 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
            >
              delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
