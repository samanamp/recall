import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { bearerAuth } from "./auth";
import { deckFolders, makeCard, resolveDeck } from "./cardfile";
import { utf8ToBase64 } from "./encoding";
import type { Env } from "./env";
import { buildMessages, DEFAULT_MODEL, parseFlashcards } from "./flashcard";
import {
  deleteFile,
  getBlobBase64,
  getFile,
  getRawFile,
  GitHubError,
  putFile,
} from "./github";
import {
  getManifest,
  patchManifest,
  readManifestRow,
  refreshManifest,
  serveCached,
} from "./manifest";
import { allowedOrigin } from "./origins";
import {
  getParams,
  makeScheduler,
  mergeParams,
  parseRescheduleCursor,
  rescheduleStep,
} from "./params";
import { checkReviewBatch, deleteReview, ingestReviews, replayCards } from "./reviews";
import { isBlobSha, isSafePath, parseParamsUpdate } from "./validate";

interface ReviewRow {
  id: string;
  card_id: string;
  rating: number;
  reviewed_at: number;
  device_id: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: (origin, c) =>
      allowedOrigin(origin, new URL(c.req.url).origin, (c.env as Env).ALLOWED_ORIGINS),
    allowHeaders: ["Authorization", "Content-Type"],
  })
);

app.use("*", bearerAuth());

app.onError((err, c) => {
  if (err instanceof GitHubError) return githubErrorResponse(c, err);
  console.error(err);
  // Surface the message — "internal error" hides actionable causes like
  // "Too many subrequests" and costs a tail-debugging session to find.
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: `internal: ${message.slice(0, 200)}` }, 500);
});

/**
 * 401 is reserved for our own bearer check: the app reads it as "your app
 * token is wrong". A rejected GitHub PAT is a server-side problem (502), a
 * GitHub rate limit is temporary (503 + Retry-After). Meaningful statuses
 * (404 missing, 409/422 conflicts) still pass through.
 */
function githubErrorResponse(c: Context, err: GitHubError): Response {
  if (err.retryAfter !== null) {
    c.header("Retry-After", String(err.retryAfter));
    return c.json({ error: "github: rate limited, retry later" }, 503);
  }
  if (err.isAuth) return c.json({ error: "github: token rejected or lacks access" }, 502);
  if (err.status === 404) return c.json({ error: err.message }, 404);
  if (err.status === 409 || err.status === 422) return c.json({ error: err.message }, 409);
  return c.json({ error: err.message }, 502);
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
  if (items.some((it) => !isSafePath(it?.path) || !isBlobSha(it?.sha))) return c.json({ error: "bad item: need a decks/ or media/ path and a git sha" }, 400);
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
    utf8ToBase64(content),
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

// Create a card from {deck, front, back}. The one place clients make cards:
// generates id/slug/path + serializes server-side, so the browser extension
// (and anything else) stays dumb. Writes through the same putFile+patch path.
app.post("/cards", async (c) => {
  const { deck, front, back } = await c.req.json<{
    deck?: string;
    front?: string;
    back?: string;
  }>();
  const manifest = await getManifest(c.env, (p) => c.executionCtx.waitUntil(p));
  const cleanDeck = resolveDeck(deck ?? "", deckFolders(manifest.map((f) => f.path)));
  if (!cleanDeck || typeof front !== "string" || !front.trim()) {
    return c.json({ error: "deck and front are required" }, 400);
  }
  const card = makeCard(cleanDeck, front.trim(), (back ?? "").trim());
  if (!isSafePath(card.path)) return c.json({ error: "bad deck name" }, 400);
  const result = await putFile(c.env, card.path, utf8ToBase64(card.content), `add ${card.path}`);
  await patchManifest(c.env, card.path, result.sha);
  return c.json({ id: card.id, deck: cleanDeck, path: card.path, sha: result.sha });
});

// Generate (not save) 1–4 atomic flashcards from highlighted text via Workers
// AI. Returns {cards:[{front,back}]} for the client to review/edit/trim before
// POST /cards. A rich passage yields several cards; a thin one, just one.
app.post("/flashcard", async (c) => {
  const { text, title, url, avoid } = await c.req.json<{
    text?: string;
    title?: string;
    url?: string;
    avoid?: string;
  }>();
  if (typeof text !== "string" || text.trim().length < 3) {
    return c.json({ error: "need at least a few words of text" }, 400);
  }
  const model = c.env.AI_MODEL || DEFAULT_MODEL;
  const out = await c.env.AI.run(model, {
    messages: buildMessages(text, { title, url, avoid }),
    temperature: avoid ? 0.7 : 0.3, // looser on regenerate, for variety
    max_tokens: 1200, // room for a few cards with fuller answers
  });
  const raw = typeof out === "string" ? out : out.response ?? "";
  try {
    return c.json({ cards: parseFlashcards(raw) }); // handles array/object/string
  } catch (e) {
    return c.json({ error: `couldn't generate cards: ${(e as Error).message}` }, 502);
  }
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
// Overlap for delta state queries: Worker instances' clocks can disagree by a little.
const STATE_SKEW_MS = 10_000;

app.post("/sync", async (c) => {
  const { reviews, cursor, delta, stateSince } = await c.req.json<{
    reviews?: unknown;
    cursor?: string;
    delta?: boolean; // client understands filesUnchanged / stateIsDelta
    stateSince?: number; // highest card_state.updated_at the client has applied
  }>();
  const batch = checkReviewBatch(reviews ?? []);
  if (typeof batch === "string") return c.json({ error: batch }, 400);

  const params = await getParams(c.env.DB);
  const pushed = batch.valid.length > 0;

  if (pushed) {
    const { touched } = await ingestReviews(c.env.DB, batch.valid);
    await replayCards(c.env.DB, touched, makeScheduler(params));
  }

  const [manifest, paramsRow, reviewStat] = await Promise.all([
    readManifestRow(c.env.DB),
    c.env.DB.prepare("SELECT updated_at FROM params WHERE k = 1").first<{ updated_at: number }>(),
    // O(1) row instead of COUNT(*) — a heartbeat must not scan the log.
    c.env.DB.prepare("SELECT seq, review_count FROM sync_stats WHERE k = 1")
      .first<{ seq: number; review_count: number }>(),
  ]);

  // Keep hand-edits-on-GitHub flowing for idle clients: revalidate in the
  // background when stale. A real change bumps version → next cursor differs.
  const files = manifest
    ? serveCached(c.env, manifest, (p) => c.executionCtx.waitUntil(p))
    : await refreshManifest(c.env, null);

  const current = [
    manifest?.version ?? 1,
    paramsRow?.updated_at ?? 0,
    reviewStat?.seq ?? 0,
  ].join(":");

  if (!pushed && cursor && cursor === current) {
    return c.json({
      unchanged: true,
      cursor: current,
      reviewCount: reviewStat?.review_count ?? 0,
      accepted: 0,
    });
  }

  const reviewCount = reviewStat?.review_count ?? 0;
  if (!delta) {
    // Older clients and the extension: the whole table, as before.
    const state = (await c.env.DB.prepare("SELECT * FROM card_state").all()).results;
    return c.json({ files, state, params, cursor: current, reviewCount, accepted: batch.valid.length });
  }

  // Delta clients get only what changed. Files are omitted when the manifest
  // version in their cursor still matches; state is rows updated after their
  // watermark (minus a small overlap for clock skew between Worker instances;
  // re-applying a row is harmless), plus tombstones for deleted rows.
  const filesUnchanged = cursor !== undefined && cursor.split(":")[0] === String(manifest?.version ?? 1);
  const since = Number.isFinite(stateSince) ? Math.max(0, Number(stateSince) - STATE_SKEW_MS) : undefined;
  const [stateRows, deletedRows] =
    since === undefined
      ? [(await c.env.DB.prepare("SELECT * FROM card_state").all()).results, []]
      : await Promise.all([
          c.env.DB.prepare("SELECT * FROM card_state WHERE updated_at > ?").bind(since).all().then((r) => r.results),
          c.env.DB.prepare("SELECT card_id FROM card_state_tombstones WHERE deleted_at > ?")
            .bind(since)
            .all<{ card_id: string }>()
            .then((r) => r.results.map((t) => t.card_id)),
        ]);
  return c.json({
    ...(filesUnchanged ? { filesUnchanged: true } : { files }),
    state: stateRows,
    ...(since === undefined ? {} : { stateIsDelta: true, deletedState: deletedRows }),
    params,
    cursor: current,
    reviewCount,
    accepted: batch.valid.length,
  });
});

// -------------------------------------------------------------- reviews

app.post("/reviews", async (c) => {
  const reviews = await c.req.json<unknown>();
  const batch = checkReviewBatch(reviews);
  if (typeof batch === "string") return c.json({ error: batch }, 400);
  if (batch.valid.length + batch.rejected === 0) return c.json({ error: "no reviews" }, 400);

  // Recompute derived FSRS state for every touched card by replaying its full
  // log. Handles out-of-order arrival from devices that reviewed offline.
  const { touched } = await ingestReviews(c.env.DB, batch.valid);
  await replayCards(c.env.DB, touched, makeScheduler(await getParams(c.env.DB)));
  return c.json({ ok: true, accepted: batch.valid.length, rejected: batch.rejected });
});

// Undo support: remove one review and re-derive the card's state.
app.delete("/reviews", async (c) => {
  const { id } = await c.req.json<{ id: string }>();
  if (typeof id !== "string" || !id) return c.json({ error: "bad request" }, 400);
  const scheduler = makeScheduler(await getParams(c.env.DB));
  if (!(await deleteReview(c.env.DB, id, scheduler))) {
    return c.json({ ok: true, missing: true }); // never pushed or already undone
  }
  return c.json({ ok: true });
});

// Aggregated stats for the Stats screen. `tz` = client UTC offset in minutes
// (Date.getTimezoneOffset() convention: positive west of UTC) so day
// boundaries match the user's wall clock.
app.get("/stats", async (c) => {
  const tz = clampTzOffset(Number(c.req.query("tz") ?? 0));
  const shift = -tz * 60; // seconds to ADD to epoch for local-day bucketing
  const now = Date.now();
  // Compare raw epoch ms with now; shift only when bucketing into local days.
  // Overdue cards are due today, so they're bucketed there, not dropped.
  const DAY_MS = 86_400_000;
  const localToday = Math.floor((now + shift * 1000) / DAY_MS) * DAY_MS - shift * 1000;
  const horizon = localToday + 14 * DAY_MS;
  const [daily, forecast] = await Promise.all([
    c.env.DB.prepare(
      `SELECT date(reviewed_at/1000 + ?, 'unixepoch') AS day,
              COUNT(*) AS n,
              SUM(rating = 1) AS again
       FROM reviews GROUP BY day ORDER BY day`
    )
      .bind(shift)
      .all<{ day: string; n: number; again: number }>(),
    c.env.DB.prepare(
      `SELECT date(MAX(due, ?)/1000 + ?, 'unixepoch') AS day, COUNT(*) AS n
       FROM card_state WHERE due < ?
       GROUP BY day ORDER BY day`
    )
      .bind(now, shift, horizon)
      .all<{ day: string; n: number }>(),
  ]);
  return c.json({ daily: daily.results, forecast: forecast.results });
});

/** Real offsets span UTC-12..UTC+14; anything else is garbage → UTC. */
function clampTzOffset(tz: number): number {
  return Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? Math.round(tz) : 0;
}

// Full review log — input for the client-side FSRS optimizer.
app.get("/reviews/export", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT card_id, rating, reviewed_at FROM reviews ORDER BY card_id, reviewed_at"
  ).all<{ card_id: string; rating: number; reviewed_at: number }>();
  return c.json({ reviews: results });
});

// Update scheduling parameters and reschedule every card under them, one
// page per call (see rescheduleStep): the client repeats the same body plus
// the returned `cursor` until `done`. Params only change on the last page.
app.put("/params", async (c) => {
  const body = await c.req.json<unknown>();
  const update = parseParamsUpdate(body);
  if (typeof update === "string") return c.json({ error: update }, 400);
  const cursor = parseRescheduleCursor((body as { cursor?: unknown }).cursor);
  if (cursor === "invalid") return c.json({ error: "bad cursor" }, 400);

  const next = mergeParams(await getParams(c.env.DB), update);
  const step = await rescheduleStep(c.env.DB, next, cursor);
  return c.json({ ok: true, ...step });
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

// The API mounts at /api (the worker also serves the PWA via static assets,
// same-origin) and at the root (clients pointing a Worker URL directly at the
// old paths). Static assets are matched before the worker runs except for
// /api/* (run_worker_first), so root API paths only reach us as non-navigation
// fetches — which is what API calls are.
const root = new Hono<{ Bindings: Env }>();
root.route("/api", app);
root.route("/", app);

export default root;
