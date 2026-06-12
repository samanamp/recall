import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
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
  const [error, setError] = useState<string | null>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);

  // stale-while-revalidate: render the cached stats instantly, refresh behind
  useEffect(() => {
    void kvGet<StatsData>("statsCache").then((cached) => {
      if (cached) setData((d) => d ?? cached);
    });
    api
      .stats()
      .then((s) => {
        setData(s);
        void kvSet("statsCache", s);
      })
      .catch((e) => setData((d) => (d ? d : (setError(String(e)), null))));
  }, []);

  // the interesting edge of the heatmap is the most recent week
  useEffect(() => {
    const el = heatmapRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data]);

  if (error && !data) return <p className="text-sm text-red-500">✗ {error}</p>;
  if (!data) return null;
  const { daily, forecast } = data;

  const byDay = new Map(daily.map((d) => [d.day, d]));
  const today = localISO(new Date());

  // headline numbers — Again rate over 30 days, not all-time: the imported
  // history predates honest Again-pressing and would drown the signal.
  const totalReviews = daily.reduce((a, d) => a + d.n, 0);
  const recent = daily.filter((d) => Date.now() - new Date(d.day).getTime() < 30 * DAY);
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

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold tracking-tight">Stats</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Streak" value={`${streak}d`} accent={streak > 0} />
        <StatCard label="Today" value={String(todayN)} />
        <StatCard label="Last 7 days" value={String(last7)} />
        <StatCard
          label="Again rate (30d)"
          value={`${againRate.toFixed(1)}%`}
          hint={
            againRate < 2
              ? "below 2% — the optimizer can't see forgetting; press Again when you fail"
              : "enough failure signal for the optimizer"
          }
        />
      </div>

      <section>
        <h2 className="mb-3 font-semibold">
          Activity <span className="text-sm font-normal text-zinc-500">· {totalReviews} reviews all-time</span>
        </h2>
        <div ref={heatmapRef} className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-1">
          {days.map(({ iso, n, future }) => (
            <div
              key={iso}
              title={`${iso}: ${n} review${n === 1 ? "" : "s"}`}
              className={`h-3.5 w-3.5 rounded-[3px] ${future ? "opacity-0" : heatClass(n)}`}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Upcoming</h2>
        {forecast.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing scheduled — review some cards!</p>
        ) : (
          <div className="space-y-1.5">
            {forecast.slice(0, 7).map((f) => (
              <div key={f.day} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-zinc-500">{relDay(f.day, today)}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800/60">
                  <div
                    className="h-full rounded bg-sky-500/70"
                    style={{ width: `${(f.n / maxForecast) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-zinc-500">{f.n}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div
      title={hint}
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900"
    >
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          accent ? "text-sky-600 dark:text-sky-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function heatClass(n: number): string {
  if (n === 0) return "bg-zinc-100 dark:bg-zinc-800/60";
  if (n < 5) return "bg-sky-200 dark:bg-sky-900";
  if (n < 15) return "bg-sky-400 dark:bg-sky-700";
  if (n < 40) return "bg-sky-500 dark:bg-sky-500";
  return "bg-sky-600 dark:bg-sky-400";
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
