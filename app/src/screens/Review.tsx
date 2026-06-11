import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "../components/Markdown";
import { recordReview } from "../lib/actions";
import { db, type CardRow } from "../lib/db";
import { buildQueue, previewIntervals } from "../lib/scheduler";
import { syncAll } from "../lib/sync";

const RATINGS = [
  {
    value: 1,
    label: "Again",
    cls: "border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400",
  },
  {
    value: 2,
    label: "Hard",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400",
  },
  {
    value: 3,
    label: "Good",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400",
  },
  {
    value: 4,
    label: "Easy",
    cls: "border-sky-500/30 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 dark:text-sky-400",
  },
] as const;

export default function Review() {
  const deck = decodeURIComponent(useParams().deck ?? "");
  const [queue, setQueue] = useState<string[] | null>(null);
  const [card, setCard] = useState<CardRow | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [intervals, setIntervals] = useState<Record<1 | 2 | 3 | 4, string> | null>(null);
  const [done, setDone] = useState(0);

  const loadNext = useCallback(async (q: string[]) => {
    // Skip ids whose card was deleted meanwhile.
    while (q.length > 0) {
      const next = await db.cards.get(q[0]);
      if (next) {
        setQueue(q);
        setCard(next);
        setRevealed(false);
        setIntervals(previewIntervals(await db.state.get(next.id), new Date()));
        return;
      }
      q = q.slice(1);
    }
    // Queue exhausted — cards rated Again may already be due again.
    const rebuilt = await buildQueue(deck, new Date());
    if (rebuilt.length > 0) {
      void loadNext(rebuilt);
    } else {
      setQueue([]);
      setCard(null);
      void syncAll();
    }
  }, [deck]);

  useEffect(() => {
    void buildQueue(deck, new Date()).then(loadNext);
  }, [deck, loadNext]);

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || !queue) return;
      await recordReview(card.id, rating);
      setDone((d) => d + 1);
      await loadNext(queue.slice(1));
    },
    [card, queue, loadNext]
  );

  // Keyboard: space/enter reveals, 1-4 rates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        void rate(Number(e.key) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate]);

  if (queue === null) return null;

  if (!card) {
    return (
      <div className="mt-16 text-center">
        <p className="text-4xl">🎉</p>
        <p className="mt-4 text-lg font-medium">Deck finished</p>
        <p className="text-sm text-zinc-500">{done} reviews this session</p>
        <Link to="/" className="mt-4 inline-block text-sky-500">← Back to decks</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-baseline justify-between text-sm text-zinc-500">
        <span>{deck}</span>
        <span className="tabular-nums">{queue.length} left</span>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
        <Markdown text={card.front} />
        {revealed && (
          <>
            <div className="my-6 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              answer
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <Markdown text={card.back} />
          </>
        )}
      </div>

      <div className="mt-4">
        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="w-full rounded-xl bg-sky-600 py-3.5 font-semibold text-white shadow-sm transition-colors hover:bg-sky-500"
          >
            Show answer
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                onClick={() => void rate(r.value)}
                className={`rounded-xl border py-2.5 transition-colors ${r.cls}`}
              >
                <div className="text-sm font-semibold">{r.label}</div>
                <div className="text-xs tabular-nums opacity-60">{intervals?.[r.value]}</div>
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 text-center text-xs text-zinc-400">
          <Link to={`/edit/${card.id}`} className="hover:text-sky-500">edit card</Link>
          <span className="hidden sm:inline"> · space to reveal · 1–4 to rate</span>
        </div>
      </div>
    </div>
  );
}
