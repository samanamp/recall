import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { MarkIllustration } from "../components/Mark";
import { IconTrash } from "../components/icons";
import { createDeck, deleteDeck, setDeckArchived } from "../lib/actions";
import { archivedDecks, db, kvGet } from "../lib/db";
import { deckColor } from "../lib/deck-color";
import { deckCounts, newBudget } from "../lib/scheduler";
import { loadOutlook } from "../lib/outlook";
import { CollectionMix, ForecastBars, MixBar } from "../components/Outlook";
import type { Mix } from "../lib/outlook";

export default function Decks() {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  async function onCreate() {
    if (!name.trim()) return;
    await createDeck(name);
    setName("");
    setAdding(false);
  }

  async function onDelete(deck: string, total: number) {
    const what = total > 0 ? `"${deck}" and its ${total} card${total === 1 ? "" : "s"}` : `"${deck}"`;
    if (!confirm(`Delete ${what}?\n\nFiles are removed from your repo (git history keeps them recoverable).`)) {
      return;
    }
    await deleteDeck(deck);
  }

  // Default true so configured devices never flash the connect banner.
  const configured = useLiveQuery(
    async () => Boolean(await kvGet<string>("appToken")),
    [],
    true
  );

  const decks = useLiveQuery(async () => {
    const now = new Date();
    const [counts, budget, archived] = await Promise.all([
      deckCounts(now),
      newBudget(now),
      archivedDecks(),
    ]);
    const totals = new Map<string, number>();
    for (const c of await db.cards.toArray()) {
      if (c.archived) continue; // archived cards sit out of every count
      totals.set(c.deck, (totals.get(c.deck) ?? 0) + 1);
    }
    // Show new counts the queue will actually serve today (budget-capped),
    // so tiles never advertise cards a session won't deliver.
    const all = [...counts.entries()]
      .map(([name, c]) => ({
        name,
        ...c,
        newCards: Math.min(c.newCards, budget),
        newAvailable: c.newCards,
        total: totals.get(name) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Archived decks sit out: no tile, and nothing of theirs in today's totals.
    const list = all.filter((d) => !archived.has(d.name));
    return {
      budget,
      list,
      // Work first: decks with cards waiting get tiles, the rest a quiet row.
      waiting: list.filter((d) => d.due + d.newCards > 0),
      idle: list.filter((d) => d.due + d.newCards === 0),
      archived: all.filter((d) => archived.has(d.name)),
    };
  }, []);

  const outlook = useLiveQuery(async () => loadOutlook(new Date(), 14, await archivedDecks()), []);
  const now = new Date();

  if (!decks) return null;

  const nextInDays = decks.list.reduce<number | undefined>(
    (m, d) => (d.nextInDays !== undefined && (m === undefined || d.nextInDays < m) ? d.nextInDays : m),
    undefined
  );

  const totalCards = decks.list.reduce((n, d) => n + d.total, 0);
  const totalDue = decks.list.reduce((n, d) => n + d.due, 0);
  const newAvailable = decks.list.reduce((n, d) => n + d.newAvailable, 0);
  const totalNew = Math.min(decks.budget, newAvailable);

  const newDeckTile = adding ? (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onCreate();
      }}
      className="index-card flex flex-wrap items-center gap-3 border-accent-rule p-3 pl-4"
    >
      <label className="label-caps shrink-0 text-muted" htmlFor="new-deck-name">
        New deck
      </label>
      <input
        id="new-deck-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
        placeholder="Deck name"
        className="min-w-0 flex-1 border-b border-hairline-strong bg-transparent pb-1 font-serif text-lg outline-none placeholder:text-faint focus:border-accent-rule"
      />
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => setAdding(false)}
          className="h-10 rounded-md px-3 text-sm font-medium text-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="h-10 rounded-md bg-accent-fill px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-fill-hover disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </form>
  ) : (
    <button
      onClick={() => setAdding(true)}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-hairline-strong text-sm font-medium text-muted transition-colors hover:border-accent-rule hover:bg-paper/60 hover:text-accent"
    >
      <span className="text-lg leading-none" aria-hidden>+</span>
      New deck
    </button>
  );

  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <aside className="space-y-4 lg:sticky lg:top-[5.5rem] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        {configured && totalCards > 0 && (
          <TodayPanel due={totalDue} fresh={totalNew} limited={newAvailable > totalNew} nextInDays={nextInDays} />
        )}
        {outlook && outlook.total > 0 && (
          <>
            <section className="index-card hidden p-4 lg:block">
              <h2 className="label-caps mb-3 text-ink-2">Next 14 days</h2>
              <ForecastBars forecast={outlook.forecast} now={now} />
            </section>
            <section className="index-card hidden p-4 lg:block">
              <h2 className="label-caps mb-3 flex justify-between text-ink-2">
                Collection <span className="tabular-nums text-muted">{outlook.total}</span>
              </h2>
              <CollectionMix mix={outlook.mix} total={outlook.total} />
            </section>
          </>
        )}
      </aside>

      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
      <div className="mb-5 flex items-end justify-between gap-4">
        <h1 className="font-serif text-display font-semibold tracking-tight">Decks</h1>
        {totalCards > 0 && (
          <p className="pb-1 text-13 tabular-nums text-muted">
            {plural(totalCards, "card")} in {plural(decks.list.length, "deck")}
          </p>
        )}
      </div>

      {!configured ? (
        <EmptyCard
          title="Connect this device"
          body="Paste the app token from setup into Settings and hit Sync. Your cards — or a welcome deck, if this is a fresh start — appear right after."
          action={
            <Link
              to="/settings"
              className="inline-flex h-11 items-center rounded-md bg-accent-fill px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-fill-hover"
            >
              Open Settings
            </Link>
          }
        />
      ) : (
        decks.list.length === 0 &&
        decks.archived.length === 0 && (
          <EmptyCard
            title="No decks yet"
            body={
              <>
                Create a deck below, then{" "}
                <Link to="/new" className="font-medium text-accent underline-offset-2 hover:underline">
                  write your first card
                </Link>
                . Have existing cards? Check sync in{" "}
                <Link to="/settings" className="font-medium text-accent underline-offset-2 hover:underline">
                  Settings
                </Link>
                .
              </>
            }
          />
        )
      )}

      {decks.waiting.length > 0 && (
        <div className="mb-8 grid gap-x-4 gap-y-6 sm:grid-cols-2">
          {decks.waiting.map((deck) => (
            <DeckTile
              key={deck.name}
              deck={deck}
              outlook={outlook?.byDeck.get(deck.name)}
              onArchive={() => void setDeckArchived(deck.name, true)}
              onDelete={() => void onDelete(deck.name, deck.total)}
            />
          ))}
        </div>
      )}

      {decks.idle.length > 0 && (
        // Own stacking context: an open row menu may hang over what follows,
        // but stays under the sticky header (z-20).
        <section className="relative z-10 mb-6" aria-labelledby="idle-decks">
          <h2 id="idle-decks" className="label-caps mb-2 flex justify-between text-muted">
            Nothing due today <span className="tabular-nums">{decks.idle.length}</span>
          </h2>
          <ul className="index-card divide-y divide-hairline">
            {decks.idle.map((deck) => (
              <IdleDeckRow
                key={deck.name}
                deck={deck}
                mix={outlook?.byDeck.get(deck.name)?.mix}
                onArchive={() => void setDeckArchived(deck.name, true)}
                onDelete={() => void onDelete(deck.name, deck.total)}
              />
            ))}
          </ul>
        </section>
      )}

      {newDeckTile}

      {decks.archived.length > 0 && (
        <section className="mt-10" aria-labelledby="archived-decks">
          <h2 id="archived-decks" className="label-caps mb-2 flex justify-between text-muted">
            Archived <span className="tabular-nums">{decks.archived.length}</span>
          </h2>
          <ul className="index-card divide-y divide-hairline bg-paper/70">
            {decks.archived.map((deck) => (
              <li key={deck.name} className="flex items-center gap-3 py-1.5 pl-4 pr-2">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: deckColor(deck.name) }}
                  aria-hidden
                />
                <Link
                  to={`/browse?deck=${encodeURIComponent(deck.name)}`}
                  className="min-w-0 flex-1 break-words font-serif font-bold text-ink-2 hover:text-accent"
                >
                  {deck.name}
                </Link>
                <span className="shrink-0 text-13 tabular-nums text-muted">{plural(deck.total, "card")}</span>
                <button
                  onClick={() => void setDeckArchived(deck.name, false)}
                  className="h-9 shrink-0 rounded-md px-2.5 text-13 font-medium text-accent transition-colors hover:bg-accent-soft"
                >
                  Unarchive
                </button>
                <button
                  onClick={() => void onDelete(deck.name, deck.total)}
                  aria-label={`Delete ${deck.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </div>
  );
}

/** The day's job in one card: how much, how long, and the button to start. */
function TodayPanel({
  due,
  fresh,
  limited,
  nextInDays,
}: {
  due: number;
  fresh: number;
  /** More new cards exist than today's limit lets through. */
  limited: boolean;
  nextInDays?: number;
}) {
  const n = due + fresh;
  // rough pace: a review takes ~10s, a first look at a new card ~25s
  const minutes = Math.max(1, Math.round((due * 10 + fresh * 25) / 60));
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return (
    <section className="index-card index-card--ruled p-4 sm:p-5">
      <div className="label-caps flex justify-between text-muted">
        <span className="text-accent">Today</span>
        <span>{date}</span>
      </div>
      {n > 0 ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[2.75rem] font-semibold leading-none tabular-nums tracking-tight text-ink">{n}</span>
            <span className="text-sm text-ink-2">{n === 1 ? "card" : "cards"} to study</span>
          </div>
          <p className="mt-2 text-13 tabular-nums text-muted">
            {due} due · {fresh} new{limited && " (daily limit)"} · ~{minutes} min
          </p>
          <Link
            to="/review"
            className="mt-4 flex h-11 items-center justify-center rounded-md bg-accent-fill text-sm font-semibold text-on-accent transition-colors hover:bg-accent-fill-hover"
          >
            Study all decks
          </Link>
        </>
      ) : (
        <>
          <p className="mt-3 font-serif text-xl font-bold">All caught up</p>
          <p className="mt-1 text-13 text-muted">
            {nextInDays === undefined
              ? "Nothing scheduled yet."
              : `Next review ${nextInDays === 1 ? "tomorrow" : `in ${nextInDays} days`}.`}
          </p>
        </>
      )}
    </section>
  );
}

interface DeckSummary {
  name: string;
  due: number;
  /** New cards a session would serve today (capped by the daily limit). */
  newCards: number;
  /** Every new card in the deck, limit or not. */
  newAvailable: number;
  total: number;
  nextInDays?: number;
}

/**
 * A deck with cards waiting, as a small pile of index cards: the pile thickens
 * with the backlog. The name opens the session (the whole tile is its hit
 * area); the menu and Study button sit above that link.
 */
function DeckTile({
  deck,
  outlook,
  onArchive,
  onDelete,
}: {
  deck: DeckSummary;
  outlook?: { forecast: number[]; mix: Mix };
  onArchive: () => void;
  onDelete: () => void;
}) {
  const waiting = deck.due + deck.newCards;
  const minutes = Math.max(1, Math.round((deck.due * 10 + deck.newCards * 25) / 60));
  const mature = outlook && deck.total > 0 ? Math.round((100 * outlook.mix.mature) / deck.total) : 0;
  const tomorrow = outlook?.forecast[1] ?? 0;
  const week = outlook?.forecast.slice(1, 8).reduce((a, n) => a + n, 0) ?? 0;
  const href = `/review/${encodeURIComponent(deck.name)}`;

  return (
    <div className="relative isolate">
      <div
        data-stack={waiting < 15 ? 1 : 2}
        style={{ "--card-rule": deckColor(deck.name) } as React.CSSProperties}
        className="index-card index-card--ruled card-stack group flex h-full flex-col p-4 pt-3.5 transition-colors hover:border-hairline-strong hover:[border-top-color:var(--card-rule)] sm:p-5 sm:pt-4"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Link
              to={href}
              className="break-words font-serif text-[1.125rem] font-bold leading-snug outline-none after:absolute after:inset-0 after:rounded-[var(--radius-card)] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent-rule"
            >
              {deck.name}
            </Link>
            <p className="mt-0.5 text-13 tabular-nums text-muted">
              {plural(deck.total, "card")}
              {deck.total > 0 && ` · ${mature}% mature`}
            </p>
          </div>
          <DeckMenu name={deck.name} onArchive={onArchive} onDelete={onDelete} className="-mr-2 -mt-1" />
        </div>

        {outlook && deck.total > 0 && <MixBar mix={outlook.mix} total={deck.total} color={deckColor(deck.name)} className="mt-4 h-1.5" />}

        <div className="mt-auto flex items-end gap-5 pt-5">
          <Count n={deck.due} label="Due" strong />
          <Count n={deck.newCards} label="New" />
          <Link
            to={href}
            className="relative z-10 ml-auto flex h-10 items-center gap-2 rounded-md bg-accent-soft pl-4 pr-3 text-sm font-semibold text-accent transition-colors hover:bg-accent-fill hover:text-on-accent"
          >
            Study
            <span className="text-xs font-medium tabular-nums opacity-80">{minutes} min</span>
          </Link>
        </div>

        <p className="mt-4 border-t border-dashed border-hairline pt-2.5 text-xs tabular-nums text-muted">
          {week === 0
            ? "Nothing more due this week"
            : `${week} more due this week${tomorrow ? `, ${tomorrow} of them tomorrow` : ""}`}
        </p>
      </div>
    </div>
  );
}

/**
 * A deck with nothing to study today, as one quiet line: when it comes back,
 * or — for a deck without cards — the way to fill it.
 */
function IdleDeckRow({
  deck,
  mix,
  onArchive,
  onDelete,
}: {
  deck: DeckSummary;
  mix?: Mix;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const q = `?deck=${encodeURIComponent(deck.name)}`;
  const empty = deck.total === 0;
  const mature = mix && !empty ? Math.round((100 * mix.mature) / deck.total) : 0;
  const status =
    deck.nextInDays !== undefined
      ? `Next ${deck.nextInDays === 1 ? "tomorrow" : `in ${deck.nextInDays} days`}`
      : deck.newAvailable > 0
        ? "Daily new-card limit reached"
        : "Nothing scheduled";
  return (
    <li className="flex items-center gap-3 py-2 pl-4 pr-2">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: deckColor(deck.name) }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <Link
          to={empty ? `/new${q}` : `/review/${encodeURIComponent(deck.name)}`}
          className="break-words font-serif font-bold leading-snug hover:text-accent"
        >
          {deck.name}
        </Link>
        <p className="text-13 tabular-nums text-muted">
          {empty ? "No cards yet" : `${plural(deck.total, "card")} · ${mature}% mature`}
          {/* phones: the status joins this line, leaving the name the full width */}
          {!empty && <span className="sm:hidden"> · {status}</span>}
        </p>
      </div>
      {empty ? (
        <Link
          to={`/new${q}`}
          className="flex h-9 shrink-0 items-center rounded-md px-2.5 text-13 font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          Add a card
        </Link>
      ) : (
        <span className="hidden shrink-0 text-right text-13 tabular-nums text-muted sm:block">{status}</span>
      )}
      <DeckMenu name={deck.name} onArchive={onArchive} onDelete={onDelete} />
    </li>
  );
}

/** Per-deck actions, kept out of the tile's way until asked for. */
function DeckMenu({
  name,
  onArchive,
  onDelete,
  className = "",
}: {
  name: string;
  onArchive: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const q = `?deck=${encodeURIComponent(name)}`;
  const item = "flex h-9 w-full items-center px-3 text-left text-13 font-medium transition-colors";
  return (
    <div ref={ref} className={`relative shrink-0 ${open ? "z-30" : "z-20"} ${className}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Actions for ${name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-ink"
      >
        <IconMore />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 w-44 overflow-hidden rounded-md border border-hairline bg-paper py-1 shadow-lg">
          <Link role="menuitem" to={`/new${q}`} className={`${item} text-ink-2 hover:bg-sunken hover:text-ink`}>
            Add a card
          </Link>
          <Link role="menuitem" to={`/browse${q}`} className={`${item} text-ink-2 hover:bg-sunken hover:text-ink`}>
            Browse cards
          </Link>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onArchive();
            }}
            className={`${item} text-ink-2 hover:bg-sunken hover:text-ink`}
          >
            Archive deck
          </button>
          <div className="my-1 border-t border-hairline" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className={`${item} gap-2 text-danger hover:bg-danger-soft`}
          >
            <IconTrash className="h-3.5 w-3.5" />
            Delete deck
          </button>
        </div>
      )}
    </div>
  );
}

const IconMore = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
    <circle cx="4.5" cy="10" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="15.5" cy="10" r="1.5" />
  </svg>
);

function Count({ n, label, strong }: { n: number; label: string; strong?: boolean }) {
  return (
    <div className={n === 0 ? "opacity-60" : ""}>
      <div
        className={`text-display font-semibold leading-none tabular-nums tracking-tight ${
          strong && n > 0 ? "text-ink" : "text-ink-2"
        }`}
      >
        {n}
      </div>
      <div className={`label-caps mt-1.5 ${strong && n > 0 ? "text-accent" : "text-muted"}`}>{label}</div>
    </div>
  );
}

function EmptyCard({ title, body, action }: { title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="index-card index-card--ruled mb-6 flex flex-col items-center px-6 pb-8 pt-7 text-center sm:flex-row sm:items-center sm:gap-8 sm:px-10 sm:text-left">
      <MarkIllustration className="h-20 w-28 shrink-0 sm:h-24 sm:w-32" />
      <div className="mt-4 sm:mt-0">
        <h2 className="font-serif text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-2">{body}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
