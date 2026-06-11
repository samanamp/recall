import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { api, type FsrsParams } from "../lib/api";
import { db, kvGet, kvSet } from "../lib/db";
import { optimizeParameters } from "../lib/optimize";
import { configureScheduler } from "../lib/scheduler";
import { requestSync, syncAll, type SyncResult } from "../lib/sync";
import { getTheme, setTheme, type Theme } from "../lib/theme";

// Matches Anki's guidance: the FSRS optimizer needs substantial cross-day
// history; below ~400 reviews fsrs-rs aborts with NotEnoughData.
const OPTIMIZE_MIN_REVIEWS = 400;

export default function Settings() {
  const [workerUrl, setWorkerUrl] = useState("");
  const [appToken, setAppToken] = useState("");
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [retention, setRetention] = useState(0.9);
  const [optimizing, setOptimizing] = useState(false);
  const [algoMsg, setAlgoMsg] = useState<string | null>(null);
  const retentionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reviewCount = useLiveQuery(async () => (await kvGet<number>("reviewCount")) ?? 0, [], 0);
  const params = useLiveQuery(async () => kvGet<FsrsParams>("fsrsParams"), []);

  useEffect(() => {
    void kvGet<string>("workerUrl").then((v) =>
      setWorkerUrl(v || (import.meta.env.VITE_WORKER_URL as string) || "")
    );
    void kvGet<string>("appToken").then((v) => setAppToken(v ?? ""));
    void kvGet<FsrsParams>("fsrsParams").then((p) => p && setRetention(p.retention));
  }, []);

  /** Persist retention everywhere: server (reschedules all cards), kv, scheduler. */
  function onRetentionChange(value: number) {
    setRetention(value);
    clearTimeout(retentionTimer.current);
    retentionTimer.current = setTimeout(() => {
      void (async () => {
        try {
          await api.putParams({ retention: value });
          const p: FsrsParams = { retention: value, weights: params?.weights ?? null };
          await kvSet("fsrsParams", p);
          configureScheduler(p.retention, p.weights);
          setAlgoMsg(`✓ retention set to ${Math.round(value * 100)}% — cards rescheduled`);
          requestSync(300);
        } catch (e) {
          setAlgoMsg(`✗ ${e instanceof Error ? e.message : e}`);
        }
      })();
    }, 600);
  }

  async function onOptimize() {
    setOptimizing(true);
    setAlgoMsg(null);
    try {
      const { weights, reviews } = await optimizeParameters();
      await api.putParams({ weights });
      const p: FsrsParams = { retention, weights };
      await kvSet("fsrsParams", p);
      configureScheduler(p.retention, p.weights);
      setAlgoMsg(`✓ optimized from ${reviews} reviews — cards rescheduled`);
      requestSync(300);
    } catch (e) {
      setAlgoMsg(`✗ ${e instanceof Error ? e.message : e}`);
    }
    setOptimizing(false);
  }

  /** Save credentials, then sync — one button does both. */
  async function onSync() {
    setSyncing(true);
    await kvSet("workerUrl", workerUrl.trim());
    await kvSet("appToken", appToken.trim());
    setSyncResult(await syncAll());
    setSyncing(false);
  }

  async function onExport() {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      cards: await db.cards.toArray(),
      state: await db.state.toArray(),
      pendingReviews: await db.pendingReviews.toArray(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `recall-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onImport(file: File) {
    const backup = JSON.parse(await file.text());
    await db.cards.bulkPut(backup.cards ?? []);
    await db.state.bulkPut(backup.state ?? []);
    alert(`Imported ${backup.cards?.length ?? 0} cards.`);
  }

  const input =
    "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-sky-500 dark:border-zinc-800 dark:bg-zinc-900/70";
  const label = "mb-1 block text-xs font-medium text-zinc-500";
  const secondary =
    "rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:border-sky-400 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-sky-600";

  return (
    <div className="max-w-md space-y-10">
      <h1 className="text-xl font-bold tracking-tight">Settings</h1>

      <section>
        <h2 className="mb-1 font-semibold">Sync</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Your worker URL and the app token you chose for it.
        </p>
        <div className="space-y-3">
          <div>
            <label className={label}>Worker URL</label>
            <input
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="https://recall-api.yourname.workers.dev"
              className={input}
            />
          </div>
          <div>
            <label className={label}>App token</label>
            <input
              value={appToken}
              onChange={(e) => setAppToken(e.target.value)}
              placeholder="app token"
              type="password"
              className={input}
            />
          </div>
          <button
            onClick={() => void onSync()}
            disabled={syncing || !workerUrl.trim() || !appToken.trim()}
            className="w-full rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-500 disabled:opacity-40"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {syncResult && (
            <p className={`text-sm ${syncResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {syncResult.ok
                ? `✓ pushed ${syncResult.pushedFiles} files, ${syncResult.pushedReviews} reviews · pulled ${syncResult.pulledFiles} files`
                : `✗ ${syncResult.errors.join("; ") || "not configured or offline"}`}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Algorithm</h2>
        <p className="mb-4 text-sm text-zinc-500">
          FSRS spaced repetition. Tune how much you want to remember vs. how often you review.
        </p>
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="text-xs font-medium text-zinc-500">Desired retention</label>
              <span className="text-sm font-semibold tabular-nums">
                {Math.round(retention * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.8}
              max={0.97}
              step={0.01}
              value={retention}
              onChange={(e) => onRetentionChange(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span>fewer reviews</span>
              <span>remember more</span>
            </div>
          </div>

          <div>
            <button
              onClick={() => void onOptimize()}
              disabled={optimizing || reviewCount < OPTIMIZE_MIN_REVIEWS}
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-semibold shadow-sm transition-colors hover:border-sky-400 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-sky-600"
            >
              {optimizing
                ? "Optimizing…"
                : params?.weights
                  ? "Re-optimize for me"
                  : "Optimize for me"}
            </button>
            <p className="mt-1.5 text-xs text-zinc-500">
              {reviewCount >= OPTIMIZE_MIN_REVIEWS
                ? `Fits the scheduler to your ${reviewCount} logged reviews (runs on-device).`
                : `Unlocks at ${OPTIMIZE_MIN_REVIEWS} reviews (the optimizer needs cross-day history; same bar Anki uses) — ${reviewCount} logged so far.`}
              {params?.weights && " Currently using your personalized parameters."}
            </p>
          </div>

          {algoMsg && (
            <p className={`text-sm ${algoMsg.startsWith("✓") ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {algoMsg}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Appearance</h2>
        <div className="inline-flex rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-800/80">
          {(["system", "dark", "light"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTheme(t);
                setThemeState(t);
              }}
              className={`rounded-lg px-4 py-1.5 text-sm capitalize transition-colors ${
                theme === t
                  ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Backup</h2>
        <div className="flex gap-2">
          <button onClick={() => void onExport()} className={secondary}>
            Export JSON
          </button>
          <label className={`cursor-pointer ${secondary}`}>
            Import JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
              }}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
