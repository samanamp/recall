/**
 * Anki .apkg import — browser-only orchestrator. Heavy deps (fflate, sql.js
 * wasm) load only when an import actually starts; keep this module behind a
 * dynamic import.
 *
 * Supports the legacy SQLite format (collection.anki2 / .anki21). The new
 * zstd-protobuf format (.anki21b) gets a clear "re-export with support for
 * older Anki versions" error — same approach as most third-party tools.
 */
import { saveCard, addMedia } from "./actions";
import { api } from "./api";
import {
  ankiDeckName,
  mapAnkiCards,
  referencedMedia,
  type AnkiCollection,
} from "./apkg-convert";
import { getSettings } from "./db";
import { requestSync } from "./sync";

export interface ImportProgress {
  phase: "reading" | "media" | "cards" | "reviews";
  done: number;
  total: number;
}

export interface ImportSummary {
  cards: number;
  decks: number;
  media: number;
  reviews: number;
  totalRevlog: number;
  skipped: number;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

interface AnkiReview {
  rid: number; // revlog id — also the review timestamp in ms
  cid: number;
  ease: number;
}

// Replays on the worker cost ~2 D1 queries per distinct card; the free tier
// allows 50 queries per invocation. Stay well under it.
const REVIEW_CHUNK_CARDS = 15;
const REVIEW_CHUNK_SIZE = 400;

export async function importApkg(
  file: File,
  onProgress: (p: ImportProgress) => void
): Promise<ImportSummary> {
  if (!(await getSettings())) {
    throw new Error("connect this device first (Settings → app token) so review history can be imported");
  }

  onProgress({ phase: "reading", done: 0, total: 1 });
  const { unzipSync, strFromU8 } = await import("fflate");
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));

  const dbBytes = zip["collection.anki21"] ?? zip["collection.anki2"];
  if (!dbBytes || dbBytes.length < 1024) {
    if (zip["collection.anki21b"]) {
      throw new Error(
        'this .apkg uses the new Anki format — re-export with "Support older Anki versions" checked'
      );
    }
    if (!dbBytes) throw new Error("no collection database found in the archive");
  }

  const initSqlJs = (await import("sql.js")).default;
  const wasmUrl = (await import("sql.js/dist/sql-wasm.wasm?url")).default;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const sdb = new SQL.Database(dbBytes);

  const rows = (sql: string): unknown[][] => {
    try {
      return sdb.exec(sql)[0]?.values ?? [];
    } catch {
      return [];
    }
  };

  // Deck names: legacy schema stores JSON in col.decks; newer schemas have a
  // decks table. Try both.
  const deckNames = new Map<number, string>();
  const colDecks = rows("SELECT decks FROM col")[0]?.[0];
  if (typeof colDecks === "string" && colDecks.startsWith("{")) {
    for (const [id, d] of Object.entries(JSON.parse(colDecks) as Record<string, { name: string }>)) {
      deckNames.set(Number(id), d.name);
    }
  }
  for (const [id, name] of rows("SELECT id, name FROM decks")) {
    deckNames.set(Number(id), String(name).replace(/\x1f/g, "::"));
  }

  const col: AnkiCollection = {
    notes: rows("SELECT id, flds FROM notes").map(([id, flds]) => ({
      id: Number(id),
      flds: String(flds),
    })),
    cards: rows("SELECT id, nid, did, ord FROM cards").map(([id, nid, did, ord]) => ({
      id: Number(id),
      nid: Number(nid),
      did: Number(did),
      ord: Number(ord),
    })),
    deckNames,
  };
  // Manual reschedules log ease 0 — they are not reviews. Everything else is
  // identity-mapped 1-4 regardless of review type (Anki v3 scheduler).
  const revlog: AnkiReview[] = rows(
    "SELECT id, cid, ease FROM revlog WHERE ease BETWEEN 1 AND 4 ORDER BY id"
  ).map(([rid, cid, ease]) => ({ rid: Number(rid), cid: Number(cid), ease: Number(ease) }));
  sdb.close();

  const { cards, skipped } = mapAnkiCards(col);
  if (cards.length === 0) throw new Error("no importable cards found");

  // ---- media: import referenced files through the normal optimize pipeline,
  // then rewrite ![](<anki name>) → ![](../../media/<hash>.<ext>).
  const mediaMap = new Map<string, string>(); // zip member name ← anki file name
  if (zip["media"]) {
    for (const [member, name] of Object.entries(
      JSON.parse(strFromU8(zip["media"])) as Record<string, string>
    )) {
      mediaMap.set(name, member);
    }
  }
  const wanted = [...referencedMedia(cards)].filter((n) => mediaMap.has(n));
  const pathByName = new Map<string, string>();
  let mediaDone = 0;
  for (const name of wanted) {
    onProgress({ phase: "media", done: mediaDone++, total: wanted.length });
    const bytes = zip[mediaMap.get(name)!];
    if (!bytes) continue;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    try {
      const path = await addMedia(new Blob([bytes.slice().buffer], { type: MIME[ext] ?? "application/octet-stream" }));
      pathByName.set(name, path);
    } catch {
      // unreadable image — leave the original reference, the card still imports
    }
  }
  const rewrite = (text: string): string => {
    let out = text;
    for (const [name, path] of pathByName) {
      out = out.split(`![](${name})`).join(`![](../../${path})`);
    }
    return out;
  };

  // ---- cards: through saveCard so files queue + sync like any other edit.
  const decks = new Set<string>();
  let cardsDone = 0;
  for (const m of cards) {
    onProgress({ phase: "cards", done: cardsDone++, total: cards.length });
    decks.add(m.deck);
    await saveCard({ id: m.id, deck: m.deck, front: rewrite(m.front), back: rewrite(m.back) });
  }

  // ---- reviews: pushed directly (not via the pending queue) in chunks small
  // enough that the worker's per-card replay stays inside D1's query budget.
  const idByCid = new Map(cards.map((m) => [m.cid, m.id]));
  const importable = revlog.filter((r) => idByCid.has(r.cid));
  let sent = 0;
  let chunk: { id: string; cardId: string; rating: number; reviewedAt: number; deviceId: string }[] = [];
  let chunkCards = new Set<string>();
  const flush = async () => {
    if (chunk.length === 0) return;
    await api.postReviews(chunk);
    sent += chunk.length;
    onProgress({ phase: "reviews", done: sent, total: importable.length });
    chunk = [];
    chunkCards = new Set();
  };
  for (const r of importable) {
    const cardId = idByCid.get(r.cid)!;
    if (
      chunk.length >= REVIEW_CHUNK_SIZE ||
      (chunkCards.size >= REVIEW_CHUNK_CARDS && !chunkCards.has(cardId))
    ) {
      await flush();
    }
    chunkCards.add(cardId);
    chunk.push({
      // Deterministic id: re-importing the same .apkg is a no-op server-side.
      id: `anki-${r.rid}`,
      cardId,
      rating: r.ease,
      reviewedAt: r.rid,
      deviceId: "apkg-import",
    });
  }
  await flush();

  requestSync(0); // pull the replayed card_state back down
  return {
    cards: cards.length,
    decks: decks.size,
    media: pathByName.size,
    reviews: sent,
    totalRevlog: revlog.length,
    skipped,
  };
}

export { ankiDeckName }; // re-export for the Settings screen copy
