import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, kvGet } from "../lib/db";
import { subscribeSync, syncAll, type SyncStatus } from "../lib/sync";
import { IconSync } from "./icons";

type State = "unknown" | "unconfigured" | "offline" | "syncing" | "failed" | "partial" | "synced" | "idle";

/**
 * Header sync indicator. Four main states — not connected / syncing / synced /
 * failed — plus offline and partial. Failure details open in a popover that
 * works on touch (no hover-only `title`).
 *
 * Reads the richer SyncResult fields defensively (`partial`, `failures`,
 * `skipped`), so it works with older sync engines that only have `ok` and
 * `errors`; anything missing degrades to the basics.
 */
export default function SyncPill() {
  const [sync, setSync] = useState<SyncStatus>({ syncing: false, last: null });
  const [online, setOnline] = useState(() => navigator.onLine);
  // The popover belongs to the route it was opened on: navigating closes it.
  const { pathname } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (o: boolean | ((prev: boolean) => boolean)) =>
    setOpenOn((typeof o === "function" ? o(open) : o) ? pathname : null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeSync(setSync), []);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);

  const configured = useLiveQuery(async () => Boolean(await kvGet<string>("appToken")), [], undefined);
  const pending = useLiveQuery(
    async () => {
      let n = (await db.pendingFiles.count()) + (await db.pendingReviews.count());
      // queued undos (newer schemas only)
      const undos = db.tables.find((t) => t.name === "pendingUndos");
      if (undos) n += await undos.count();
      return n;
    },
    [],
    0
  );

  // close the popover on outside tap / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenOn(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const last = sync.last as (NonNullable<SyncStatus["last"]> & ExtraResult) | null;
  const errors = failureLines(last);
  const skipped = typeof last?.skipped === "string" ? last.skipped : undefined;

  let state: State;
  if (configured === undefined) state = "unknown";
  else if (!configured || skipped === "unconfigured") state = "unconfigured";
  else if (sync.syncing) state = "syncing";
  else if (!online || skipped === "offline") state = "offline";
  else if (!last || skipped) state = last?.ok ? "synced" : "idle"; // suspended/aborted: nothing to report
  else if (!last.ok) state = "failed";
  else if (last.partial === true) state = "partial";
  else state = "synced";

  // the popover only shows while there is something to explain
  const hasDetails = state === "failed" || state === "partial" || state === "offline";

  const pill =
    "relative flex h-10 items-center sm:h-9 gap-2 rounded-full border px-3 text-13 font-medium transition-colors";
  const badge =
    pending > 0 && state !== "syncing" ? (
      <span
        className="rounded-full bg-warn-soft px-1.5 text-2xs font-semibold tabular-nums text-warn ring-1 ring-warn/30"
        aria-label={`${pending} change${pending === 1 ? "" : "s"} waiting to sync`}
      >
        {pending}
      </span>
    ) : null;

  if (state === "unknown") return <div className="ml-auto h-9" />;

  if (state === "unconfigured") {
    return (
      <Link
        to="/settings"
        className={`${pill} ml-auto border-dashed border-hairline-strong text-muted hover:border-accent-rule hover:text-accent`}
      >
        <span className="h-2 w-2 rounded-full border border-current" aria-hidden />
        Not connected
      </Link>
    );
  }

  const look: Record<Exclude<State, "unknown" | "unconfigured">, { cls: string; label: string; dot?: string }> = {
    syncing: { cls: "border-hairline bg-paper text-ink-2", label: "Syncing…" },
    synced: { cls: "border-hairline bg-paper text-ink-2 hover:border-accent-rule hover:text-accent", label: "Synced", dot: "bg-ok" },
    idle: { cls: "border-hairline bg-paper text-ink-2 hover:border-accent-rule hover:text-accent", label: "Sync" },
    offline: { cls: "border-hairline bg-sunken text-muted", label: "Offline", dot: "bg-faint" },
    partial: { cls: "border-warn/40 bg-warn-soft text-warn", label: "Partly synced", dot: "bg-warn" },
    failed: { cls: "border-danger/40 bg-danger-soft text-danger", label: "Sync failed", dot: "bg-danger" },
  };
  const { cls, label, dot } = look[state];

  return (
    <div ref={rootRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => (hasDetails ? setOpen((o) => !o) : void syncAll())}
        disabled={state === "syncing"}
        aria-expanded={hasDetails ? open : undefined}
        aria-haspopup={hasDetails ? "dialog" : undefined}
        aria-label={hasDetails ? `${label} — show details` : state === "syncing" ? "Syncing" : "Sync now"}
        className={`${pill} ${cls}`}
      >
        {dot && state !== "synced" ? (
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        ) : (
          <IconSync className={`h-3.5 w-3.5 ${state === "syncing" ? "animate-spin" : ""}`} />
        )}
        <span>{label}</span>
        {badge}
      </button>

      {open && hasDetails && (
        <div
          role="dialog"
          aria-label="Sync details"
          className="index-card absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] p-4 shadow-lg shadow-black/5"
        >
          <p className="text-sm font-semibold text-ink">
            {state === "offline"
              ? "You're offline"
              : state === "partial"
                ? "Some changes didn't sync"
                : "The last sync failed"}
          </p>
          <p className="mt-1 text-13 text-muted">
            {state === "offline"
              ? pending > 0
                ? `${pending} change${pending === 1 ? "" : "s"} saved on this device will sync when you're back online.`
                : "Everything is saved on this device and will sync when you're back online."
              : pending > 0
                ? `${pending} change${pending === 1 ? " is" : "s are"} saved on this device and will retry automatically.`
                : "Your cards are safe on this device. It will retry automatically."}
          </p>
          {state !== "offline" && errors.length > 0 && (
            <ul className="mt-3 max-h-[40vh] space-y-1.5 overflow-auto rounded border border-hairline bg-sunken p-2.5">
              {errors.map((err, i) => (
                <li key={i} className="break-words text-xs leading-relaxed text-ink-2">
                  {err.path && <span className="block font-mono font-medium text-ink">{err.path}</span>}
                  <span className="font-mono">{err.message}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-2">
            {state !== "offline" && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void syncAll();
                }}
                className="h-10 rounded-md bg-accent-fill px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-fill-hover"
              >
                Retry now
              </button>
            )}
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex h-10 items-center rounded-md px-3 text-sm font-medium text-accent hover:bg-accent-soft"
            >
              Sync settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Fields newer sync engines add to SyncResult — all optional here. */
interface ExtraResult {
  partial?: unknown;
  skipped?: unknown;
  failures?: unknown;
}

/** Per-file `failures` when present, else the flat `errors` strings. */
function failureLines(last: ({ errors?: unknown } & ExtraResult) | null): { path?: string; message: string }[] {
  if (!last) return [];
  if (Array.isArray(last.failures) && last.failures.length > 0) {
    return last.failures.map((f: unknown) => {
      const o = (f ?? {}) as { path?: unknown; message?: unknown };
      return {
        path: typeof o.path === "string" ? o.path : undefined,
        message: typeof o.message === "string" ? o.message : String(f),
      };
    });
  }
  return Array.isArray(last.errors) ? last.errors.map((e) => ({ message: String(e) })) : [];
}
