import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "../components/Markdown";
import { recordReview, undoReview, type ReviewUndo } from "../lib/actions";
import { db, type CardRow } from "../lib/db";
import { deckColor } from "../lib/deck-color";
import { buildAheadQueue, buildQueue, previewIntervals } from "../lib/scheduler";

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
  const deckParam = useParams().deck;
  const deck = deckParam ? decodeURIComponent(deckParam) : null; // null = all decks
  const [queue, setQueue] = useState<string[] | null>(null);
  const [card, setCard] = useState<CardRow | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [intervals, setIntervals] = useState<Record<1 | 2 | 3 | 4, string> | null>(null);
  const [done, setDone] = useState(0);
  const [ahead, setAhead] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<ReviewUndo[]>([]);

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
      setAhead(await buildAheadQueue(deck, new Date()));
    }
  }, [deck]);

  useEffect(() => {
    void buildQueue(deck, new Date()).then(loadNext);
  }, [deck, loadNext]);

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || !queue) return;
      const undo = await recordReview(card.id, rating);
      setUndoStack((s) => [...s.slice(-49), undo]);
      setDone((d) => d + 1);
      await loadNext(queue.slice(1));
    },
    [card, queue, loadNext]
  );

  /** Reverse the last rating and bring that card back, answer shown. */
  const onUndo = useCallback(async () => {
    const undo = undoStack[undoStack.length - 1];
    if (!undo) return;
    setUndoStack((s) => s.slice(0, -1));
    await undoReview(undo);
    setDone((d) => Math.max(0, d - 1));
    await loadNext([undo.cardId, ...(queue ?? [])]);
    setRevealed(true);
  }, [undoStack, queue, loadNext]);

  // Keyboard: space/enter reveals, 1-4 rates, z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        void onUndo();
      } else if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        void rate(Number(e.key) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate, onUndo]);

  if (queue === null) return null;

  if (!card) {
    return (
      <div className="mt-16 text-center">
        <p className="text-4xl">🎉</p>
        <p className="mt-4 text-lg font-medium">
          {done > 0 ? "Deck finished" : "Nothing due"}
        </p>
        <p className="text-sm text-zinc-500">{done} reviews this session</p>
        {undoStack.length > 0 && (
          <button
            onClick={() => void onUndo()}
            className="mt-2 text-xs text-zinc-400 hover:text-sky-500"
          >
            ↩ undo last rating
          </button>
        )}
        {ahead.length > 0 && (
          <button
            onClick={() => void loadNext(ahead)}
            className="mt-5 rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:border-sky-400 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-sky-600"
          >
            Study ahead — {ahead.length} due in the next 7 days
          </button>
        )}
        <div>
          <Link to="/" className="mt-4 inline-block text-sky-500">← Back to decks</Link>
        </div>
      </div>
    );
  }

  const total = done + queue.length;
  const progress = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="flex min-h-[calc(100dvh-9.5rem)] flex-col sm:min-h-[calc(100dvh-7.5rem)]">
      {/* deck + session progress */}
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <span className="flex items-center gap-1.5 font-medium">
          {deck && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: deckColor(deck) }}
            />
          )}
          {deck ?? "all decks"}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-sky-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="tabular-nums">{queue.length} left</span>
      </div>

      {/* the card is the hero: centered in the free space, scrolls if long */}
      <div className="flex flex-1 items-center py-4">
        <div
          onClick={() => {
            // tap anywhere on the card to reveal (unless selecting text)
            if (!revealed && !window.getSelection()?.toString()) setRevealed(true);
          }}
          className={`w-full rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900/70 ${
            revealed ? "" : "cursor-pointer"
          }`}
        >
          {deck === null && (
            <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: deckColor(card.deck) }}
              />
              {card.deck}
            </div>
          )}
          <Markdown text={card.front} className="prose-lg" />
          {revealed && (
            <div className="answer-reveal">
              <div className="my-4 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                answer
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <Markdown text={card.back} />
            </div>
          )}
        </div>
      </div>

      {/* controls live in a fixed-height slot so nothing jumps on reveal */}
      <div className="mx-auto flex h-20 w-full max-w-xl flex-col justify-start">
        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="h-12 w-full rounded-xl bg-sky-600 font-semibold text-white shadow-sm transition-colors hover:bg-sky-500"
          >
            Show answer
          </button>
        ) : (
          <div className="grid h-12 grid-cols-4 gap-2">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                onClick={() => void rate(r.value)}
                className={`flex flex-col items-center justify-center rounded-xl border leading-tight transition-colors ${r.cls}`}
              >
                <span className="text-sm font-semibold">{r.label}</span>
                <span className="text-[11px] tabular-nums opacity-60">
                  {intervals?.[r.value]}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 text-center text-xs text-zinc-400">
          {undoStack.length > 0 && (
            <>
              <button onClick={() => void onUndo()} className="hover:text-sky-500">
                ↩ undo
              </button>
              {" · "}
            </>
          )}
          <Link to={`/edit/${card.id}`} className="hover:text-sky-500">edit card</Link>
          <span className="hidden sm:inline"> · space reveal · 1–4 rate · z undo</span>
        </div>
      </div>
    </div>
  );
}
