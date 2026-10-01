import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { kvGet, kvSet } from "../lib/db";

interface Daily {
  day: string;
  n: number;
  again: number;
}
interface StatsData {
  daily: Daily[];
  forecast: { day: string; n: number }[];
}

const DAY = 86_400_000;
const WEEKS = 17; // heatmap span

export default function Stats() {
  const [data, setData] = useState<StatsData | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const heatmapRef = useRef<HTMLDivElement>(null);

  // stale-while-revalidate: render the cached stats instantly, refresh behind
  useEffect(() => {
    let live = true;
    const cache = Promise.all([kvGet<StatsData>("statsCache"), kvGet<number>("statsCacheAt")]).then(
      ([cached, at]) => {
        if (!live || !cached) return;
        setData((d) => d ?? cached);
        setCachedAt((t) => t ?? at ?? null);
      }
    );
    api
      .stats()
      .then((s) => {
        if (!live) return;
        const now = Date.now();
        setData(s);
        setFresh(true);
        setCachedAt(now);
        setError(null);
        void kvSet("statsCache", s);
        void kvSet("statsCacheAt", now);
      })
      .catch((e: unknown) => live && setError(e))
      // settle only after the cache read, so a fast failure never flashes the error card
      .finally(() => void cache.then(() => live && setLoading(false)));
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = () => {
    setLoading(true);
    setAttempt((a) => a + 1);
  };

  // the interesting edge of the heatmap is the most recent week
  useEffect(() => {
    const el = heatmapRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data]);

  const offline = isOffline(error);
  const unconfigured = error instanceof ApiError && error.status === 0 && /not configured/.test(error.message);

  if (!data) {
    if (loading) return <StatsHeader />;
    return (
      <div>
        <StatsHeader />
        <div className="index-card index-card--ruled max-w-xl px-6 py-7 sm:px-8">
          <h2 className="font-serif text-xl font-semibold">
            {unconfigured
              ? "Connect this device"
              : offline
                ? navigator.onLine
                  ? "Can't reach your server"
                  : "You're offline"
                : "Couldn't load stats"}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-2">
            {unconfigured
              ? "Stats are computed on your server from every device's reviews. Add your app token in Settings to see them."
              : offline
                ? "Stats are computed on your server, and this device hasn't saved a copy yet. Reviews you do meanwhile still count — they sync later."
                : "The server didn't answer as expected. Your reviews are safe; try again in a moment."}
          </p>
          {!offline && !unconfigured && error != null && (
            <p className="mt-3 max-w-md break-words font-mono text-xs text-muted">{errorText(error)}</p>
          )}
          <div className="mt-5">
            {unconfigured ? (
              <Link
                to="/settings"
                className="inline-flex h-10 items-center rounded-md bg-accent-fill px-4 text-sm font-semibold text-on-accent hover:bg-accent-fill-hover"
              >
                Open Settings
              </Link>
            ) : (
              <button
                onClick={retry}
                className="h-10 rounded-md bg-accent-fill px-4 text-sm font-semibold text-on-accent hover:bg-accent-fill-hover"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { daily, forecast } = data;
  const nowMs = new Date().getTime();
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const today = localISO(new Date());

  // headline numbers — Again rate over 30 days, not all-time: the imported
  // history predates honest Again-pressing and would drown the signal.
  const totalReviews = daily.reduce((a, d) => a + d.n, 0);
  const recent = daily.filter((d) => nowMs - new Date(d.day).getTime() < 30 * DAY);
  const recentN = recent.reduce((a, d) => a + d.n, 0);
  const recentAgain = recent.reduce((a, d) => a + d.again, 0);
  const againRate = recentN > 0 ? (recentAgain / recentN) * 100 : 0;
  const todayN = byDay.get(today)?.n ?? 0;
  const last7 = sumRange(byDay, 6);
  const streak = computeStreak(byDay, today);

  // heatmap grid: WEEKS columns ending with the current week
  const end = new Date();
  const endDow = end.getDay();
  const days: { iso: string; n: number; future: boolean }[] = [];
  for (let i = WEEKS * 7 - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - (i - (6 - endDow)) * DAY);
    const iso = localISO(d);
    days.push({ iso, n: byDay.get(iso)?.n ?? 0, future: d.getTime() > end.getTime() });
  }
  const maxForecast = Math.max(1, ...forecast.map((f) => f.n));
  const stale = !fresh && error != null;

  return (
    <div className="space-y-8">
      <StatsHeader>
        {stale && (
          <p role="status" className="flex flex-wrap items-center gap-x-2 text-13 text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-faint" aria-hidden />
            {offline ? (navigator.onLine ? "Server unreachable" : "Offline") : "Couldn't refresh"}, showing data from {cachedAt ? relTime(cachedAt) : "an earlier visit"}
            {!offline && (
              <button onClick={retry} disabled={loading} className="font-medium text-accent hover:underline">
                Retry
              </button>
            )}
          </p>
        )}
      </StatsHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Streak" value={String(streak)} unit={streak === 1 ? "day" : "days"} accent={streak > 0} />
        <StatCard label="Today" value={String(todayN)} unit="reviews" />
        <StatCard label="Last 7 days" value={String(last7)} unit="reviews" />
        <StatCard
          label="Again rate · 30d"
          value={againRate.toFixed(1)}
          unit="%"
          hint={
            againRate < 2
              ? "Below 2% — press Again when you fail, so the optimizer can see forgetting"
              : "Enough failure signal for the optimizer"
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
      <section className="index-card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-caps text-ink-2">Activity</h2>
          <span className="text-13 tabular-nums text-muted">{totalReviews.toLocaleString()} reviews all-time</span>
        </div>
        <div className="flex gap-2">
          <div className="grid grid-rows-7 gap-1 pt-px text-2xs leading-none text-muted" aria-hidden>
            {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
              <span key={i} className="flex h-3.5 items-center">{d}</span>
            ))}
          </div>
          <div
            ref={heatmapRef}
            className="grid min-w-0 flex-1 grid-flow-col grid-rows-7 justify-start gap-1 overflow-x-auto pb-1"
            role="img"
            aria-label={`Daily reviews over the last ${WEEKS} weeks`}
          >
            {days.map(({ iso, n, future }) => (
              <div
                key={iso}
                title={`${iso}: ${n} review${n === 1 ? "" : "s"}`}
                className={`h-3.5 w-3.5 rounded-[3px] ${future ? "opacity-0" : ""}`}
                style={{ backgroundColor: heatColor(n) }}
              />
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-1 text-2xs text-muted" aria-hidden>
          Less
          {[0, 1, 6, 20, 50].map((n) => (
            <span key={n} className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: heatColor(n) }} />
          ))}
          More
        </div>
      </section>

      <section className="index-card p-4 sm:p-5">
        <h2 className="label-caps mb-4 text-ink-2">Upcoming · 7 days</h2>
        {forecast.length === 0 ? (
          <p className="text-sm text-muted">Nothing scheduled — review some cards!</p>
        ) : (
          <div className="space-y-2">
            {forecast.slice(0, 7).map((f) => (
              <div key={f.day} className="flex items-center gap-3 text-sm" title={`${f.day}: ${f.n} due`}>
                <span className="w-24 shrink-0 truncate text-muted">{relDay(f.day, today)}</span>
                <div className="h-3 flex-1">
                  <div
                    className="h-full rounded-r-[4px] bg-accent-rule"
                    style={{ width: `${Math.max(1, (f.n / maxForecast) * 100)}%` }}
                  />
                </div>
                <span className="w-10 text-right font-medium tabular-nums text-ink">{f.n}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

function StatsHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-5 space-y-1">
      <h1 className="font-serif text-display font-semibold tracking-tight">Stats</h1>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  accent,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className="index-card flex flex-col p-4">
      <div className="label-caps text-muted">{label}</div>
      <div className={`mt-2 flex items-baseline ${unit === "%" ? "" : "gap-1"}`}>
        <span className={`text-display font-semibold tabular-nums tracking-tight ${accent ? "text-accent" : "text-ink"}`}>
          {value}
        </span>
        {unit && <span className="text-13 text-muted">{unit}</span>}
      </div>
      {hint && <p className="mt-1.5 text-xs leading-snug text-muted">{hint}</p>}
    </div>
  );
}

/** Sequential scale in the accent: paper → accent rule. */
function heatColor(n: number): string {
  if (n === 0) return "var(--sunken)";
  const pct = n < 5 ? 28 : n < 15 ? 52 : n < 40 ? 76 : 100;
  return `color-mix(in oklab, var(--accent-rule) ${pct}%, var(--paper))`;
}

function isOffline(e: unknown): boolean {
  if (e == null) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  // fetch() rejects with a TypeError ("Failed to fetch", "Load failed", …) on network failure
  return e instanceof TypeError;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function relTime(t: number): string {
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function sumRange(byDay: Map<string, Daily>, daysBack: number): number {
  let sum = 0;
  for (let i = 0; i <= daysBack; i++) {
    const iso = localISO(new Date(Date.now() - i * DAY));
    sum += byDay.get(iso)?.n ?? 0;
  }
  return sum;
}

/** Consecutive days with ≥1 review, counting back from today (today may be 0). */
function computeStreak(byDay: Map<string, Daily>, today: string): number {
  let streak = 0;
  let cursor = new Date();
  if (!byDay.get(today)?.n) cursor = new Date(cursor.getTime() - DAY); // grace for today
  for (;;) {
    const iso = localISO(cursor);
    if (byDay.get(iso)?.n) {
      streak++;
      cursor = new Date(cursor.getTime() - DAY);
    } else {
      break;
    }
  }
  return streak;
}

function relDay(iso: string, today: string): string {
  if (iso === today) return "today";
  const diff = Math.round((new Date(iso).getTime() - new Date(today).getTime()) / DAY);
  if (diff === 1) return "tomorrow";
  return new Date(iso + "T12:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
