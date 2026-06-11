import Dexie, { type EntityTable } from "dexie";
import { ulid } from "ulid";

/** A parsed card, mirrored from `decks/<deck>/<file>.md` in the cards repo. */
export interface CardRow {
  id: string; // ULID from frontmatter
  path: string; // repo path
  sha: string | null; // git blob sha; null until first successful push
  deck: string;
  front: string;
  back: string;
  created: string; // ISO date
}

export interface MediaRow {
  path: string; // media/<name>
  sha: string;
  blob: Blob;
}

/** Local FSRS scheduling state. Cards with no row are "new". */
export interface StateRow {
  cardId: string;
  due: number; // epoch ms
  state: number; // ts-fsrs State enum
  fsrsJson: string; // full serialized ts-fsrs Card
}

/** Review awaiting upload to the worker. */
export interface PendingReview {
  id: string; // ULID — idempotency key
  cardId: string;
  rating: number; // 1-4
  reviewedAt: number;
  deviceId: string;
}

/** Card or media file change awaiting commit to the repo. */
export interface PendingFile {
  path: string;
  op: "put" | "delete";
  content?: string; // markdown (card put)
  contentBase64?: string; // binary payload (media put)
  baseSha?: string; // sha we edited from, if updating/deleting
  queuedAt: number;
}

/** Deck registry — lets decks exist before they contain cards. */
export interface DeckRow {
  name: string;
}

export interface KVRow {
  key: string;
  value: unknown;
}

export const db = new Dexie("recall") as Dexie & {
  cards: EntityTable<CardRow, "id">;
  media: EntityTable<MediaRow, "path">;
  state: EntityTable<StateRow, "cardId">;
  pendingReviews: EntityTable<PendingReview, "id">;
  pendingFiles: EntityTable<PendingFile, "path">;
  decks: EntityTable<DeckRow, "name">;
  kv: EntityTable<KVRow, "key">;
};

db.version(1).stores({
  cards: "id, path, deck",
  media: "path",
  state: "cardId, due",
  pendingReviews: "id, cardId",
  pendingFiles: "path",
  kv: "key",
});

db.version(2).stores({
  decks: "name",
});

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export interface Settings {
  workerUrl: string;
  appToken: string;
  deviceId: string;
}

export async function getSettings(): Promise<Settings | null> {
  const [workerUrl, appToken] = await Promise.all([
    kvGet<string>("workerUrl"),
    kvGet<string>("appToken"),
  ]);
  if (!workerUrl || !appToken) return null;
  return { workerUrl, appToken, deviceId: await getDeviceId() };
}

/** Stable per-device id for the review log; created on first use. */
export async function getDeviceId(): Promise<string> {
  let id = await kvGet<string>("deviceId");
  if (!id) {
    id = ulid();
    await kvSet("deviceId", id);
  }
  return id;
}
