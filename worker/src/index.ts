import { Hono } from "hono";
import { cors } from "hono/cors";
import { fsrs } from "ts-fsrs";
import { replayReviews } from "./replay";
import {
  deleteFile,
  getBlobBase64,
  getFile,
  getRawFile,
  getTree,
  GitHubError,
  putFile,
  type GitHubEnv,
} from "./github";

type Env = GitHubEnv & {
  DB: D1Database;
  APP_TOKEN: string;
};

interface ReviewRow {
  id: string;
  card_id: string;
  rating: number;
  reviewed_at: number;
  device_id: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"] }));

// Single-user auth: one shared bearer token.
app.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${c.env.APP_TOKEN}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.onError((err, c) => {
  if (err instanceof GitHubError) {
    // Pass through meaningful GitHub statuses (404 missing, 409/422 conflicts).
    const status = err.status === 422 ? 409 : err.status;
    return c.json({ error: err.message }, status as 404 | 409 | 500);
  }
  console.error(err);
  // Surface the message — "internal error" hides actionable causes like
  // "Too many subrequests" and costs a tail-debugging session to find.
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: `internal: ${message.slice(0, 200)}` }, 500);
});

// ----------------------------------------------------- FSRS parameters

interface FsrsParams {
  retention: number;
  weights: number[] | null;
}

async function getParams(db: D1Database): Promise<FsrsParams> {
  const row = await db
    .prepare("SELECT retention, weights FROM params WHERE k = 1")
    .first<{ retention: number; weights: string | null }>();
  return {
    retention: row?.retention ?? 0.9,
    weights: row?.weights ? (JSON.parse(row.weights) as number[]) : null,
  };
}

function makeScheduler(p: FsrsParams): ReturnType<typeof fsrs> {
  try {
    return fsrs({ request_retention: p.retention, ...(p.weights ? { w: p.weights } : {}) });
  } catch {
    return fsrs({ request_retention: p.retention }); // bad weights — fall back
  }
}

// ----------------------------------------------------- manifest cache
//
// GitHub's tree API costs 600-1200ms — far too slow to sit on the sync hot
// path. The cache is served from D1 (~30ms), patched synchronously whenever
// this worker writes a file, and revalidated against GitHub in the background
// when older than the TTL (covers edits made directly on GitHub).

const MANIFEST_TTL_MS = 60_000;

interface ManifestFile {
  path: string;
  sha: string;
}

/**
 * Refresh from GitHub. The tree fetch takes ~1s, during which a write may
 * patch the cache — so the write-back is CAS-guarded by `version`: if a patch
 * landed meanwhile, this refresh is discarded (next TTL expiry catches up).
 */
async function refreshManifest(env: Env, expectedVersion: number | null): Promise<ManifestFile[]> {
  const tree = await getTree(env);
  const files = tree
    .filter((e) => e.path.startsWith("decks/") || e.path.startsWith("media/"))
    .map((e) => ({ path: e.path, sha: e.sha }));
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
    await env.DB.prepare(
      `UPDATE manifest_cache SET json = ?, fetched_at = ?, version = version + 1
       WHERE k = 1 AND version = ?`
    )
      .bind(json, Date.now(), expectedVersion)
      .run();
  }
  return files;
}

async function getManifest(
  env: Env,
  waitUntil: (p: Promise<unknown>) => void
): Promise<ManifestFile[]> {
  const row = await env.DB.prepare(
    "SELECT json, fetched_at, version FROM manifest_cache WHERE k = 1"
  ).first<{ json: string; fetched_at: number; version: number }>();
  if (!row) return refreshManifest(env, null);
  if (Date.now() - row.fetched_at > MANIFEST_TTL_MS) {
    waitUntil(refreshManifest(env, row.version).catch(() => {}));
  }
  return JSON.parse(row.json) as ManifestFile[];
}

/** Keep the cache exact for writes made through this worker. */
async function patchManifest(env: Env, path: string, sha: string | null): Promise<void> {
  const row = await env.DB.prepare("SELECT json FROM manifest_cache WHERE k = 1").first<{
    json: string;
  }>();
  if (!row) return;
  const files = (JSON.parse(row.json) as ManifestFile[]).filter((f) => f.path !== path);
  if (sha) files.push({ path, sha });
  await env.DB.prepare("UPDATE manifest_cache SET json = ?, version = version + 1 WHERE k = 1")
    .bind(JSON.stringify(files))
    .run();
}

// ---------------------------------------------------------------- cards

app.get("/cards/manifest", async (c) => {
  const files = await getManifest(c.env, (p) => c.executionCtx.waitUntil(p));
  return c.json({ files });
});

app.get("/cards/file", async (c) => {
  const path = c.req.query("path");
  if (!path || !isSafePath(path)) return c.json({ error: "bad path" }, 400);
  return c.json(await getFile(c.env, path));
});

// Bundle endpoint: fetch many blobs in one round trip. The worker hits GitHub
// in parallel; Cloudflare brotli-compresses the JSON response automatically.
app.post("/cards/batch", async (c) => {
  const { items } = await c.req.json<{ items: { path: string; sha: string }[] }>();
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: "bad request" }, 400);
  }
  // Each item is one GitHub subrequest; free tier allows 50 per invocation.
  if (items.length > 45) {
    return c.json({ error: `too many items (${items.length}); max 45 per batch` }, 400);
  }
  const files = await Promise.all(
    items.map(async (it) => ({
      path: it.path,
      sha: it.sha,
      contentBase64: await getBlobBase64(c.env, it.sha),
    }))
  );
  return c.json({ files });
});

// Raw media bytes — avoids base64's +33% and lets images stream.
app.get("/media/file", async (c) => {
  const path = c.req.query("path");
  if (!path?.startsWith("media/") || !isSafePath(path)) {
    return c.json({ error: "bad path" }, 400);
  }
  const upstream = await getRawFile(c.env, path);
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

app.put("/cards/file", async (c) => {
  const { path, content, sha, message } = await c.req.json<{
    path: string;
    content: string; // utf-8 markdown
    sha?: string; // required when updating an existing file
    message?: string;
  }>();
  if (!path || !isSafePath(path) || typeof content !== "string") {
    return c.json({ error: "bad request" }, 400);
  }
  const result = await putFile(
    c.env,
    path,
    btoa(String.fromCharCode(...new TextEncoder().encode(content))),
    message ?? `${sha ? "edit" : "add"} ${path}`,
    sha
  );
  await patchManifest(c.env, path, result.sha);
  return c.json(result);
});

app.delete("/cards/file", async (c) => {
  const { path, sha, message } = await c.req.json<{
    path: string;
    sha?: string;
    message?: string;
  }>();
  if (!path || !isSafePath(path)) return c.json({ error: "bad request" }, 400);

  // Resolve the sha server-side when missing or stale; "already gone" = success.
  const resolveSha = async (): Promise<string | null> => {
    try {
      return (await getFile(c.env, path)).sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  };

  let target = sha || (await resolveSha());
  if (target !== null) {
    try {
      await deleteFile(c.env, path, target, message ?? `delete ${path}`);
    } catch (e) {
      const conflict = e instanceof GitHubError && (e.status === 409 || e.status === 422);
      if (!conflict) throw e;
      target = await resolveSha(); // stale sha — retry once with the current one
      if (target !== null) await deleteFile(c.env, path, target, message ?? `delete ${path}`);
    }
  }
  await patchManifest(c.env, path, null);
  return c.json({ ok: true });
});

app.put("/media", async (c) => {
  const { path, base64 } = await c.req.json<{ path: string; base64: string }>();
  if (!path?.startsWith("media/") || !isSafePath(path) || !base64) {
    return c.json({ error: "bad request" }, 400);
  }
  const result = await putFile(c.env, path, base64, `add ${path}`);
  await patchManifest(c.env, path, result.sha);
  return c.json(result);
});

// One-round-trip sync: push reviews + pull manifest & FSRS state together.
// Clients echo back the `cursor` we return; when it still matches (the
// overwhelmingly common heartbeat case) the response is ~60 bytes instead
// of the full manifest + state payload.
app.post("/sync", async (c) => {
  const { reviews, cursor } = await c.req.json<{
    reviews?: { id: string; cardId: string; rating: number; reviewedAt: number; deviceId: string }[];
    cursor?: string;
  }>();

  const params = await getParams(c.env.DB);
  const pushed = Array.isArray(reviews) && reviews.length > 0 && reviews.length <= 500;

  if (pushed) {
    const insert = c.env.DB.prepare(
      "INSERT OR IGNORE INTO reviews (id, card_id, rating, reviewed_at, device_id) VALUES (?, ?, ?, ?, ?)"
    );
    await c.env.DB.batch(
      reviews.map((r) => insert.bind(r.id, r.cardId, r.rating, r.reviewedAt, r.deviceId))
    );
    const scheduler = makeScheduler(params);
    for (const cardId of new Set(reviews.map((r) => r.cardId))) {
      await replayCard(c.env.DB, cardId, scheduler);
    }
  }

  const [manifest, paramsRow, reviewStat] = await Promise.all([
    c.env.DB.prepare("SELECT json, fetched_at, version FROM manifest_cache WHERE k = 1")
      .first<{ json: string; fetched_at: number; version: number }>(),
    c.env.DB.prepare("SELECT updated_at FROM params WHERE k = 1").first<{ updated_at: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n, COALESCE(MAX(rowid), 0) AS mx FROM reviews"
    ).first<{ n: number; mx: number }>(),
  ]);

  // Keep hand-edits-on-GitHub flowing for idle clients: revalidate in the
  // background when stale. A real change bumps version → next cursor differs.
  let files: ManifestFile[];
  if (!manifest) {
    files = await refreshManifest(c.env, null);
  } else {
    if (Date.now() - manifest.fetched_at > MANIFEST_TTL_MS) {
      c.executionCtx.waitUntil(refreshManifest(c.env, manifest.version).catch(() => {}));
    }
    files = JSON.parse(manifest.json) as ManifestFile[];
  }

  const current = [
    manifest?.version ?? 1,
    paramsRow?.updated_at ?? 0,
    reviewStat?.mx ?? 0,
    reviewStat?.n ?? 0,
  ].join(":");

  if (!pushed && cursor && cursor === current) {
    return c.json({
      unchanged: true,
      cursor: current,
      reviewCount: reviewStat?.n ?? 0,
      accepted: 0,
    });
  }

  const state = (await c.env.DB.prepare("SELECT * FROM card_state").all()).results;
  return c.json({
    files,
    state,
    params,
    cursor: current,
    reviewCount: reviewStat?.n ?? 0,
    accepted: pushed ? reviews.length : 0,
  });
});

function isSafePath(path: string): boolean {
  return (
    !path.includes("..") &&
    !path.startsWith("/") &&
    (path.startsWith("decks/") || path.startsWith("media/"))
  );
}

// -------------------------------------------------------------- reviews

app.post("/reviews", async (c) => {
  const reviews = await c.req.json<
    { id: string; cardId: string; rating: number; reviewedAt: number; deviceId: string }[]
  >();
  if (!Array.isArray(reviews) || reviews.length === 0 || reviews.length > 500) {
    return c.json({ error: "bad request" }, 400);
  }

  const insert = c.env.DB.prepare(
    "INSERT OR IGNORE INTO reviews (id, card_id, rating, reviewed_at, device_id) VALUES (?, ?, ?, ?, ?)"
  );
  await c.env.DB.batch(
    reviews.map((r) => insert.bind(r.id, r.cardId, r.rating, r.reviewedAt, r.deviceId))
  );

  // Recompute derived FSRS state for every touched card by replaying its full
  // log. Handles out-of-order arrival from devices that reviewed offline.
  const scheduler = makeScheduler(await getParams(c.env.DB));
  const cardIds = [...new Set(reviews.map((r) => r.cardId))];
  for (const cardId of cardIds) {
    await replayCard(c.env.DB, cardId, scheduler);
  }
  return c.json({ ok: true, accepted: reviews.length });
});

// Full review log — input for the client-side FSRS optimizer.
app.get("/reviews/export", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT card_id, rating, reviewed_at FROM reviews ORDER BY card_id, reviewed_at"
  ).all<{ card_id: string; rating: number; reviewed_at: number }>();
  return c.json({ reviews: results });
});

// Update scheduling parameters, then reschedule every card under them.
app.put("/params", async (c) => {
  const body = await c.req.json<{ retention?: number; weights?: number[] | null }>();
  const current = await getParams(c.env.DB);
  const next: FsrsParams = {
    retention:
      typeof body.retention === "number" && body.retention >= 0.7 && body.retention <= 0.99
        ? body.retention
        : current.retention,
    weights:
      body.weights === undefined
        ? current.weights
        : Array.isArray(body.weights) && body.weights.every((n) => Number.isFinite(n))
          ? body.weights
          : null,
  };
  await c.env.DB.prepare(
    `INSERT INTO params (k, retention, weights, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET retention = excluded.retention,
       weights = excluded.weights, updated_at = excluded.updated_at`
  )
    .bind(next.retention, next.weights ? JSON.stringify(next.weights) : null, Date.now())
    .run();

  const scheduler = makeScheduler(next);
  const { results } = await c.env.DB.prepare("SELECT DISTINCT card_id FROM reviews").all<{
    card_id: string;
  }>();
  for (const row of results) {
    await replayCard(c.env.DB, row.card_id, scheduler);
  }
  return c.json({ ok: true, rescheduled: results.length });
});

app.get("/reviews", async (c) => {
  const since = Number(c.req.query("since") ?? 0);
  const { results } = await c.env.DB.prepare(
    "SELECT id, card_id, rating, reviewed_at, device_id FROM reviews WHERE reviewed_at > ? ORDER BY reviewed_at LIMIT 1000"
  )
    .bind(since)
    .all<ReviewRow>();
  return c.json({ reviews: results });
});

app.get("/state", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM card_state").all();
  return c.json({ state: results });
});

async function replayCard(
  db: D1Database,
  cardId: string,
  scheduler: ReturnType<typeof fsrs>
): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT rating, reviewed_at FROM reviews WHERE card_id = ? ORDER BY reviewed_at, id"
    )
    .bind(cardId)
    .all<{ rating: number; reviewed_at: number }>();
  const card = replayReviews(results, scheduler);
  if (!card) return;

  await db
    .prepare(
      `INSERT INTO card_state (card_id, due, stability, difficulty, state, reps, lapses, fsrs_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET
         due = excluded.due, stability = excluded.stability,
         difficulty = excluded.difficulty, state = excluded.state,
         reps = excluded.reps, lapses = excluded.lapses,
         fsrs_json = excluded.fsrs_json, updated_at = excluded.updated_at`
    )
    .bind(
      cardId,
      card.due.getTime(),
      card.stability,
      card.difficulty,
      card.state,
      card.reps,
      card.lapses,
      JSON.stringify(card),
      Date.now()
    )
    .run();
}

export default app;
