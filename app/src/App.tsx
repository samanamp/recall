import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./lib/db";
import { subscribeSync, syncAll, type SyncStatus } from "./lib/sync";
import Decks from "./screens/Decks";
import Review from "./screens/Review";
import Editor from "./screens/Editor";
import Browser from "./screens/Browser";
import Settings from "./screens/Settings";

export default function App() {
  const [sync, setSync] = useState<SyncStatus>({ syncing: false, last: null });
  useEffect(() => subscribeSync(setSync), []);

  const pendingCount = useLiveQuery(
    async () => (await db.pendingFiles.count()) + (await db.pendingReviews.count()),
    [],
    0
  );

  const failed = sync.last !== null && !sync.last.ok && sync.last.errors.length > 0;

  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex-1 py-3 text-center text-sm font-medium transition-colors sm:flex-none sm:rounded-full sm:px-3.5 sm:py-1.5 ${
      isActive
        ? "text-sky-600 dark:text-sky-400 sm:bg-sky-500/10"
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
            onClick={() => void syncAll()}
            disabled={sync.syncing}
            title={failed ? sync.last?.errors.join("\n") : "Sync now"}
            className={`ml-auto flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium shadow-sm transition-colors ${
              failed
                ? "border-red-300 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-sky-400 hover:text-sky-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-sky-600 dark:hover:text-sky-400"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 ${sync.syncing ? "animate-spin" : ""}`}
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            <span className="hidden sm:inline">
              {sync.syncing ? "Syncing…" : failed ? "Sync failed" : "Synced"}
            </span>
            {pendingCount > 0 && !sync.syncing && (
              <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
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
