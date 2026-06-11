import { ulid } from "ulid";
import { blobToBase64 } from "./api";
import { cardPath, serializeCardFile } from "./cardfile";
import { db, getDeviceId, type CardRow } from "./db";
import { contentHash, optimizeImage } from "./image";
import { requestSync } from "./sync";
import { rateCard } from "./scheduler";

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
    id: existing?.id ?? ulid(),
    deck: input.deck,
    front: input.front,
    back: input.back,
    created: existing?.created ?? new Date().toISOString().slice(0, 10),
    // Keep the original path on edit (renaming on every edit would churn git);
    // moving decks gets a new path + delete of the old one.
    path: existing && existing.deck === input.deck ? existing.path : "",
    sha: existing?.sha ?? null,
  };
  if (!card.path) {
    card.path = cardPath(input.deck, card.id, input.front);
    card.sha = null;
    if (existing && existing.path !== card.path) {
      await queueDelete(existing.path, existing.sha);
    }
  }

  await db.cards.put(card);
  await db.decks.put({ name: input.deck });
  await db.pendingFiles.put({
    path: card.path,
    op: "put",
    content: serializeCardFile(card),
    baseSha: card.sha ?? undefined,
    queuedAt: Date.now(),
  });
  requestSync(500);
  return card;
}

/** Register a deck and persist it to the repo (a .gitkeep keeps the folder). */
export async function createDeck(name: string): Promise<void> {
  const clean = name.trim().replace(/\.\./g, "").replace(/^\/+|\/+$/g, "");
  if (!clean) return;
  await db.decks.put({ name: clean });
  await db.pendingFiles.put({
    path: `decks/${clean}/.gitkeep`,
    op: "put",
    content: "",
    queuedAt: Date.now(),
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

/** Record a rating: update local FSRS state and queue the review for upload. */
export async function recordReview(
  cardId: string,
  rating: 1 | 2 | 3 | 4,
  now = new Date()
): Promise<void> {
  const row = await db.state.get(cardId);
  await db.state.put(rateCard(row, cardId, rating, now));
  await db.pendingReviews.put({
    id: ulid(),
    cardId,
    rating,
    reviewedAt: now.getTime(),
    deviceId: await getDeviceId(),
  });
  requestSync(2000); // coalesces across a burst of ratings
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
