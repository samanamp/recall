import { useEffect, useState } from "react";
import { db, kvGet, kvSet } from "../lib/db";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { syncAll, type SyncResult } from "../lib/sync";

export default function Settings() {
  const [workerUrl, setWorkerUrl] = useState("");
  const [appToken, setAppToken] = useState("");
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void kvGet<string>("workerUrl").then((v) =>
      setWorkerUrl(v || (import.meta.env.VITE_WORKER_URL as string) || "")
    );
    void kvGet<string>("appToken").then((v) => setAppToken(v ?? ""));
  }, []);

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
