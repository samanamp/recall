// ----------------------------------------------------- manifest cache
//
// GitHub's tree API costs 600-1200ms — far too slow to sit on the sync hot
// path. The cache is served from D1 (~30ms), patched synchronously whenever
// this worker writes a file, and revalidated against GitHub in the background
// when older than the TTL (covers edits made directly on GitHub).
//
// Devices mirror this list exactly: a file missing from it is deleted locally.
// So an empty or partial list must never land by accident, and the list is
// kept sorted so "same content" is a plain string comparison.

import type { Env } from "./env";
import { getTree } from "./github";

export const MANIFEST_TTL_MS = 60_000;
const PATCH_ATTEMPTS = 3;

export interface ManifestFile {
  path: string;
  sha: string;
}

export interface ManifestRow {
  json: string;
  fetched_at: number;
  version: number;
}

export function sortManifest(files: ManifestFile[]): ManifestFile[] {
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Replace (or remove, when sha is null) one path, keeping the list sorted. */
export function patchFiles(files: ManifestFile[], path: string, sha: string | null): ManifestFile[] {
  const next = files.filter((f) => f.path !== path);
  if (sha) next.push({ path, sha });
  return sortManifest(next);
}

export function readManifestRow(db: D1Database): Promise<ManifestRow | null> {
  return db
    .prepare("SELECT json, fetched_at, version FROM manifest_cache WHERE k = 1")
    .first<ManifestRow>();
}

/**
 * Refresh from GitHub. The tree fetch takes ~1s, during which a write may
 * patch the cache — so the write-back is CAS-guarded by `version`: if a patch
 * landed meanwhile, this refresh is discarded (next TTL expiry catches up).
 */
export async function refreshManifest(
  env: Env,
  expectedVersion: number | null
): Promise<ManifestFile[]> {
  const tree = await getTree(env);
  const files = sortManifest(
    tree.files
      .filter((e) => e.path.startsWith("decks/") || e.path.startsWith("media/"))
      .map((e) => ({ path: e.path, sha: e.sha }))
  );
  const json = JSON.stringify(files);
  if (expectedVersion === null) {
    await env.DB.prepare(
      `INSERT INTO manifest_cache (k, json, fetched_at, version) VALUES (1, ?, ?, 1)
       ON CONFLICT(k) DO NOTHING`
    )
      .bind(json, Date.now())
      .run();
    return files;
  }
  const current = await env.DB.prepare(
    "SELECT json FROM manifest_cache WHERE k = 1 AND version = ?"
  )
    .bind(expectedVersion)
    .first<{ json: string }>();
  if (!current) return files; // a patch landed meanwhile — drop this refresh (CAS)
  if (current.json === json) {
    // Content identical: refresh the TTL but DON'T bump version, so sync
    // cursors stay valid and idle clients keep getting tiny responses.
    await env.DB.prepare("UPDATE manifest_cache SET fetched_at = ? WHERE k = 1 AND version = ?")
      .bind(Date.now(), expectedVersion)
      .run();
  } else {
    const cached = (JSON.parse(current.json) as ManifestFile[]).length;
    if (files.length === 0 && cached > 0 && !tree.repoEmpty) {
      throw new Error(
        `refusing to replace ${cached} cached files with an empty manifest (no decks/ or media/ in ${env.GITHUB_REPO})`
      );
    }
    await env.DB.prepare(
      `UPDATE manifest_cache SET json = ?, fetched_at = ?, version = version + 1
       WHERE k = 1 AND version = ?`
    )
      .bind(json, Date.now(), expectedVersion)
      .run();
  }
  await clearRefreshError(env.DB);
  return files;
}

/**
 * Serve a cached row, kicking off a background revalidation when stale. A
 * real change bumps version, so the next sync cursor differs.
 */
export function serveCached(
  env: Env,
  row: ManifestRow,
  waitUntil: (p: Promise<unknown>) => void
): ManifestFile[] {
  if (Date.now() - row.fetched_at > MANIFEST_TTL_MS) {
    waitUntil(refreshManifest(env, row.version).catch((e) => recordRefreshError(env.DB, e)));
  }
  return JSON.parse(row.json) as ManifestFile[];
}

export async function getManifest(
  env: Env,
  waitUntil: (p: Promise<unknown>) => void
): Promise<ManifestFile[]> {
  const row = await readManifestRow(env.DB);
  return row ? serveCached(env, row, waitUntil) : refreshManifest(env, null);
}

/**
 * Keep the cache exact for writes made through this worker. Compare-and-swap
 * on `version` so two concurrent writes can't drop each other's entry.
 */
export async function patchManifest(env: Env, path: string, sha: string | null): Promise<void> {
  for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt++) {
    const row = await env.DB.prepare("SELECT json, version FROM manifest_cache WHERE k = 1").first<{
      json: string;
      version: number;
    }>();
    if (!row) return; // no cache yet — the first read builds it from GitHub
    const files = patchFiles(JSON.parse(row.json) as ManifestFile[], path, sha);
    const res = await env.DB.prepare(
      "UPDATE manifest_cache SET json = ?, version = version + 1 WHERE k = 1 AND version = ?"
    )
      .bind(JSON.stringify(files), row.version)
      .run();
    if (res.meta.changes) return;
  }
  // Kept losing the race. The file is safely in GitHub; mark the cache stale
  // so the next request rebuilds it from there instead of failing this write.
  console.error(`manifest patch for ${path} lost ${PATCH_ATTEMPTS} CAS races; forcing refresh`);
  await env.DB.prepare(
    "UPDATE manifest_cache SET fetched_at = 0, version = version + 1 WHERE k = 1"
  ).run();
}

async function recordRefreshError(db: D1Database, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error("manifest refresh failed:", message);
  await db
    .prepare("UPDATE manifest_cache SET last_error = ? WHERE k = 1")
    .bind(`${new Date().toISOString()} ${message.slice(0, 500)}`)
    .run()
    .catch(() => {}); // migration 0006 not applied yet — the log line still stands
}

async function clearRefreshError(db: D1Database): Promise<void> {
  await db
    .prepare("UPDATE manifest_cache SET last_error = NULL WHERE k = 1 AND last_error IS NOT NULL")
    .run()
    .catch(() => {});
}
