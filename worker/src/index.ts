import { Hono } from "hono";
import { cors } from "hono/cors";
import { createEmptyCard, fsrs, type Grade } from "ts-fsrs";
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
  return c.json({ error: "internal error" }, 500);
});

// ---------------------------------------------------------------- cards

app.get("/cards/manifest", async (c) => {
  const tree = await getTree(c.env);
  const files = tree.filter(
    (e) => e.path.startsWith("decks/") || e.path.startsWith("media/")
  );
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
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
    return c.json({ error: "bad request" }, 400);
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
  return c.json(result);
});

app.delete("/cards/file", async (c) => {
  const { path, sha, message } = await c.req.json<{
    path: string;
    sha: string;
    message?: string;
  }>();
  if (!path || !isSafePath(path) || !sha) return c.json({ error: "bad request" }, 400);
  await deleteFile(c.env, path, sha, message ?? `delete ${path}`);
  return c.json({ ok: true });
});

app.put("/media", async (c) => {
  const { path, base64 } = await c.req.json<{ path: string; base64: string }>();
  if (!path?.startsWith("media/") || !isSafePath(path) || !base64) {
    return c.json({ error: "bad request" }, 400);
  }
  const result = await putFile(c.env, path, base64, `add ${path}`);
  return c.json(result);
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
  const cardIds = [...new Set(reviews.map((r) => r.cardId))];
  for (const cardId of cardIds) {
    await replayCard(c.env.DB, cardId);
  }
  return c.json({ ok: true, accepted: reviews.length });
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

async function replayCard(db: D1Database, cardId: string): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT rating, reviewed_at FROM reviews WHERE card_id = ? ORDER BY reviewed_at, id"
    )
    .bind(cardId)
    .all<{ rating: number; reviewed_at: number }>();
  if (results.length === 0) return;

  const scheduler = fsrs();
  let card = createEmptyCard(new Date(results[0].reviewed_at));
  for (const r of results) {
    card = scheduler.next(card, new Date(r.reviewed_at), r.rating as Grade).card;
  }

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
