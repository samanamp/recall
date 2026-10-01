import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { MarkIllustration } from "../components/Mark";
import { IconTrash } from "../components/icons";
import { createDeck, deleteDeck } from "../lib/actions";
import { db, kvGet } from "../lib/db";
import { deckColor } from "../lib/deck-color";
import { deckCounts, newBudget } from "../lib/scheduler";
import { loadOutlook } from "../lib/outlook";
import { CollectionMix, ForecastBars } from "../components/Outlook";

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

  // Default true so configured devices never flash the connect banner.
  const configured = useLiveQuery(
    async () => Boolean(await kvGet<string>("appToken")),
    [],
    true
  );

  const decks = useLiveQuery(async () => {
    const now = new Date();
    const [counts, budget] = await Promise.all([deckCounts(now), newBudget(now)]);
    const totals = new Map<string, number>();
    for (const c of await db.cards.toArray()) {
      totals.set(c.deck, (totals.get(c.deck) ?? 0) + 1);
    }
    // Show new counts the queue will actually serve today (budget-capped),
    // so tiles never advertise cards a session won't deliver.
    return {
      budget,
      list: [...counts.entries()]
        .map(([name, c]) => ({
          name,
          ...c,
          newCards: Math.min(c.newCards, budget),
          total: totals.get(name) ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, []);

  const outlook = useLiveQuery(() => loadOutlook(new Date()), []);
  const now = new Date();

  if (!decks) return null;

  const nextInDays = decks.list.reduce<number | undefined>(
    (m, d) => (d.nextInDays !== undefined && (m === undefined || d.nextInDays < m) ? d.nextInDays : m),
    undefined
  );

  const totalCards = decks.list.reduce((n, d) => n + d.total, 0);
  const totalDue = decks.list.reduce((n, d) => n + d.due, 0);
  const totalNew = Math.min(
    decks.budget,
    decks.list.reduce((n, d) => n + d.newCards, 0)
  );

  const newDeckTile = adding ? (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onCreate();
      }}
      className="index-card flex flex-wrap items-center gap-3 border-accent-rule p-3 pl-4 sm:col-span-2"
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
      className="flex h-12 items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed sm:col-span-2 border-hairline-strong text-sm font-medium text-muted transition-colors hover:border-accent-rule hover:bg-paper/60 hover:text-accent"
    >
      <span className="text-lg leading-none" aria-hidden>+</span>
      New deck
    </button>
  );

  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <aside className="space-y-4 lg:sticky lg:top-[5.5rem] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        {configured && totalCards > 0 && (
          <TodayPanel due={totalDue} fresh={totalNew} nextInDays={nextInDays} />
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
        decks.list.length === 0 && (
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

      <div className="grid gap-4 sm:grid-cols-2">
        {decks.list.map((deck) => {
          const idle = deck.due === 0 && deck.newCards === 0;
          return (
            <Link
              key={deck.name}
              to={`/review/${encodeURIComponent(deck.name)}`}
              style={{ "--card-rule": deckColor(deck.name) } as React.CSSProperties}
              className="index-card index-card--ruled group flex min-h-[8.5rem] flex-col p-4 pt-3.5 sm:min-h-[9.5rem] transition-colors hover:border-hairline-strong hover:[border-top-color:var(--card-rule)]"
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words font-serif text-[1.0625rem] font-bold leading-snug">
                  {deck.name}
                </span>
                <button
                  onClick={(e) => void onDelete(e, deck.name, deck.total)}
                  title="Delete deck"
                  aria-label={`Delete deck ${deck.name}`}
                  className="-mr-2 -mt-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-faint transition-all hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  <IconTrash />
                </button>
              </div>

              <DeckBar due={deck.due} fresh={deck.newCards} total={deck.total} />

              <div className="mt-auto flex items-end gap-6 pt-4">
                {idle ? (
                  <div>
                    <div className="text-sm font-medium text-ink-2">Done for today</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {deck.nextInDays !== undefined
                        ? `Next review ${deck.nextInDays === 1 ? "tomorrow" : `in ${deck.nextInDays} days`}`
                        : "Nothing scheduled"}
                    </div>
                  </div>
                ) : (
                  <>
                    <Count n={deck.due} label="Due" strong />
                    <Count n={deck.newCards} label="New" />
                  </>
                )}
                <span className="ml-auto pb-0.5 text-xs tabular-nums text-muted">{plural(deck.total, "card")}</span>
              </div>
            </Link>
          );
        })}
        {newDeckTile}
      </div>
      </div>
    </div>
  );
}

/** The day's job in one card: how much, how long, and the button to start. */
function TodayPanel({ due, fresh, nextInDays }: { due: number; fresh: number; nextInDays?: number }) {
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
            {due} due · {fresh} new · about {minutes} min
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

/** Where the deck stands: due, new, and the rest (scheduled for later). */
function DeckBar({ due, fresh, total }: { due: number; fresh: number; total: number }) {
  if (total === 0) return null;
  const pct = (n: number) => `${(100 * n) / total}%`;
  return (
    <div className="mt-3 flex h-1 gap-px overflow-hidden rounded-full bg-hairline" aria-hidden>
      {due > 0 && <div className="bg-accent" style={{ width: pct(due) }} />}
      {fresh > 0 && <div className="bg-accent/35" style={{ width: pct(fresh) }} />}
    </div>
  );
}

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
