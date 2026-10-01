import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Markdown from "../components/Markdown";
import { useLiveQuery } from "dexie-react-hooks";
import { IconBrowse, IconTrash } from "../components/icons";
import { deleteCard } from "../lib/actions";
import { db } from "../lib/db";
import { deckColor } from "../lib/deck-color";
import { smarten } from "../lib/typography";

/** Rows rendered per step; more reveal as the sentinel scrolls into view. */
const PAGE = 150;

export default function Browser() {
  const [query, setQuery] = useState("");
  const [deckFilter, setDeckFilter] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 64rem)");
  const navigate = useNavigate();

  const decks = useLiveQuery(
    async () => (await db.decks.toArray()).map((d) => d.name).sort(),
    [],
    [] as string[]
  );

  // Search + filter run over every card; only rendering is progressive.
  const cards = useLiveQuery(async () => {
    const all = await db.cards.toArray();
    const states = await db.state.bulkGet(all.map((c) => c.id));
    const stateById = new Map(all.map((c, i) => [c.id, states[i]]));
    const q = query.toLowerCase();
    const now = Date.now();
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
      .map((c) => {
        const due = stateById.get(c.id)?.due;
        return { ...c, dueInDays: due === undefined ? null : Math.ceil((due - now) / 86_400_000) };
      });
  }, [query, deckFilter]);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const total = cards?.length ?? 0;
  const shown = useMemo(() => cards?.slice(0, limit) ?? [], [cards, limit]);
  const more = total > shown.length;
  // Wide screens read the selected card beside the list; it falls back to the
  // first row whenever the selection is filtered out.
  const selected = shown.find((c) => c.id === selectedId) ?? shown[0];

  // j/k or ↑/↓ walk the list, Enter opens the editor (wide layout only).
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = selected ? shown.indexOf(selected) : -1;
      const step = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (step) {
        e.preventDefault();
        const next = shown[Math.min(shown.length - 1, Math.max(0, i + step))];
        if (next) {
          setSelectedId(next.id);
          document.getElementById(`row-${next.id}`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Enter" && selected && t === document.body) {
        navigate(`/edit/${selected.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, shown, selected, navigate]);

  // Reveal the next page as the end of the list approaches.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE);
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit]);

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
    `flex h-10 shrink-0 items-center gap-1.5 rounded-full sm:h-9 border px-3.5 text-13 font-medium transition-colors ${
      active
        ? "border-accent-rule bg-accent-soft text-accent"
        : "border-hairline bg-paper text-ink-2 hover:border-hairline-strong hover:text-ink"
    }`;

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <h1 className="font-serif text-display font-semibold tracking-tight">Browse</h1>
        <span className="pb-1 text-13 tabular-nums text-muted" aria-live="polite">
          {more ? `${shown.length} of ${total}` : total} card{total === 1 ? "" : "s"}
          {wide && <span className="text-faint"> · j/k to move</span>}
        </span>
      </div>

      <label className="relative mb-3 block">
        <span className="sr-only">Search cards</span>
        <IconBrowse className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Search fronts, backs and decks…"
          className="h-11 w-full rounded-md border border-hairline bg-paper pl-9 pr-3 text-[0.9375rem] outline-none placeholder:text-faint focus:border-accent-rule"
        />
      </label>

      <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <button
          onClick={() => {
            setDeckFilter(null);
            setLimit(PAGE);
          }}
          aria-pressed={deckFilter === null}
          className={chip(deckFilter === null)}
        >
          All decks
        </button>
        {decks.map((d) => (
          <button
            key={d}
            onClick={() => {
              setDeckFilter(d);
              setLimit(PAGE);
            }}
            aria-pressed={deckFilter === d}
            className={chip(deckFilter === d)}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: deckColor(d) }} aria-hidden />
            {d}
          </button>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="min-w-0">
      {cards && total === 0 ? (
        <p className="index-card px-5 py-10 text-center text-sm text-muted">
          {query || deckFilter ? "No cards match." : "No cards yet."}
        </p>
      ) : (
        <ul className="index-card divide-y divide-hairline overflow-hidden">
          {shown.map((card) => (
            <li
              key={card.id}
              id={`row-${card.id}`}
              aria-current={wide && card.id === selected?.id ? "true" : undefined}
              className="group relative flex items-center gap-3 pr-2 transition-colors hover:bg-sunken/50 aria-[current]:bg-accent-soft/60"
            >
              <span
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ backgroundColor: deckColor(card.deck) }}
                aria-hidden
              />
              <Link
                to={`/edit/${card.id}`}
                onClick={(e) => {
                  if (!wide) return;
                  e.preventDefault(); // wide: select into the reading pane; double-click edits
                  setSelectedId(card.id);
                }}
                onDoubleClick={() => wide && navigate(`/edit/${card.id}`)}
                className="min-w-0 flex-1 py-3 pl-4"
              >
                <div className="line-clamp-2 text-pretty font-serif text-[0.9875rem] leading-snug text-ink">
                  {smarten(previewLine(card.front)).text}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">{card.deck}</div>
              </Link>
              <DueBadge days={card.dueInDays} />
              {!wide && <button
                onClick={() => void onDelete(card.id)}
                aria-label={confirmId === card.id ? "Confirm delete" : "Delete card"}
                className={`flex h-10 min-w-10 shrink-0 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors sm:h-8 sm:px-2.5 ${
                  confirmId === card.id
                    ? "bg-danger-fill text-white"
                    : "text-muted hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                }`}
              >
                {confirmId === card.id ? (
                  "Confirm?"
                ) : (
                  <>
                    <IconTrash className="h-4 w-4 sm:hidden" />
                    <span className="hidden sm:inline">Delete</span>
                  </>
                )}
              </button>}
            </li>
          ))}
        </ul>
      )}

      {more && (
        <div ref={sentinelRef} className="mt-4 flex justify-center">
          <button
            onClick={() => setLimit((l) => l + PAGE)}
            className="h-10 rounded-md border border-hairline bg-paper px-4 text-sm font-medium text-ink-2 hover:border-hairline-strong"
          >
            Show more · {total - shown.length} left
          </button>
        </div>
      )}
      </div>

      {wide && selected && (
        <CardPane card={selected} armed={confirmId === selected.id} onDelete={() => void onDelete(selected.id)} />
      )}
      </div>
    </div>
  );
}

/** The selected card, rendered as it reads in review, with its schedule. */
function CardPane({
  card,
  armed,
  onDelete,
}: {
  card: { id: string; deck: string; front: string; back: string; dueInDays: number | null };
  armed: boolean;
  onDelete: () => void;
}) {
  return (
    <article
      className="index-card index-card--ruled sticky top-[5.5rem] max-h-[calc(100dvh-7rem)] overflow-y-auto px-8 pb-8 pt-5"
      style={{ "--card-rule": deckColor(card.deck) } as React.CSSProperties}
      aria-label="Selected card"
    >
      <div className="mb-5 flex items-center gap-3">
        <span className="label-caps flex min-w-0 items-center gap-1.5 text-muted">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: deckColor(card.deck) }} aria-hidden />
          <span className="truncate">{card.deck}</span>
        </span>
        <span className="text-13 text-muted">{dueText(card.dueInDays)}</span>
        <button
          onClick={onDelete}
          aria-label={armed ? "Confirm delete" : "Delete card"}
          className={`ml-auto flex h-8 items-center gap-1.5 rounded-md px-2.5 text-13 font-medium transition-colors ${
            armed ? "bg-danger-fill text-white" : "text-muted hover:bg-danger-soft hover:text-danger"
          }`}
        >
          {armed ? "Confirm?" : <><IconTrash className="h-3.5 w-3.5" />Delete</>}
        </button>
        <Link
          to={`/edit/${card.id}`}
          title="Edit (Enter)"
          className="flex h-8 items-center gap-2 rounded-md border border-hairline px-3 text-13 font-medium text-ink-2 transition-colors hover:border-hairline-strong hover:text-ink"
        >
          Edit
          <kbd className="font-sans text-2xs text-faint" aria-hidden>↵</kbd>
        </Link>
      </div>
      <Markdown text={card.front} className="card-front" />
      <div className="answer-rule label-caps mb-5 mt-7">Answer</div>
      <Markdown text={card.back} className="card-back" />
    </article>
  );
}

function dueText(days: number | null): string {
  if (days === null) return "New, not studied yet";
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    on();
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** `days` until due; null = never reviewed. */
function DueBadge({ days }: { days: number | null }) {
  const base = "shrink-0 rounded-[4px] px-1.5 py-0.5 text-2xs tabular-nums";
  const tag = `${base} font-semibold uppercase tracking-wide`;
  if (days === null) return <span className={`${tag} bg-accent-soft text-accent`}>New</span>;
  if (days <= 0) return <span className={`${tag} bg-ok-soft text-ok`}>Due</span>;
  return <span className={`${base} font-medium text-muted`}>{days}d</span>;
}

/** First line of the front, without markdown punctuation — rows are a scan, not a render. */
function previewLine(front: string): string {
  const line = front.split("\n").find((l) => l.trim() !== "") ?? "";
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`|\$)/g, "")
    .trim();
}
