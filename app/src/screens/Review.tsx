import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "../components/Markdown";
import { MarkIllustration } from "../components/Mark";
import {
  PUSH_BACK_BY,
  pushBack,
  recordReview,
  setCardArchived,
  undoPushBack,
  undoReview,
  type PushBackUndo,
  type ReviewUndo,
} from "../lib/actions";
import { db, type CardRow } from "../lib/db";
import { deckColor } from "../lib/deck-color";
import { buildAheadQueue, buildQueue, previewIntervals } from "../lib/scheduler";

/** Semantic rating keys: tinted stock + dark ink (light), inverse (dark). Tokens in index.css. */
const RATINGS = [
  { value: 1, label: "Again", cls: "bg-[var(--again-bg)] border-[var(--again-bd)] text-[var(--again-ink)]" },
  { value: 2, label: "Hard", cls: "bg-[var(--hard-bg)] border-[var(--hard-bd)] text-[var(--hard-ink)]" },
  { value: 3, label: "Good", cls: "bg-[var(--good-bg)] border-[var(--good-bd)] text-[var(--good-ink)]" },
  { value: 4, label: "Easy", cls: "bg-[var(--easy-bg)] border-[var(--easy-bd)] text-[var(--easy-ink)]" },
] as const;

const kbd =
  "h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-[3px] border border-current/25 px-1 font-sans text-2xs font-semibold leading-none";

/** One undoable step of a session: a rating, or a new card shown later. */
type SessionUndo =
  | { kind: "review"; undo: ReviewUndo }
  | { kind: "later"; undo: PushBackUndo }
  | { kind: "archive"; undo: { cardId: string } };

export default function Review() {
  const deckParam = useParams().deck;
  const deck = deckParam ? decodeURIComponent(deckParam) : null; // null = all decks
  const [queue, setQueue] = useState<string[] | null>(null);
  const [card, setCard] = useState<CardRow | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [intervals, setIntervals] = useState<Record<1 | 2 | 3 | 4, string> | null>(null);
  const [done, setDone] = useState(0);
  const [ahead, setAhead] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<SessionUndo[]>([]);
  // "Show later" moves a new card; a card in review restarts as new.
  const [isNew, setIsNew] = useState(false);
  // One rating (or undo) at a time: a fast double tap/click or a held key
  // must never record two reviews for the same card.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const flash = useCallback((text: string) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 4000);
  }, []);

  const loadNext = useCallback(
    async (initial: string[]) => {
      let q = initial;
      for (;;) {
        // Skip ids whose card was deleted meanwhile.
        while (q.length > 0) {
          const next = await db.cards.get(q[0]);
          if (next) {
            setQueue(q);
            setCard(next);
            setRevealed(false);
            const state = await db.state.get(next.id);
            setIsNew(!state);
            setIntervals(previewIntervals(state, new Date()));
            window.scrollTo({ top: 0 }); // long cards leave the page scrolled down
            return;
          }
          q = q.slice(1);
        }
        // Queue exhausted — cards rated Again may already be due again.
        q = await buildQueue(deck, new Date());
        if (q.length === 0) break;
      }
      setQueue([]);
      setCard(null);
      setAhead(await buildAheadQueue(deck, new Date()));
    },
    [deck]
  );

  useEffect(() => {
    void buildQueue(deck, new Date()).then(loadNext);
  }, [deck, loadNext]);

  /** Run one rating/undo exclusively; concurrent calls are dropped. */
  const exclusive = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const rate = useCallback(
    (rating: 1 | 2 | 3 | 4) =>
      exclusive(async () => {
        if (!card || !queue) return;
        const undo = await recordReview(card.id, rating);
        setUndoStack((s) => [...s.slice(-49), { kind: "review", undo }]);
        setDone((d) => d + 1);
        await loadNext(queue.slice(1));
      }),
    [card, queue, loadNext, exclusive]
  );

  /** Show this card PUSH_BACK_BY new cards from now (see pushBack). */
  const later = useCallback(
    () =>
      exclusive(async () => {
        if (!card || !queue) return;
        const undo = await pushBack(card.id, deck);
        if (!undo) {
          flash("Already the last new card");
          return;
        }
        setUndoStack((s) => [...s.slice(-49), { kind: "later", undo }]);
        flash(
          undo.kind === "reset"
            ? `Restarted as a new card, ${PUSH_BACK_BY} cards from now`
            : `Moved ${PUSH_BACK_BY} cards later`
        );
        await loadNext(queue.slice(1));
      }),
    [card, queue, deck, loadNext, exclusive, flash]
  );

  /** Take this card out of study; it stays in Browse with its history. */
  const archive = useCallback(
    () =>
      exclusive(async () => {
        if (!card || !queue) return;
        await setCardArchived(card.id, true);
        setUndoStack((s) => [...s.slice(-49), { kind: "archive", undo: { cardId: card.id } }]);
        flash("Archived · restore it from Browse");
        await loadNext(queue.slice(1));
      }),
    [card, queue, loadNext, exclusive, flash]
  );

  /** Reverse the last step (rating, "later", archive) and bring that card back, answer shown. */
  const onUndo = useCallback(
    () =>
      exclusive(async () => {
        const step = undoStack[undoStack.length - 1];
        if (!step) return;
        setUndoStack((s) => s.slice(0, -1));
        if (step.kind === "later") {
          await undoPushBack(step.undo);
          setNote(null);
        } else if (step.kind === "archive") {
          await setCardArchived(step.undo.cardId, false);
          setNote(null);
        } else {
          // Newer sync engines report where the undo landed; "queued" = offline.
          const res: unknown = await undoReview(step.undo);
          if ((res as { status?: unknown } | undefined)?.status === "queued") {
            flash("Undone here — it syncs when you're back online");
          }
          setDone((d) => Math.max(0, d - 1));
        }
        await loadNext([step.undo.cardId, ...(queue ?? [])]);
        setRevealed(true);
      }),
    [undoStack, queue, loadNext, exclusive, flash]
  );

  // Keyboard: space/enter reveals, 1-4 rates, l shows later, a archives, z undoes. Held keys (auto-repeat)
  // and modified keys (⌘1 switches browser tabs, ⌘Z is the editor's) are ignored.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const ours =
        key === "z" || key === "l" || key === "a" || key === " " || key === "enter" || ["1", "2", "3", "4"].includes(key);
      if (!ours) return;
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      if (key === "z") {
        e.preventDefault();
        void onUndo();
      } else if (key === "l") {
        e.preventDefault();
        void later();
      } else if (key === "a") {
        e.preventDefault();
        void archive();
      } else if (!revealed && (key === " " || key === "enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(key)) {
        e.preventDefault();
        void rate(Number(key) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate, onUndo, later, archive]);

  if (queue === null) return null;

  if (!card) {
    return (
      <div className="mx-auto max-w-md pt-6 text-center sm:pt-12">
        <MarkIllustration className="mx-auto h-24 w-32" />
        <h1 className="mt-6 font-serif text-2xl font-semibold tracking-tight">
          {done > 0 ? "Deck finished" : "Nothing due"}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {done > 0
            ? `${done} review${done === 1 ? "" : "s"} this session. Nicely done.`
            : deck
              ? `Every card in ${deck} is scheduled for later.`
              : "Every card is scheduled for later."}
        </p>
        <div className="mt-6 flex flex-col items-center gap-2">
          {ahead.length > 0 && (
            <button
              onClick={() => void loadNext(ahead)}
              className="h-11 rounded-md border border-hairline-strong bg-paper px-5 text-sm font-semibold text-ink transition-colors hover:border-accent-rule hover:text-accent"
            >
              Study ahead · {ahead.length} due in the next 7 days
            </button>
          )}
          {undoStack.length > 0 && (
            <button
              onClick={() => void onUndo()}
              disabled={busy}
              className="inline-flex h-10 items-center px-3 text-13 text-muted hover:text-accent"
            >
              ↩ Undo last step
            </button>
          )}
          <Link to="/" className="inline-flex h-10 items-center px-3 text-sm font-medium text-accent hover:underline">
            ← Back to decks
          </Link>
        </div>
      </div>
    );
  }

  const total = done + queue.length;
  const position = Math.min(done + 1, total);

  return (
    <div className="mx-auto max-w-[46rem] pb-28 sm:pb-0">
      {/* deck + session progress */}
      <div className="mb-3 flex items-baseline gap-3">
        <span className="label-caps flex min-w-0 items-center gap-2 text-muted">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: deck ? deckColor(deck) : "var(--accent-rule)" }}
            aria-hidden
          />
          <span className="truncate">{deck ?? "All decks"}</span>
        </span>
        <span className="ml-auto shrink-0 text-13 tabular-nums text-muted" aria-live="polite">
          <span className="font-semibold text-ink">{position}</span> of {total}
        </span>
      </div>
      <Progress done={done} total={total} />

      {/* The card is pinned to the top: revealing only extends it downward. */}
      <div className="relative isolate mt-5">
        <div
          data-stack={Math.min(2, queue.length - 1)}
          role={revealed ? undefined : "button"}
          tabIndex={revealed ? undefined : -1}
          aria-label={revealed ? undefined : "Show answer"}
          onClick={() => {
            // tap anywhere on the card to reveal (unless selecting text)
            if (!revealed && !window.getSelection()?.toString()) setRevealed(true);
          }}
          className={`index-card index-card--ruled card-stack flex min-h-[min(22rem,52dvh)] flex-col px-5 pb-6 pt-5 sm:min-h-[14rem] sm:px-12 sm:pb-11 sm:pt-8 ${
            revealed ? "" : "cursor-pointer"
          }`}
        >
          {deck === null && (
            <div className="label-caps mb-4 flex items-center gap-1.5 text-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: deckColor(card.deck) }} aria-hidden />
              {card.deck}
            </div>
          )}
          <Markdown text={card.front} className="card-front" />
          {revealed && (
            <div className="answer-reveal">
              <div className="answer-rule label-caps mb-5 mt-7 sm:mb-6 sm:mt-9">Answer</div>
              <Markdown text={card.back} className="card-back" />
            </div>
          )}
          {!revealed && (
            <p className="label-caps mt-auto pt-6 text-center text-muted sm:hidden" aria-hidden>
              Tap to turn over
            </p>
          )}
        </div>
      </div>

      {/* Controls: fixed above the tab bar on phones (thumb reach), right
          under the card on desktop — sticky so long answers keep them in view. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-hairline bg-desk/95 px-4 pb-1 pt-3 backdrop-blur-md sm:sticky sm:inset-x-auto sm:bottom-0 sm:mt-6 sm:border-0 sm:bg-desk sm:px-0 sm:backdrop-blur-none sm:pb-4 sm:pt-3">
        <div className="mx-auto max-w-[46rem]">
          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-md bg-accent-fill text-[0.9375rem] font-semibold text-on-accent transition-colors hover:bg-accent-fill-hover"
            >
              Show answer
              <span className={`${kbd} hidden opacity-80 sm:inline-flex`} aria-hidden>Space</span>
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Rate this card">
              {RATINGS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => void rate(r.value)}
                  disabled={busy}
                  aria-label={`${r.label}${intervals ? `, next in ${intervals[r.value]}` : ""} (key ${r.value})`}
                  className={`relative flex h-14 flex-col items-center justify-center rounded-md border leading-tight transition-[filter,transform] hover:brightness-[0.96] active:translate-y-px disabled:cursor-wait dark:hover:brightness-110 ${r.cls}`}
                >
                  <span className={`${kbd} absolute left-1.5 top-1.5 hidden opacity-70 sm:inline-flex`} aria-hidden>
                    {r.value}
                  </span>
                  <span className="text-[0.9375rem] font-semibold">{r.label}</span>
                  <span className="mt-0.5 text-xs font-medium tabular-nums">{intervals?.[r.value] ?? " "}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center justify-center text-xs text-muted">
            {undoStack.length > 0 && (
              <>
                <button
                  onClick={() => void onUndo()}
                  disabled={busy}
                  className="inline-flex h-10 items-center px-2 hover:text-accent sm:h-8"
                >
                  ↩ Undo
                </button>
                <span aria-hidden>·</span>
              </>
            )}
            <button
              onClick={() => void later()}
              disabled={busy}
              title={
                isNew
                  ? `Show this card after the next ${PUSH_BACK_BY} new cards (L)`
                  : `Restart this card as new, after the next ${PUSH_BACK_BY} new cards (L)`
              }
              className="inline-flex h-10 items-center px-2 hover:text-accent sm:h-8"
            >
              Show later
            </button>
            <span aria-hidden>·</span>
            <button
              onClick={() => void archive()}
              disabled={busy}
              title="Stop studying this card; it stays in Browse with its history (A)"
              className="inline-flex h-10 items-center px-2 hover:text-accent sm:h-8"
            >
              Archive
            </button>
            <span aria-hidden>·</span>
            <Link to={`/edit/${card.id}`} className="inline-flex h-10 items-center px-2 hover:text-accent sm:h-8">
              Edit card
            </Link>
            {note ? (
              <>
                <span aria-hidden className="hidden sm:inline">·</span>
                {/* own line on phones, so a wrap never strands a separator */}
                <span role="status" className="basis-full px-2 text-center sm:basis-auto">{note}</span>
              </>
            ) : (
              <span className="hidden items-center sm:inline-flex" aria-hidden>
                ·<span className="px-2">space reveal · 1–4 rate · l later · a archive · z undo</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Slim progress: one segment per card for short sessions, a bar for long ones. */
function Progress({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  if (total <= 40) {
    return (
      <div className="flex h-1 gap-[3px]" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-full flex-1 rounded-full transition-colors duration-300 ${
              i < done ? "bg-accent-rule" : i === done ? "bg-accent-rule/35" : "bg-hairline"
            }`}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="h-1 overflow-hidden rounded-full bg-hairline" aria-hidden>
      <div
        className="h-full rounded-full bg-accent-rule transition-[width] duration-300"
        style={{ width: `${(done / total) * 100}%` }}
      />
    </div>
  );
}
