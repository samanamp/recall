import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./lib/db";
import { syncAll, type SyncResult } from "./lib/sync";
import Decks from "./screens/Decks";
import Review from "./screens/Review";
import Editor from "./screens/Editor";
import Browser from "./screens/Browser";
import Settings from "./screens/Settings";

export default function App() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const pendingCount = useLiveQuery(
    async () => (await db.pendingFiles.count()) + (await db.pendingReviews.count()),
    [],
    0
  );

  async function runSync() {
    setSyncing(true);
    setLastSync(await syncAll());
    setSyncing(false);
  }

  useEffect(() => {
    void runSync(); // on launch
    const onFocus = () => void runSync();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, []);

  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex-1 py-3 text-center text-sm font-medium transition-colors sm:flex-none sm:px-4 sm:py-2 sm:rounded-lg ${
      isActive
        ? "text-sky-600 dark:text-sky-400 sm:bg-sky-100 sm:dark:bg-sky-950"
        : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
    }`;

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-3xl lg:max-w-4xl items-center gap-2 px-4 py-2">
          <NavLink to="/" className="text-lg font-bold tracking-tight">
            re<span className="text-sky-500">call</span>
          </NavLink>
          {/* desktop nav */}
          <nav className="ml-4 hidden gap-1 sm:flex">
            <NavLink to="/" end className={tab}>Decks</NavLink>
            <NavLink to="/new" className={tab}>Add</NavLink>
            <NavLink to="/browse" className={tab}>Browse</NavLink>
            <NavLink to="/settings" className={tab}>Settings</NavLink>
          </nav>
          <button
            onClick={() => void runSync()}
            disabled={syncing}
            title={lastSync?.errors.join("\n") || "Sync"}
            className="ml-auto rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 disabled:animate-pulse dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {syncing ? "⟳ syncing…" : lastSync && !lastSync.ok ? "⟳ ⚠️" : "⟳"}
            {pendingCount > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">
                {pendingCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl lg:max-w-4xl px-4 py-3 pb-20 sm:pb-8">
        <Routes>
          <Route path="/" element={<Decks />} />
          <Route path="/review/:deck" element={<Review />} />
          <Route path="/new" element={<Editor />} />
          <Route path="/edit/:id" element={<Editor />} />
          <Route path="/browse" element={<Browser />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-200 bg-zinc-50/95 backdrop-blur sm:hidden dark:border-zinc-800/70 dark:bg-zinc-950/95">
        <NavLink to="/" end className={tab}>Decks</NavLink>
        <NavLink to="/new" className={tab}>Add</NavLink>
        <NavLink to="/browse" className={tab}>Browse</NavLink>
        <NavLink to="/settings" className={tab}>Settings</NavLink>
      </nav>
    </div>
  );
}
