import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { api, type FsrsParams } from "../lib/api";
import { db, kvGet, kvSet } from "../lib/db";
import { optimizeParameters } from "../lib/optimize";
import { configureScheduler } from "../lib/scheduler";
import { requestSync, syncAll, type SyncResult } from "../lib/sync";
import {
  COLOR_THEMES,
  getColorTheme,
  getTheme,
  setColorTheme,
  setTheme,
  type ColorTheme,
  type Theme,
} from "../lib/theme";
import { IconCheck } from "../components/icons";

const OPTIMIZE_MIN_REVIEWS = 100;

export default function Settings() {
  const [workerUrl, setWorkerUrl] = useState("");
  const [appToken, setAppToken] = useState("");
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(getColorTheme());
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [retention, setRetention] = useState(0.9);
  const [newPerDay, setNewPerDay] = useState(20);
  const [optimizing, setOptimizing] = useState(false);
  const [algoMsg, setAlgoMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const retentionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reviewCount = useLiveQuery(async () => (await kvGet<number>("reviewCount")) ?? 0, [], 0);
  const params = useLiveQuery(async () => kvGet<FsrsParams>("fsrsParams"), []);

  useEffect(() => {
    void kvGet<string>("workerUrl").then((v) =>
      setWorkerUrl(v || (import.meta.env.VITE_WORKER_URL as string) || "")
    );
    void kvGet<string>("appToken").then((v) => setAppToken(v ?? ""));
    void kvGet<FsrsParams>("fsrsParams").then((p) => p && setRetention(p.retention));
    void kvGet<number>("newPerDay").then((v) => v !== undefined && setNewPerDay(v));
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

  /** Anki .apkg import — heavy deps load only when a file is actually chosen. */
  async function onImportApkg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setImporting(true);
    setImportMsg("Reading archive…");
    try {
      const { importApkg } = await import("../lib/apkg");
      const phases = { reading: "Reading archive", media: "Importing images", cards: "Importing cards", reviews: "Importing review history" };
      const s = await importApkg(file, (p) =>
        setImportMsg(`${phases[p.phase]}… ${p.done}/${p.total}`)
      );
      setImportMsg(
        `✓ ${s.cards} cards in ${s.decks} deck${s.decks === 1 ? "" : "s"}, ` +
          `${s.reviews} reviews, ${s.media} images` +
          (s.skipped ? ` (${s.skipped} cards skipped)` : "") +
          (s.reviews < s.totalRevlog ? ` — ${s.totalRevlog - s.reviews} revlog entries had no matching card` : "") +
          ". Cards commit to your repo in the background."
      );
    } catch (err) {
      setImportMsg(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
    setImporting(false);
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

  /**
   * Recovery hatch for stale-version/schema weirdness: wipe local data and
   * caches, keep credentials, reload → fresh build + full re-sync.
   */
  async function onClearStorage() {
    const pending = (await db.pendingFiles.count()) + (await db.pendingReviews.count());
    const warn =
      pending > 0 ? `\n\n⚠️ ${pending} unsynced change(s) will be LOST.` : "";
    if (
      !confirm(
        `Clear all local data and re-download everything from the server?\n` +
          `Your worker URL and token are kept.${warn}`
      )
    ) {
      return;
    }
    const keep: [string, unknown][] = [];
    for (const key of ["workerUrl", "appToken", "deviceId"]) {
      const v = await kvGet(key);
      if (v !== undefined) keep.push([key, v]);
    }
    await Promise.all([
      db.cards.clear(),
      db.media.clear(),
      db.state.clear(),
      db.pendingFiles.clear(),
      db.pendingReviews.clear(),
      db.decks.clear(),
      db.kv.clear(),
    ]);
    for (const [k, v] of keep) await kvSet(k, v);
    // Stale-build half of the problem: drop the service worker + caches so the
    // reload fetches the current deployment.
    if ("serviceWorker" in navigator) {
      for (const reg of await navigator.serviceWorker.getRegistrations()) {
        await reg.unregister();
      }
    }
    if ("caches" in window) {
      for (const key of await caches.keys()) await caches.delete(key);
    }
    location.reload();
  }

  const input =
    "h-11 w-full rounded-md border border-hairline bg-paper px-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent-rule";
  const label = "label-caps mb-1.5 block text-muted";
  const secondary =
    "inline-flex h-10 items-center justify-center rounded-md border border-hairline-strong bg-paper px-4 text-sm font-medium text-ink transition-colors hover:border-accent-rule hover:text-accent";
  const primary =
    "h-11 w-full rounded-md bg-accent-fill text-sm font-semibold text-on-accent transition-colors hover:bg-accent-fill-hover disabled:opacity-40";
  const okText = "text-ok";
  const errText = "text-danger";

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 font-serif text-display font-semibold tracking-tight">Settings</h1>

      <div className="space-y-5">
        <Section title="Sync" lede="The app token you chose during setup. Worker URL is only needed when the app isn't served by the worker itself (e.g. local dev).">
          <div className="space-y-4">
            <div>
              <label className={label} htmlFor="worker-url">Worker URL (optional)</label>
              <input
                id="worker-url"
                value={workerUrl}
                onChange={(e) => setWorkerUrl(e.target.value)}
                placeholder="blank = this origin"
                className={input}
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <div>
              <label className={label} htmlFor="app-token">App token</label>
              <input
                id="app-token"
                value={appToken}
                onChange={(e) => setAppToken(e.target.value)}
                placeholder="app token"
                type="password"
                autoComplete="off"
                className={input}
              />
            </div>
            <button onClick={() => void onSync()} disabled={syncing || !appToken.trim()} className={primary}>
              {syncing ? "Syncing…" : "Save & sync now"}
            </button>
            {syncResult && (
              <div role="status" className={`text-sm ${syncResult.ok ? okText : errText}`}>
                {syncResult.ok ? (
                  `✓ Pushed ${syncResult.pushedFiles} files, ${syncResult.pushedReviews} reviews · pulled ${syncResult.pulledFiles} files`
                ) : syncResult.errors.length > 0 ? (
                  <>
                    <p className="font-medium">Sync failed</p>
                    <ul className="mt-1.5 space-y-1 rounded border border-hairline bg-sunken p-2.5">
                      {syncResult.errors.map((err, i) => (
                        <li key={i} className="break-words font-mono text-xs text-ink-2">{err}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  "✗ Not configured or offline"
                )}
              </div>
            )}
          </div>
        </Section>

        <Section title="Algorithm" lede="FSRS spaced repetition. Tune how much you want to remember vs. how often you review.">
          <div className="space-y-6">
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <label className="label-caps text-muted" htmlFor="retention">Desired retention</label>
                <span className="text-lg font-semibold tabular-nums">{Math.round(retention * 100)}%</span>
              </div>
              <input
                id="retention"
                type="range"
                min={0.8}
                max={0.97}
                step={0.01}
                value={retention}
                onChange={(e) => onRetentionChange(Number(e.target.value))}
                className="h-10 w-full"
              />
              <div className="flex justify-between text-xs text-muted">
                <span>fewer reviews</span>
                <span>remember more</span>
              </div>
            </div>

            <div>
              <label className={label} htmlFor="new-per-day">New cards per day</label>
              <input
                id="new-per-day"
                type="number"
                min={0}
                max={500}
                value={newPerDay}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(500, Number(e.target.value) || 0));
                  setNewPerDay(v);
                  void kvSet("newPerDay", v);
                }}
                className={`${input} w-28 tabular-nums`}
              />
              <p className="mt-1.5 text-13 text-muted">
                Caps daily introductions — every new card becomes reviews due within days.
              </p>
            </div>

            <div>
              <button
                onClick={() => void onOptimize()}
                disabled={optimizing || reviewCount < OPTIMIZE_MIN_REVIEWS}
                className={`${secondary} h-11 w-full font-semibold disabled:pointer-events-none disabled:opacity-50`}
              >
                {optimizing
                  ? "Optimizing…"
                  : params?.weights
                    ? "Re-optimize for me"
                    : "Optimize for me"}
              </button>
              <p className="mt-1.5 text-13 text-muted">
                {reviewCount >= OPTIMIZE_MIN_REVIEWS
                  ? `Fits the scheduler to your ${reviewCount} logged reviews (runs on-device).`
                  : `Unlocks at ${OPTIMIZE_MIN_REVIEWS} reviews — ${reviewCount} logged so far. (More history, especially across days, gives a better fit.)`}
                {params?.weights && " Currently using your personalized parameters."}
              </p>
            </div>

            {algoMsg && (
              <p role="status" className={`text-sm ${algoMsg.startsWith("✓") ? okText : errText}`}>
                {algoMsg}
              </p>
            )}
          </div>
        </Section>

        <Section title="Appearance" lede="Interface mode and accent colour.">
          <div className="inline-flex rounded-md border border-hairline bg-sunken p-0.5" role="radiogroup" aria-label="Mode">
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                onClick={() => {
                  setTheme(t);
                  setThemeState(t);
                }}
                className={`h-10 rounded-[5px] px-4 text-sm capitalize sm:h-9 transition-colors ${
                  theme === t ? "bg-paper font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Accent colour">
            {COLOR_THEMES.map((option) => {
              const active = colorTheme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setColorTheme(option.id);
                    setColorThemeState(option.id);
                  }}
                  style={{ "--sw": option.swatch, "--sw-dark": option.swatchDark } as React.CSSProperties}
                  className={`group relative flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border bg-paper text-left transition-colors ${
                    active ? "border-ink ring-1 ring-ink" : "border-hairline hover:border-hairline-strong"
                  }`}
                >
                  {/* a miniature index card in the theme's colour */}
                  <span className="block h-1 bg-[var(--sw)] dark:bg-[var(--sw-dark)]" aria-hidden />
                  <span className="block px-2.5 pb-2.5 pt-2">
                    <span className="mb-2 block space-y-1" aria-hidden>
                      <span className="block h-[3px] w-3/4 rounded-full bg-[var(--sw)] opacity-80 dark:bg-[var(--sw-dark)]" />
                      <span className="block h-[3px] w-full rounded-full bg-hairline" />
                      <span className="block h-[3px] w-1/2 rounded-full bg-hairline" />
                    </span>
                    <span className="flex items-center justify-between gap-1">
                      <span className="truncate text-13 font-semibold text-ink">{option.label}</span>
                      {active && <IconCheck className="h-3.5 w-3.5 shrink-0 text-ink" />}
                    </span>
                    <span className="block truncate text-2xs text-muted">{option.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          title="Import from Anki"
          lede="Decks, cards, images, and full review history from an .apkg export. In Anki: File → Export → check “Support older Anki versions”. Re-importing the same file is safe."
        >
          <label className={`cursor-pointer ${secondary} ${importing ? "pointer-events-none opacity-50" : ""}`}>
            {importing ? "Importing…" : "Import .apkg"}
            <input
              type="file"
              accept=".apkg,.colpkg"
              className="sr-only"
              disabled={importing}
              onChange={(e) => void onImportApkg(e)}
            />
          </label>
          {importMsg && (
            <p className={`mt-3 text-sm ${importMsg.startsWith("✗") ? errText : "text-muted"}`} role="status">
              {importMsg}
            </p>
          )}
        </Section>

        <Section title="Backup" lede="A JSON snapshot of cards, scheduling state and unsynced reviews.">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void onExport()} className={secondary}>
              Export JSON
            </button>
            <label className={`cursor-pointer ${secondary}`}>
              Import JSON
              <input
                type="file"
                accept="application/json"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f);
                }}
              />
            </label>
          </div>
        </Section>

        <Section
          title="Storage"
          lede="If the app misbehaves after an update (stale version, sync weirdness), reset the local copy. Cards and reviews live on the server — they re-download on next sync."
        >
          <button
            onClick={() => void onClearStorage()}
            className="inline-flex h-10 items-center rounded-md border border-danger/40 bg-danger-soft px-4 text-sm font-medium text-danger transition-colors hover:border-danger"
          >
            Clear local data & reload
          </button>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="index-card p-5 sm:p-6">
      <h2 className="font-serif text-lg font-semibold tracking-tight">{title}</h2>
      {lede && <p className="mb-5 mt-1 text-13 leading-relaxed text-muted">{lede}</p>}
      {children}
    </section>
  );
}
