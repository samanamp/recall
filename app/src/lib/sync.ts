import { api, ApiError, b64ToText } from "./api";
import { deckFromPath, parseCardFile, serializeCardFile } from "./cardfile";
import { db, getSettings } from "./db";

/**
 * Sync engine (SPEC §6). Order matters:
 *  1. push queued file changes (cards/media) → repo
 *  2. pull repo manifest, fetch changed files
 *  3. push queued reviews → D1
 *  4. pull server-derived FSRS state (skipping cards with unpushed reviews)
 */

export interface SyncResult {
  ok: boolean;
  pushedFiles: number;
  pulledFiles: number;
  pushedReviews: number;
  errors: string[];
}

let syncing = false;

export async function syncAll(): Promise<SyncResult> {
  const result: SyncResult = {
    ok: true,
    pushedFiles: 0,
    pulledFiles: 0,
    pushedReviews: 0,
    errors: [],
  };
  if (syncing || !(await getSettings()) || !navigator.onLine) {
    result.ok = false;
    return result;
  }
  syncing = true;
  try {
    // Rare: queued card/media edits must land before we read the manifest.
    if (await db.pendingFiles.count()) await pushFiles(result);

    // Steady state is this single round trip: reviews up, manifest+state down.
    const pendingReviews = (await db.pendingReviews.toArray()).slice(0, 500);
    const { files, state } = await api.sync(pendingReviews);
    if (pendingReviews.length > 0) {
      await db.pendingReviews.bulkDelete(pendingReviews.map((r) => r.id));
      result.pushedReviews = pendingReviews.length;
    }

    // Only hits the network further if the manifest shows changes.
    await Promise.all([pullFiles(result, files), applyState(state)]);
  } catch (e) {
    result.ok = false;
    result.errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    syncing = false;
  }
  return result;
}

async function pushFiles(result: SyncResult): Promise<void> {
  const pending = (await db.pendingFiles.toArray()).sort((a, b) => a.queuedAt - b.queuedAt);
  for (const item of pending) {
    try {
      if (item.op === "put" && item.contentBase64 !== undefined) {
        const { sha } = await api.putMedia(item.path, item.contentBase64);
        await db.media.update(item.path, { sha });
      } else if (item.op === "put") {
        const sha = await putWithRetry(item.path, item.content ?? "", item.baseSha);
        await db.cards.where("path").equals(item.path).modify({ sha });
      } else {
        try {
          await api.deleteFile({ path: item.path, sha: item.baseSha ?? "" });
        } catch (e) {
          if (!(e instanceof ApiError && (e.status === 404 || e.status === 409))) throw e;
          if (e.status === 409) {
            const current = await api.getFile(item.path);
            await api.deleteFile({ path: item.path, sha: current.sha });
          }
          // 404: already gone — fine.
        }
      }
      await db.pendingFiles.delete(item.path);
      result.pushedFiles++;
    } catch (e) {
      // Leave in queue for next sync; report and continue with the rest.
      result.errors.push(`push ${item.path}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/** PUT a card file; on sha conflict refetch the current sha and overwrite (LWW). */
async function putWithRetry(path: string, content: string, baseSha?: string): Promise<string> {
  try {
    return (await api.putFile({ path, content, sha: baseSha })).sha;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) throw e;
    const current = await api.getFile(path).catch(() => null);
    return (await api.putFile({ path, content, sha: current?.sha })).sha;
  }
}

async function pullFiles(
  result: SyncResult,
  files: { path: string; sha: string }[]
): Promise<void> {
  const remote = new Map(files.map((f) => [f.path, f.sha]));
  const pendingPaths = new Set((await db.pendingFiles.toArray()).map((p) => p.path));

  // Register every deck folder seen in the repo (covers empty decks too).
  for (const [path] of remote) {
    if (!path.startsWith("decks/")) continue;
    const deck = path.split("/").slice(1, -1).join("/");
    if (deck) await db.decks.put({ name: deck });
  }

  // --- cards: collect everything that changed, then fetch in batches ---
  const localCards = await db.cards.toArray();
  const localByPath = new Map(localCards.map((c) => [c.path, c]));

  const changed: { path: string; sha: string }[] = [];
  for (const [path, sha] of remote) {
    if (!path.startsWith("decks/") || !path.endsWith(".md")) continue;
    if (pendingPaths.has(path)) continue; // local edit wins until pushed
    if (localByPath.get(path)?.sha === sha) continue;
    changed.push({ path, sha });
  }

  for (const batch of chunk(changed, 100)) {
    const { files } = await api.batchFiles(batch);
    for (const file of files) {
      const text = b64ToText(file.contentBase64);
      const { hadId, ...parsed } = parseCardFile(text);
      const local = localByPath.get(file.path);
      if (local && local.id !== parsed.id) await db.cards.delete(local.id);
      await db.cards.put({
        ...parsed,
        path: file.path,
        sha: file.sha,
        deck: deckFromPath(file.path),
      });
      result.pulledFiles++;

      // Hand-authored file without an id: normalize so review state stays attached.
      if (!hadId) {
        await db.pendingFiles.put({
          path: file.path,
          op: "put",
          content: serializeCardFile(parsed),
          baseSha: file.sha,
          queuedAt: Date.now(),
        });
      }
    }
  }

  // Cards whose file vanished remotely (deleted on another device / on GitHub).
  for (const card of localCards) {
    if (!remote.has(card.path) && !pendingPaths.has(card.path) && card.sha !== null) {
      await db.cards.delete(card.id);
      await db.state.delete(card.id);
    }
  }

  // --- media: raw binary (no base64 overhead), fetched in parallel ---
  const localMedia = await db.media.toArray();
  const mediaByPath = new Map(localMedia.map((m) => [m.path, m]));
  const changedMedia: { path: string; sha: string }[] = [];
  for (const [path, sha] of remote) {
    if (!path.startsWith("media/") || pendingPaths.has(path)) continue;
    if (mediaByPath.get(path)?.sha === sha) continue;
    changedMedia.push({ path, sha });
  }
  for (const batch of chunk(changedMedia, 6)) {
    await Promise.all(
      batch.map(async ({ path, sha }) => {
        const blob = await api.getMediaBlob(path);
        await db.media.put({ path, sha, blob });
        result.pulledFiles++;
      })
    );
  }
  for (const m of localMedia) {
    if (!remote.has(m.path) && !pendingPaths.has(m.path)) await db.media.delete(m.path);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function applyState(state: import("./api").ServerCardState[]): Promise<void> {
  // Cards with unpushed reviews keep their local (newer) state.
  const dirty = new Set((await db.pendingReviews.toArray()).map((r) => r.cardId));
  for (const row of state) {
    if (dirty.has(row.card_id) || !row.fsrs_json) continue;
    await db.state.put({
      cardId: row.card_id,
      due: row.due,
      state: row.state,
      fsrsJson: row.fsrs_json,
    });
  }
}
