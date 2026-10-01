import { ulid } from "ulid";
import {
  api,
  ApiError,
  b64ToText,
  type FsrsParams,
  type ManifestFile,
  type ServerCardState,
} from "./api";
import { deckFromPath, parseCardFile, serializeCardFile } from "./cardfile";
import {
  archiveMarker,
  db,
  getSettings,
  kvDelete,
  kvGet,
  kvSet,
  type CardRow,
  type PendingFile,
  type PendingReview,
} from "./db";
import { configureScheduler } from "./scheduler";

/**
 * Sync engine (SPEC §6). Order matters:
 *  1. push queued file changes (cards/media) → repo
 *  2. send queued undos, then queued reviews → D1
 *  3. pull repo manifest, fetch changed files
 *  4. pull server-derived FSRS state (skipping cards with unpushed reviews/undos)
 *
 * Everything the user does locally while a sync is in flight must survive it:
 * every write here re-checks the queues inside the same Dexie transaction
 * instead of trusting a snapshot taken before a network call.
 */

/** One item that failed while the sync as a whole went through. */
export interface SyncFailure {
  /** Repo path, `review <id>` for an undo, or `decks/` for the manifest guard. */
  path: string;
  message: string;
}

export interface SyncResult {
  /** The /sync round trip and the pull completed. */
  ok: boolean;
  /** ok, but some items failed or were deferred — see `failures`. */
  partial: boolean;
  failures: SyncFailure[];
  /** Set when the sync didn't run (or was cut short) for a non-error reason. */
  skipped?: "unconfigured" | "offline" | "suspended" | "aborted";
  pushedFiles: number;
  pulledFiles: number;
  pushedReviews: number;
  /** Every problem as display text (includes `failures`). */
  errors: string[];
}

/** The worker rejects review batches larger than this. */
const REVIEW_BATCH = 500;

// ---- status store: lets the UI observe syncs no matter who triggered them ----

export interface SyncStatus {
  syncing: boolean;
  last: SyncResult | null;
}

let status: SyncStatus = { syncing: false, last: null };
const listeners = new Set<(s: SyncStatus) => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
}

export function subscribeSync(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => {
    listeners.delete(fn);
  };
}

// ---- run control ----

let running: Promise<SyncResult> | null = null;
let followUp: Promise<SyncResult> | null = null;

/**
 * Bumped by stopSync(). A sync remembers the generation it started in and
 * refuses to write once it changes, so a response landing after "Clear
 * storage" can't repopulate the wiped database.
 */
let generation = 0;
let suspended = false;

/** Review ids sent in a request that hasn't settled yet (see undoReview). */
const inFlightReviews = new Set<string>();

export function isReviewInFlight(id: string): boolean {
  return inFlightReviews.has(id);
}

export function isSyncing(): boolean {
  return running !== null;
}

class SyncAborted extends Error {
  constructor() {
    super("sync aborted: local data was reset");
  }
}

interface Run {
  result: SyncResult;
  gen: number;
}

/** Throw if local data was reset since this sync started. */
function alive(run: Run): void {
  if (run.gen !== generation) throw new SyncAborted();
}

// ---- opportunistic scheduling ----

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced sync: actions call this freely; bursts coalesce into one call. */
export function requestSync(delayMs = 1500): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncAll(), delayMs);
}

/** Wire up every opportunity to sync. Call once at app start. */
export function startAutoSync(): void {
  // Apply last-synced FSRS params immediately (works offline too).
  void kvGet<FsrsParams>("fsrsParams").then((p) => {
    if (p) configureScheduler(p.retention, p.weights);
  });
  void syncAll();
  const soon = () => requestSync(300);
  window.addEventListener("focus", soon);
  window.addEventListener("online", soon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") soon();
  });
  // Heartbeat while the tab is open — steady-state sync is a single ~100ms call.
  setInterval(() => {
    if (document.visibilityState === "visible") requestSync(0);
  }, 60_000);
}

/**
 * Stop syncing for the rest of this page's life and give an in-flight sync a
 * moment to wind down. Call before wiping local data (then reload): whatever
 * the old sync still tries to write is discarded by the generation check.
 */
export async function stopSync(timeoutMs = 5000): Promise<void> {
  suspended = true;
  generation++;
  clearTimeout(timer);
  const inFlight = running;
  if (inFlight) {
    await Promise.race([inFlight, new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}

export function syncAll(): Promise<SyncResult> {
  if (!running) {
    running = runSync().finally(() => {
      running = null;
    });
    return running;
  }
  // The running sync may already have read the queues, so the change that
  // prompted this call could miss it. Owe exactly one more pass; everyone who
  // asks meanwhile shares it (and gets its result).
  followUp ??= running.then(() => {
    followUp = null;
    return syncAll();
  });
  return followUp;
}

function emptyResult(): SyncResult {
  return {
    ok: true,
    partial: false,
    failures: [],
    pushedFiles: 0,
    pulledFiles: 0,
    pushedReviews: 0,
    errors: [],
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Record an item-level failure: the sync continues but is only partial. */
function fail(result: SyncResult, path: string, message: string): void {
  result.partial = true;
  result.failures.push({ path, message });
  result.errors.push(`${path}: ${message}`);
}

const isCardPath = (p: string) => p.startsWith("decks/") && p.endsWith(".md");

async function runSync(): Promise<SyncResult> {
  const result = emptyResult();
  const skip = (why: NonNullable<SyncResult["skipped"]>) => {
    result.ok = false;
    result.skipped = why;
    return result;
  };
  if (suspended) return skip("suspended");
  if (!(await getSettings())) return skip("unconfigured");
  // Only an explicit `false` means offline (node/test runtimes lack onLine).
  if (typeof navigator !== "undefined" && navigator.onLine === false) return skip("offline");

  const run: Run = { result, gen: generation };
  let remoteHasCards: boolean | undefined;
  setStatus({ syncing: true });
  try {
    // Rare: queued card/media edits must land before we read the manifest.
    if (await db.pendingFiles.count()) await pushFiles(run);

    // Undos first: a queued undo's review must be gone before state comes back.
    await flushUndos(run);
    await pushReviewBacklog(run);

    // Steady state is this single round trip: reviews up, manifest+state down.
    // The cursor makes the no-change case (heartbeats) a ~60-byte response.
    // No cards locally ⇒ the mirror was wiped or never filled: ask for
    // everything rather than risk an "unchanged" answer.
    const lastCursor =
      (await db.cards.count()) > 0 ? await kvGet<string>("syncCursor") : undefined;
    // The state watermark is only meaningful alongside a valid cursor: both
    // are saved together, after a fully applied response.
    const stateSince = lastCursor ? await kvGet<number>("stateWatermark") : undefined;
    const reviews = await claimReviews();
    let resp: Awaited<ReturnType<typeof api.sync>>;
    try {
      resp = await api.sync(reviews, lastCursor, stateSince);
      await settleReviews(run, reviews);
    } finally {
      releaseReviews(reviews);
    }
    alive(run);
    await kvSet("reviewCount", resp.reviewCount);

    if (!resp.unchanged) {
      // The old cursor is about to be wrong. Drop it first, and store the new
      // one only once files and state are applied: if anything below fails,
      // the next sync must receive the full payload again.
      await kvDelete("syncCursor");
      // Scheduling params are server-authoritative; adopt them everywhere.
      await kvSet("fsrsParams", resp.params);
      configureScheduler(resp.params!.retention, resp.params!.weights);
      // Sequential on purpose: applyState must not race the card deletions.
      // With `filesUnchanged` the manifest is the one we already mirror.
      const settled = resp.filesUnchanged ? true : await pullFiles(run, resp.files!);
      await applyState(run, resp.state!, resp.stateIsDelta === true, resp.deletedState ?? []);
      if (!resp.filesUnchanged) remoteHasCards = resp.files!.some((f) => isCardPath(f.path));
      // Deferred deletions (first strike, empty-manifest guard) leave the
      // cursor unset so the next heartbeat pulls in full and re-decides.
      alive(run);
      if (settled) {
        const watermark = Math.max(
          resp.stateIsDelta ? (stateSince ?? 0) : 0,
          ...resp.state!.map((r) => r.updated_at ?? 0)
        );
        await kvSet("stateWatermark", watermark);
        await kvSet("syncCursor", resp.cursor);
      }
    }
  } catch (e) {
    result.ok = false;
    if (e instanceof SyncAborted) result.skipped = "aborted";
    result.errors.push(errMsg(e));
  } finally {
    setStatus({ syncing: false, last: result });
  }
  // Seed the welcome deck only when this sync proved the repo has no cards
  // (a full manifest arrived). An "unchanged" reply or a failed pull tells us
  // nothing, and seeding then could commit tutorial cards into a real repo.
  // Dynamic import: actions.ts imports this module (cycle).
  if (result.ok && remoteHasCards !== undefined && run.gen === generation && !suspended) {
    const hasCards = remoteHasCards;
    void import("./welcome").then((m) => m.maybeSeedWelcome(hasCards));
  }
  return result;
}

// ---- reviews ----

/**
 * Take the oldest queued reviews and mark them in flight. Read and mark
 * happen inside one transaction: undoReview checks the in-flight set from a
 * readwrite transaction on the same table, and IndexedDB orders the two, so
 * an undo sees the review either as still local or as claimed — never in
 * between.
 */
async function claimReviews(limit = REVIEW_BATCH): Promise<PendingReview[]> {
  return db.transaction("r", db.pendingReviews, async () => {
    const batch = await db.pendingReviews.orderBy("id").limit(limit).toArray();
    for (const r of batch) inFlightReviews.add(r.id);
    return batch;
  });
}

async function settleReviews(run: Run, batch: PendingReview[]): Promise<void> {
  if (batch.length === 0) return;
  alive(run);
  // Rows undone mid-flight are already gone; bulkDelete ignores them.
  await db.pendingReviews.bulkDelete(batch.map((r) => r.id));
  run.result.pushedReviews += batch.length;
}

function releaseReviews(batch: PendingReview[]): void {
  for (const r of batch) inFlightReviews.delete(r.id);
}

/**
 * /sync carries at most one batch. A longer backlog (long offline stretch,
 * backup restore) goes up via POST /reviews first so it all lands this pass
 * instead of 500 per heartbeat.
 */
async function pushReviewBacklog(run: Run): Promise<void> {
  while ((await db.pendingReviews.count()) > REVIEW_BATCH) {
    const batch = await claimReviews();
    try {
      await api.postReviews(batch);
      await settleReviews(run, batch);
    } finally {
      releaseReviews(batch);
    }
  }
}

/** Send undos queued while offline or while their review was in flight. */
async function flushUndos(run: Run): Promise<void> {
  for (const u of await db.pendingUndos.toArray()) {
    try {
      // Idempotent: a review that never arrived comes back `missing: true`.
      await api.deleteReview(u.reviewId);
      alive(run);
      await db.pendingUndos.delete(u.reviewId);
    } catch (e) {
      if (e instanceof SyncAborted) throw e;
      fail(run.result, `review ${u.reviewId}`, `undo failed — ${errMsg(e)}`);
    }
  }
}

// ---- file push ----

async function pushFiles(run: Run): Promise<void> {
  const order = (await db.pendingFiles.toArray())
    .sort((a, b) => a.queuedAt - b.queuedAt)
    .map((p) => p.path);
  for (const path of order) {
    // Re-read: the entry may have been replaced or dropped while earlier
    // items were pushing.
    const item = await db.pendingFiles.get(path);
    if (!item) continue;
    try {
      const sha = await pushOne(item);
      await settleFile(run, item, sha);
      run.result.pushedFiles++;
    } catch (e) {
      if (e instanceof SyncAborted) throw e;
      // Leave it queued for the next sync; report and continue with the rest.
      fail(run.result, path, `push failed — ${errMsg(e)}`);
    }
  }
}

/** Returns the new blob sha, or null (deleted / media already in the repo). */
async function pushOne(item: PendingFile): Promise<string | null> {
  if (item.op === "delete") {
    // Worker resolves missing/stale shas and treats already-deleted as ok.
    await api.deleteFile({ path: item.path, sha: item.baseSha });
    return null;
  }
  if (item.contentBase64 !== undefined) {
    try {
      return (await api.putMedia(item.path, item.contentBase64)).sha;
    } catch (e) {
      // Media is named by content hash, so "already exists" (GitHub's 422,
      // which the worker maps to 409) means these exact bytes are in the repo
      // — e.g. an upload whose response was lost. Retrying can never succeed;
      // count it as done and learn the sha from the manifest on the pull.
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) return null;
      throw e;
    }
  }
  return putWithRetry(item.path, item.content ?? "", item.baseSha);
}

function sameEntry(a: PendingFile, b: PendingFile): boolean {
  return (
    a.queuedAt === b.queuedAt &&
    a.op === b.op &&
    a.content === b.content &&
    a.contentBase64 === b.contentBase64 &&
    a.baseSha === b.baseSha
  );
}

/** Record a successful push without clobbering anything queued meanwhile. */
async function settleFile(run: Run, pushed: PendingFile, sha: string | null): Promise<void> {
  const isMedia = pushed.contentBase64 !== undefined;
  await db.transaction("rw", [db.pendingFiles, db.cards, db.media], async () => {
    alive(run);
    const current = await db.pendingFiles.get(pushed.path);
    if (current && sameEntry(current, pushed)) {
      await db.pendingFiles.delete(pushed.path);
    } else if (current) {
      // Re-queued while our request was in flight (saved again, moved,
      // deleted). The newer entry must still go up, but based on the commit
      // we just made — or it would 409 against ourselves.
      await db.pendingFiles.put({ ...current, baseSha: sha ?? undefined });
    } else if (
      pushed.op === "put" &&
      sha &&
      isCardPath(pushed.path) &&
      (await db.cards.where("path").equals(pushed.path).count()) === 0
    ) {
      // Created, then deleted or moved while its first push was in flight:
      // queueDelete dropped the sha-less entry, yet the file now exists in
      // the repo. Delete it, or the next pull resurrects the card.
      await db.pendingFiles.put({
        path: pushed.path,
        op: "delete",
        baseSha: sha,
        queuedAt: Date.now(),
      });
    }
    if (pushed.op === "put" && sha) {
      // Even if a newer local edit is queued, the card's sha must track the
      // repo so the next save's baseSha is right.
      if (isMedia) await db.media.update(pushed.path, { sha });
      else await db.cards.where("path").equals(pushed.path).modify({ sha });
    }
  });
}

/** PUT a card file; on conflict, overwrite whatever is there (LWW). */
async function putWithRetry(path: string, content: string, baseSha?: string): Promise<string> {
  try {
    return (await api.putFile({ path, content, sha: baseSha })).sha;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // Deleted remotely after we edited it: recreate rather than wedge the queue.
    if (e.status === 404) return (await api.putFile({ path, content })).sha;
    if (e.status !== 409) throw e;
    const current = await api.getFile(path).catch(() => null);
    return (await api.putFile({ path, content, sha: current?.sha })).sha;
  }
}

// ---- pull ----

/**
 * Mirror the manifest locally. Returns false when deletions were deferred
 * (so the caller doesn't advance the cursor and the next sync re-checks).
 */
async function pullFiles(run: Run, files: ManifestFile[]): Promise<boolean> {
  const { result } = run;
  const remote = new Map(files.map((f) => [f.path, f.sha]));
  const localCards = await db.cards.toArray();

  // An empty manifest while we hold pushed cards is far likelier a broken
  // repo/config or cache glitch than "deleted everything elsewhere". Never
  // let it wipe the collection.
  const remoteHasCards = files.some((f) => isCardPath(f.path));
  const trustDeletions = remoteHasCards || !localCards.some((c) => c.sha !== null);
  if (!trustDeletions) {
    fail(result, "decks/", "remote repository returned no cards; skipping deletions");
  }

  await syncDecks(run, remote, trustDeletions);
  await pullCards(run, remote, localCards);
  const settled = trustDeletions ? await removeVanishedCards(run, remote) : false;
  await pullMedia(run, remote, trustDeletions);
  return settled;
}

/**
 * Register every deck folder in the repo (covers empty decks too), adopt its
 * archived flag (the `.archived` marker), and prune decks that are gone.
 */
async function syncDecks(run: Run, remote: Map<string, string>, prune: boolean): Promise<void> {
  const remoteDecks = new Set<string>();
  for (const path of remote.keys()) {
    if (!path.startsWith("decks/")) continue;
    const deck = path.split("/").slice(1, -1).join("/");
    if (deck) remoteDecks.add(deck);
  }
  // One transaction, bulk ops: every write wakes each live query once.
  await db.transaction("rw", [db.decks, db.pendingFiles], async () => {
    alive(run);
    const rows = await db.decks.toArray();
    const local = rows.map((d) => d.name);
    const archivedLocal = new Map(rows.map((d) => [d.name, d.archived === true]));
    const pending = await db.pendingFiles.toCollection().primaryKeys();
    // New decks, and known ones whose marker changed elsewhere. A marker
    // change still queued here wins until it is pushed.
    const changed = [...remoteDecks]
      .map((name) => ({ name, archived: remote.has(archiveMarker(name)) }))
      .filter(
        (d) =>
          !archivedLocal.has(d.name) ||
          (archivedLocal.get(d.name) !== d.archived && !pending.includes(archiveMarker(d.name)))
      );
    if (changed.length) await db.decks.bulkPut(changed);
    if (!prune) return;
    // Deleted elsewhere — unless something local under it is still queued.
    const gone = local.filter(
      (d) => !remoteDecks.has(d) && !pending.some((p) => p.startsWith(`decks/${d}/`))
    );
    if (gone.length) await db.decks.bulkDelete(gone);
  });
}

async function pullCards(
  run: Run,
  remote: Map<string, string>,
  localCards: CardRow[]
): Promise<void> {
  const pendingPaths = new Set(await db.pendingFiles.toCollection().primaryKeys());
  const localByPath = new Map(localCards.map((c) => [c.path, c]));

  // Path order makes duplicate resolution (below) the same on every device.
  const changed = [...remote]
    .filter(([path, sha]) => isCardPath(path) && !pendingPaths.has(path) && localByPath.get(path)?.sha !== sha)
    .map(([path, sha]) => ({ path, sha }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const changedPaths = new Set(changed.map((c) => c.path));

  // Which path keeps each id: files we already mirror unchanged, and local
  // cards with queued edits. A fetched file claiming an id held by another
  // path is a copy, not a move — a move's old path is gone from the manifest.
  const idOwner = new Map<string, string>();
  for (const c of localCards) {
    const unchanged = remote.has(c.path) && !changedPaths.has(c.path);
    if (unchanged || pendingPaths.has(c.path)) idOwner.set(c.id, c.path);
  }

  // ≤40 per call: each file costs the worker one GitHub subrequest, and the
  // Cloudflare free tier hard-caps 50 subrequests per invocation.
  for (const batch of chunk(changed, 40)) {
    const { files } = await api.batchFiles(batch);
    await db.transaction("rw", [db.cards, db.pendingFiles], async () => {
      alive(run);
      for (const file of files) {
        // A local save that landed while this batch downloaded wins until pushed.
        if (await db.pendingFiles.get(file.path)) continue;
        const { hadId, ...parsed } = parseCardFile(b64ToText(file.contentBase64));
        const owner = idOwner.get(parsed.id);
        const duplicate = hadId && owner !== undefined && owner !== file.path;
        const card: CardRow = {
          ...parsed,
          id: duplicate ? ulid() : parsed.id,
          path: file.path,
          sha: file.sha,
          deck: deckFromPath(file.path),
        };
        idOwner.set(card.id, file.path);

        // This path used to hold a different card: drop that row so two rows
        // never share a path — but only if it's still here (it may have just
        // moved). Its state row stays; review history is keyed by id.
        const prev = localByPath.get(file.path);
        if (prev && prev.id !== card.id) {
          const row = await db.cards.get(prev.id);
          if (row?.path === file.path) await db.cards.delete(prev.id);
        }
        await db.cards.put(card);
        run.result.pulledFiles++;

        // Hand-authored file without an id, or a copy of another card's file:
        // write the (new) id back so review state attaches to exactly one file.
        if (!hadId || duplicate) {
          await db.pendingFiles.put({
            path: file.path,
            op: "put",
            content: serializeCardFile(card),
            baseSha: file.sha,
            queuedAt: Date.now(),
          });
        }
      }
    });
  }
}

/**
 * Delete cards whose file vanished remotely (deleted on another device or on
 * GitHub). Returns false while some card is on its first strike.
 */
async function removeVanishedCards(run: Run, remote: Map<string, string>): Promise<boolean> {
  return db.transaction("rw", [db.cards, db.state, db.pendingFiles, db.kv], async () => {
    alive(run);
    const pending = new Set(await db.pendingFiles.toCollection().primaryKeys());
    const prevMissing = (await kvGet<Record<string, number>>("missingSince")) ?? {};
    const missing: Record<string, number> = {};
    const doomed: string[] = [];
    // Fresh read, not the pre-pull snapshot: a card that moved has its new
    // path by now and must not be mistaken for a deleted one.
    for (const card of await db.cards.toArray()) {
      if (remote.has(card.path) || pending.has(card.path) || card.sha === null) continue;
      // One absence can be a manifest race (cache refresh mid-commit); only
      // delete once the next full pull agrees.
      if (prevMissing[card.id] !== undefined) doomed.push(card.id);
      else missing[card.id] = Date.now();
    }
    if (doomed.length) {
      await db.cards.bulkDelete(doomed);
      await db.state.bulkDelete(doomed);
    }
    await kvSet("missingSince", missing);
    return Object.keys(missing).length === 0;
  });
}

/** Media: raw binary (no base64 overhead), fetched in parallel. */
async function pullMedia(run: Run, remote: Map<string, string>, prune: boolean): Promise<void> {
  const pendingPaths = new Set(await db.pendingFiles.toCollection().primaryKeys());
  const localMedia = await db.media.toArray();
  const byPath = new Map(localMedia.map((m) => [m.path, m]));
  const learned: { path: string; sha: string }[] = [];
  const changed: { path: string; sha: string }[] = [];
  for (const [path, sha] of remote) {
    if (!path.startsWith("media/") || pendingPaths.has(path)) continue;
    const local = byPath.get(path);
    if (local?.sha === sha) continue;
    // Uploaded from here, but the repo already had it so no sha came back.
    // Content-hash naming means our blob is those bytes: just learn the sha.
    if (local?.sha === "") learned.push({ path, sha });
    else changed.push({ path, sha });
  }
  if (learned.length) {
    await db.transaction("rw", db.media, async () => {
      alive(run);
      for (const { path, sha } of learned) await db.media.update(path, { sha });
    });
  }
  for (const batch of chunk(changed, 6)) {
    const rows = await Promise.all(
      batch.map(async ({ path, sha }) => ({ path, sha, blob: await api.getMediaBlob(path) }))
    );
    await db.transaction("rw", [db.media, db.pendingFiles], async () => {
      alive(run);
      const keep = [];
      for (const r of rows) if (!(await db.pendingFiles.get(r.path))) keep.push(r);
      await db.media.bulkPut(keep);
      run.result.pulledFiles += keep.length;
    });
  }
  if (!prune) return;
  // sha "" = ours, not yet seen in a manifest; deleting could lose the only copy.
  const gone = localMedia
    .filter((m) => !remote.has(m.path) && !pendingPaths.has(m.path) && m.sha !== "")
    .map((m) => m.path);
  if (gone.length) {
    await db.transaction("rw", db.media, async () => {
      alive(run);
      await db.media.bulkDelete(gone);
    });
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Adopt server-derived FSRS state. One transaction with bulk ops, so live
 * queries wake once rather than once per card.
 */
async function applyState(
  run: Run,
  state: ServerCardState[],
  isDelta: boolean,
  deleted: string[] = []
): Promise<void> {
  await db.transaction("rw", [db.state, db.pendingReviews, db.pendingUndos], async () => {
    alive(run);
    // Cards with unpushed reviews or undos keep their local (newer) state.
    const dirty = new Set<string>([
      ...((await db.pendingReviews.orderBy("cardId").uniqueKeys()) as string[]),
      ...((await db.pendingUndos.orderBy("cardId").uniqueKeys()) as string[]),
    ]);
    const rows = state
      .filter((r) => r.fsrs_json && !dirty.has(r.card_id))
      .map((r) => ({ cardId: r.card_id, due: r.due, state: r.state, fsrsJson: r.fsrs_json! }));
    if (rows.length) await db.state.bulkPut(rows);
    if (isDelta) {
      // A delta names its deletions explicitly (server tombstones).
      const gone = deleted.filter((id) => !dirty.has(id));
      if (gone.length) await db.state.bulkDelete(gone);
      return;
    }
    // A full table: any local row the server lacks is stale — e.g. the card's
    // only review was undone on another device, so it's new again.
    const onServer = new Set(state.map((r) => r.card_id));
    const stale = (await db.state.toCollection().primaryKeys()).filter(
      (id) => !onServer.has(id) && !dirty.has(id)
    );
    if (stale.length) await db.state.bulkDelete(stale);
  });
}
