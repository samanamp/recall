import { useEffect, useState } from "react";
import { db, kvGet, kvSet } from "../lib/db";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { syncAll, type SyncResult } from "../lib/sync";

export default function Settings() {
  const [workerUrl, setWorkerUrl] = useState("");
  const [appToken, setAppToken] = useState("");
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [saved, setSaved] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void kvGet<string>("workerUrl").then((v) =>
      setWorkerUrl(v || (import.meta.env.VITE_WORKER_URL as string) || "")
    );
    void kvGet<string>("appToken").then((v) => setAppToken(v ?? ""));
  }, []);

  async function onSave() {
    await kvSet("workerUrl", workerUrl.trim());
    await kvSet("appToken", appToken.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function onSync() {
    setSyncing(true);
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
    "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700";

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 font-semibold">Sync</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Your deployed Cloudflare Worker URL and the app token you chose for it.
        </p>
        <div className="space-y-2">
          <input
            value={workerUrl}
            onChange={(e) => setWorkerUrl(e.target.value)}
            placeholder="https://recall-api.yourname.workers.dev"
            className={input}
          />
          <input
            value={appToken}
            onChange={(e) => setAppToken(e.target.value)}
            placeholder="app token"
            type="password"
            className={input}
          />
          <div className="flex gap-2">
            <button
              onClick={() => void onSave()}
              className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
            >
              {saved ? "Saved ✓" : "Save"}
            </button>
            <button
              onClick={() => void onSync()}
              disabled={syncing}
              className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm hover:border-sky-500 disabled:opacity-50 dark:border-zinc-700"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {syncResult && (
            <p className={`text-sm ${syncResult.ok ? "text-emerald-600" : "text-red-500"}`}>
              {syncResult.ok
                ? `✓ pushed ${syncResult.pushedFiles} files, ${syncResult.pushedReviews} reviews · pulled ${syncResult.pulledFiles} files`
                : `✗ ${syncResult.errors.join("; ") || "not configured or offline"}`}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Appearance</h2>
        <div className="flex gap-2">
          {(["system", "dark", "light"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTheme(t);
                setThemeState(t);
              }}
              className={`rounded-lg px-4 py-1.5 text-sm capitalize ${
                theme === t
                  ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "border border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Backup</h2>
        <div className="flex gap-2">
          <button
            onClick={() => void onExport()}
            className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm hover:border-sky-500 dark:border-zinc-700"
          >
            Export JSON
          </button>
          <label className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-1.5 text-sm hover:border-sky-500 dark:border-zinc-700">
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
