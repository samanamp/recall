import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { deleteCard } from "../lib/actions";
import { db } from "../lib/db";
import { deckColor } from "../lib/deck-color";

export default function Browser() {
  const [query, setQuery] = useState("");
  const [deckFilter, setDeckFilter] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const decks = useLiveQuery(
    async () => (await db.decks.toArray()).map((d) => d.name).sort(),
    [],
    [] as string[]
  );

  const cards = useLiveQuery(async () => {
    const all = await db.cards.toArray();
    const states = await db.state.bulkGet(all.map((c) => c.id));
    const stateById = new Map(all.map((c, i) => [c.id, states[i]]));
    const q = query.toLowerCase();
    return all
      .filter(
        (c) =>
          (!deckFilter || c.deck === deckFilter) &&
          (!q ||
            c.front.toLowerCase().includes(q) ||
            c.back.toLowerCase().includes(q) ||
            c.deck.toLowerCase().includes(q))
      )
      .sort((a, b) => b.id.localeCompare(a.id)) // ULIDs sort by creation time
      .map((c) => ({ ...c, due: stateById.get(c.id)?.due ?? null }));
  }, [query, deckFilter]);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  async function onDelete(id: string) {
    if (confirmId !== id) {
      // first tap arms the button; it disarms itself after 3s
      setConfirmId(id);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    setConfirmId(null);
    await deleteCard(id);
  }

  const chip = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300"
        : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300"
    }`;

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search cards…"
        className="mb-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-500 dark:border-zinc-800 dark:bg-zinc-900/70"
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button onClick={() => setDeckFilter(null)} className={chip(deckFilter === null)}>
          All
        </button>
        {decks.map((d) => (
          <button key={d} onClick={() => setDeckFilter(d)} className={chip(deckFilter === d)}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: deckColor(d) }} />
            {d}
          </button>
        ))}
      </div>

      <div className="mb-2 text-xs text-zinc-500">{cards?.length ?? 0} cards</div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {cards?.map((card) => (
          <li key={card.id} className="flex items-center gap-3 py-2">
            <Link to={`/edit/${card.id}`} className="min-w-0 flex-1">
              <div className="truncate text-sm">{card.front.split("\n")[0]}</div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: deckColor(card.deck) }}
                />
                {card.deck}
              </div>
            </Link>
            <DueBadge due={card.due} />
            <button
              onClick={() => void onDelete(card.id)}
              className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
                confirmId === card.id
                  ? "bg-red-600 font-semibold text-white"
                  : "text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
              }`}
            >
              {confirmId === card.id ? "confirm?" : "delete"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DueBadge({ due }: { due: number | null }) {
  if (due === null) {
    return (
      <span className="shrink-0 rounded-full bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-600 dark:text-accent-400">
        new
      </span>
    );
  }
  const days = Math.ceil((due - Date.now()) / 86_400_000);
  if (days <= 0) {
    return (
      <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        due
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs tabular-nums text-zinc-500">
      {days}d
    </span>
  );
}
