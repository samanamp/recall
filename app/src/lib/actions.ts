import { ulid } from "ulid";
import { api, blobToBase64 } from "./api";
import { cardPath, serializeCardFile } from "./cardfile";
import {
  archiveMarker,
  bumpIntroducedToday,
  db,
  getDeviceId,
  type CardRow,
  type PendingReview,
  type StateRow,
} from "./db";
import { contentHash, optimizeImage } from "./image";
import { isReviewInFlight, isSyncing, requestSync } from "./sync";
import { newCardsInOrder, rateCard, studyRank } from "./scheduler";

/**
 * User actions. Everything writes to IndexedDB immediately (instant UX) and
 * enqueues the corresponding remote write; sync.ts drains the queues.
 */

export async function saveCard(input: {
  id?: string;
  deck: string;
  front: string;
  back: string;
}): Promise<CardRow> {
  const existing = input.id ? await db.cards.get(input.id) : undefined;
  const card: CardRow = {
    // A provided id for a new card is honored (the .apkg importer derives
    // deterministic ids from Anki card ids so re-imports update, not duplicate).
    id: existing?.id ?? input.id ?? ulid(),
    deck: input.deck,
    front: input.front,
    back: input.back,
    created: existing?.created ?? new Date().toISOString().slice(0, 10),
    // Keep the original path on edit (renaming on every edit would churn git);
    // moving decks gets a new path + delete of the old one.
    path: existing && existing.deck === input.deck ? existing.path : "",
    sha: existing?.sha ?? null,
    ...(existing?.order ? { order: existing.order } : {}),
    ...(existing?.archived ? { archived: true } : {}),
  };
  if (!card.path) {
    card.path = cardPath(input.deck, card.id, input.front);
    card.sha = null;
    if (existing && existing.path !== card.path) {
      await queueDelete(existing.path, existing.sha);
    }
  }

  await ensureDeck(input.deck);
  await writeCard(card);
  return card;
}

/** Store a card locally and queue its file for the repo. */
async function writeCard(card: CardRow): Promise<void> {
  await db.cards.put(card);
  await db.pendingFiles.put({
    path: card.path,
    op: "put",
    content: serializeCardFile(card),
    baseSha: card.sha ?? undefined,
    queuedAt: Date.now(),
  });
  requestSync(500);
}

/**
 * Archive or restore one card. An archived card stays in the repo with its
 * review history and schedule, but leaves every queue and count; restoring it
 * picks up where it was (overdue cards come straight back as due). The flag
 * lives in the card file, so it syncs like an edit.
 */
export async function setCardArchived(id: string, archived: boolean): Promise<void> {
  const card = await db.cards.get(id);
  if (!card || Boolean(card.archived) === archived) return;
  const { archived: _drop, ...rest } = card;
  void _drop;
  await writeCard(archived ? { ...rest, archived: true } : rest);
}

/** What `pushBack` changed, so it can be undone. `cardId` is the card undo brings back. */
export type PushBackUndo =
  | { kind: "moved"; cardId: string; previousOrder: string | undefined }
  | { kind: "reset"; cardId: string; copyId: string; original: CardRow; originalState: StateRow };

/** How far "show later" moves a card in study order. */
export const PUSH_BACK_BY = 20;

/**
 * "Show later": put a card `by` places later among the new cards of `deck`
 * (null = all decks).
 *
 * - A new card moves after the next `by` new cards (or last, if fewer are
 *   left); returns null when it is already last.
 * - A card in review has an FSRS schedule, not a place in line, so it is
 *   replaced: the card is deleted and a fresh copy (new id, so it starts as
 *   new) is created after the first `by` new cards. Its review history stays
 *   on the server under the old id, which is what lets undo restore it.
 *
 * Positions are written to the card files, so they sync like edits.
 */
export async function pushBack(cardId: string, deck: string | null, by = PUSH_BACK_BY): Promise<PushBackUndo | null> {
  const card = await db.cards.get(cardId);
  if (!card) return null;
  const order = await newCardsInOrder(deck);
  const state = await db.state.get(cardId);

  if (state) {
    const id = ulid();
    const copy: CardRow = {
      id,
      deck: card.deck,
      front: card.front,
      back: card.back,
      created: new Date().toISOString().slice(0, 10),
      path: cardPath(card.deck, id, card.front),
      sha: null,
      // A fresh ULID already sorts after every existing card, so with fewer
      // than `by` new cards left it needs no key to go last.
      ...(order.length >= by ? { order: `${studyRank(order[by - 1])}~` } : {}),
    };
    await deleteCard(cardId);
    await writeCard(copy);
    return { kind: "reset", cardId, copyId: id, original: card, originalState: state };
  }

  const at = order.findIndex((c) => c.id === cardId);
  const rest = order.filter((c) => c.id !== cardId);
  if (at < 0 || at >= rest.length) return null; // already last
  const after = rest[Math.min(at + by, rest.length) - 1];
  await writeCard({ ...card, order: `${studyRank(after)}~` });
  return { kind: "moved", cardId, previousOrder: card.order };
}

/** Undo `pushBack`: the card goes back where it was, with its schedule. */
export async function undoPushBack(undo: PushBackUndo): Promise<void> {
  if (undo.kind === "reset") {
    await deleteCard(undo.copyId);
    // Re-putting the original path replaces its queued delete; if the delete
    // already reached the repo, the push recreates the file.
    await db.state.put(undo.originalState);
    await writeCard(undo.original);
    return;
  }
  const card = await db.cards.get(undo.cardId);
  if (!card) return;
  const { order: _drop, ...rest } = card;
  void _drop;
  await writeCard(undo.previousOrder ? { ...rest, order: undo.previousOrder } : rest);
}

/** Register a deck without touching an existing row (it may be archived). */
async function ensureDeck(name: string): Promise<void> {
  if (!(await db.decks.get(name))) await db.decks.put({ name });
}

/** Register a deck and persist it to the repo (a .gitkeep keeps the folder). */
export async function createDeck(name: string): Promise<void> {
  const clean = name.trim().replace(/\.\./g, "").replace(/^\/+|\/+$/g, "");
  if (!clean) return;
  await ensureDeck(clean);
  await db.pendingFiles.put({
    path: `decks/${clean}/.gitkeep`,
    op: "put",
    content: "",
    queuedAt: Date.now(),
  });
  requestSync(500);
}

/** Delete a deck and every card in it (repo files included — git history keeps them). */
export async function deleteDeck(name: string): Promise<void> {
  const cards = await db.cards.where("deck").equals(name).toArray();
  for (const card of cards) {
    await db.cards.delete(card.id);
    await db.state.delete(card.id);
    await queueDelete(card.path, card.sha);
  }
  await db.decks.delete(name);
  // The folder keeper may or may not exist (UI-created vs imported decks);
  // the worker resolves the sha itself and treats "already gone" as success.
  await db.pendingFiles.put({
    path: `decks/${name}/.gitkeep`,
    op: "delete",
    queuedAt: Date.now(),
  });
  // Same for the archive marker: left behind, it would keep the folder alive.
  await db.pendingFiles.put({ path: archiveMarker(name), op: "delete", queuedAt: Date.now() });
  requestSync(300);
}

/**
 * Archive or restore a deck. Archived decks leave the home grid and the
 * all-decks queue; cards and review history are untouched. The flag travels
 * as a marker file in the deck folder, so every device agrees.
 */
export async function setDeckArchived(name: string, archived: boolean): Promise<void> {
  await db.transaction("rw", [db.decks, db.pendingFiles], async () => {
    await db.decks.put({ name, archived });
    await db.pendingFiles.put({
      path: archiveMarker(name),
      op: archived ? "put" : "delete",
      ...(archived ? { content: "" } : {}),
      queuedAt: Date.now(),
    });
  });
  requestSync(500);
}

export async function deleteCard(id: string): Promise<void> {
  const card = await db.cards.get(id);
  if (!card) return;
  await db.cards.delete(id);
  await db.state.delete(id);
  await queueDelete(card.path, card.sha);
  requestSync(500);
}

async function queueDelete(path: string, sha: string | null): Promise<void> {
  if (sha === null) {
    // Never pushed — just drop the queued create.
    await db.pendingFiles.delete(path);
    return;
  }
  await db.pendingFiles.put({ path, op: "delete", baseSha: sha, queuedAt: Date.now() });
}

/** Everything needed to reverse a rating (see undoReview). */
export interface ReviewUndo {
  reviewId: string;
  cardId: string;
  prevState: StateRow | undefined; // undefined = card was new
}

/** Record a rating: update local FSRS state and queue the review for upload. */
export async function recordReview(
  cardId: string,
  rating: 1 | 2 | 3 | 4,
  now = new Date()
): Promise<ReviewUndo> {
  const row = await db.state.get(cardId);
  if (!row) await bumpIntroducedToday(+1, now); // first-ever review = introduction
  await db.state.put(rateCard(row, cardId, rating, now));
  const reviewId = ulid();
  await db.pendingReviews.put({
    id: reviewId,
    cardId,
    rating,
    reviewedAt: now.getTime(),
    deviceId: await getDeviceId(),
  });
  requestSync(2000); // coalesces across a burst of ratings
  return { reviewId, cardId, prevState: row };
}

/**
 * How an undo was carried out:
 *  - "local":  the review hadn't left the device; it was simply dropped.
 *  - "server": it had been pushed; the worker deleted it and replayed the card.
 *  - "queued": it was pushed or in flight but the server couldn't be told
 *              right now (offline, error, sync running). The deletion is
 *              queued and sent before the next review push.
 * In every case local FSRS state is already restored when this resolves.
 */
export interface UndoResult {
  status: "local" | "server" | "queued";
}

/**
 * Reverse a rating. Never throws for network trouble — undo works offline.
 */
export async function undoReview(undo: ReviewUndo): Promise<UndoResult> {
  // One transaction with the pending-review check: sync claims reviews for a
  // request inside a transaction on the same table (sync.ts claimReviews), so
  // "still local" vs "in flight" can't change under us.
  const local = await db.transaction(
    "rw",
    [db.pendingReviews, db.pendingUndos, db.state, db.kv],
    async () => {
      const pending = await db.pendingReviews.get(undo.reviewId);
      const inFlight = isReviewInFlight(undo.reviewId);
      if (pending) await db.pendingReviews.delete(undo.reviewId);
      if (!pending || inFlight) {
        // The server has (or may soon have) it. Queue the deletion; the card
        // counts as dirty until it's sent, so server state can't undo the undo.
        await db.pendingUndos.put({
          reviewId: undo.reviewId,
          cardId: undo.cardId,
          queuedAt: Date.now(),
        });
      }
      if (undo.prevState) await db.state.put(undo.prevState);
      else {
        await db.state.delete(undo.cardId);
        await bumpIntroducedToday(-1, new Date()); // un-introduce
      }
      return pending !== undefined && !inFlight;
    }
  );
  requestSync(500);
  if (local) return { status: "local" };
  // While a sync runs, leave it to the follow-up pass: deleting now could
  // reach the worker before the in-flight insert, and the review would stick.
  if (isSyncing()) return { status: "queued" };
  try {
    await api.deleteReview(undo.reviewId); // idempotent
    await db.pendingUndos.delete(undo.reviewId);
    return { status: "server" };
  } catch {
    return { status: "queued" };
  }
}

/** A JSON backup as written by Settings → Export. */
export interface Backup {
  cards?: CardRow[];
  state?: StateRow[];
  pendingReviews?: PendingReview[];
}

export interface RestoreResult {
  restoredCards: number; // missing from the repo → re-queued for commit
  skippedCards: number; // already present (local copy and repo are newer)
  reviews: number; // unsynced reviews re-queued (idempotent server-side)
}

/**
 * Restore a backup *into the repo*. Card files the repo no longer has are
 * recreated (queued like a fresh save); cards that still exist are left
 * alone, because the live copy is at least as new as the backup and
 * overwriting it could silently revert edits. Needs the server: deciding
 * "missing" from a possibly stale local mirror could duplicate cards.
 *
 * Scheduling comes from the review log (server-authoritative), so backed-up
 * state is only a placeholder for cards that have none locally, and the
 * backup's unsynced reviews are re-queued so the log gets them.
 */
export async function restoreBackup(backup: Backup): Promise<RestoreResult> {
  const { files } = await api.manifest(); // throws when offline — by design
  const inRepo = new Set(files.map((f) => f.path));
  const out: RestoreResult = { restoredCards: 0, skippedCards: 0, reviews: 0 };
  await db.transaction(
    "rw",
    [db.cards, db.decks, db.pendingFiles, db.state, db.pendingReviews],
    async () => {
      for (const c of backup.cards ?? []) {
        const existing = await db.cards.get(c.id);
        if (existing || inRepo.has(c.path)) {
          out.skippedCards++;
          continue;
        }
        // Old path may be taken by now (or be from another layout): derive a
        // fresh one if so. sha null = never pushed, like a brand-new card.
        const taken = (await db.cards.where("path").equals(c.path).count()) > 0;
        const card: CardRow = {
          ...c,
          path: taken || !c.path ? cardPath(c.deck, c.id, c.front) : c.path,
          sha: null,
        };
        await db.cards.put(card);
        await ensureDeck(card.deck);
        await db.pendingFiles.put({
          path: card.path,
          op: "put",
          content: serializeCardFile(card),
          queuedAt: Date.now(),
        });
        out.restoredCards++;
      }
      for (const s of backup.state ?? []) {
        if (!(await db.state.get(s.cardId))) await db.state.put(s);
      }
      const reviews = backup.pendingReviews ?? [];
      await db.pendingReviews.bulkPut(reviews);
      out.reviews = reviews.length;
    }
  );
  requestSync(300);
  return out;
}

/**
 * Optimize (downscale + WebP), store locally, queue upload.
 * Content-hash naming dedupes identical pastes. Returns the repo path.
 */
export async function addMedia(input: Blob): Promise<string> {
  const { blob, ext } = await optimizeImage(input);
  const path = `media/${await contentHash(blob)}.${ext}`;
  if (await db.media.get(path)) return path; // already have this exact image
  await db.media.put({ path, sha: "", blob });
  await db.pendingFiles.put({
    path,
    op: "put",
    contentBase64: await blobToBase64(blob),
    queuedAt: Date.now(),
  });
  requestSync(1000);
  return path;
}
