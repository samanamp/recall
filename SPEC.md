# Spec — Markdown Flashcards `recall`

A spaced-repetition flashcard webapp that fixes Anki's pain points: real dark mode,
first-class code snippets, and plain-markdown cards that never mangle pasted text.
Works on phone and computer. **Ongoing cost: $0.**

## 1. Goals

- Author and review flashcards from a browser on any device (responsive PWA).
- Every card is plain Markdown: text + styling, fenced code blocks with syntax
  highlighting, `$LaTeX$` math, images.
- Dark mode by default (light toggle, follows system preference).
- Modern FSRS scheduling (the algorithm current Anki uses).
- Cards live as `.md` files in the user's own GitHub repo — versioned, portable,
  editable outside the app.
- Review data (high-frequency, machine-generated) lives in Cloudflare D1.
- Zero ongoing cost: GitHub free private repo + Cloudflare free tier only.

### Non-goals (v1)

- Multi-user / accounts — this is a personal instance, one user.
- Cloze deletion, reversed cards, type-in answers (data model leaves room; see §8).
- `.apkg` Anki import (later).
- Stats dashboards, heatmaps, daily new/review limits.
- Nested decks.

## 2. Architecture

```
┌─────────────┐        ┌─────────────┐
│ Phone (PWA) │        │  Computer   │
│ IndexedDB   │        │ IndexedDB   │   ← offline cache + write queue
└──────┬──────┘        └──────┬──────┘
       └──────────┬───────────┘
                  ▼  Bearer <APP_TOKEN> (one secret per device)
   ┌─────────────────────────────────┐
   │   Cloudflare Worker (free)      │
   │  • reviews + FSRS state → D1    │
   │  • cards/media → proxies GitHub │──────► GitHub private repo (free)
   │    Contents API (PAT = secret)  │         decks/<deck>/<card>.md
   └─────────────────────────────────┘         media/<id>.<ext>
```

**Division of data:**

| Data | Lives in | Why |
|---|---|---|
| Card content (markdown) | GitHub repo | Human-authored, low write rate, wants history/portability |
| Pasted images | GitHub repo (`media/`) | Belongs with the content it illustrates |
| Review log + FSRS state | Cloudflare D1 | Append-heavy machine state; commit noise in git |
| Working copy + offline queue | IndexedDB (per device) | Instant UX, full offline operation |

**Trust model:** no user accounts. The Worker checks a single static bearer token
(`APP_TOKEN`, a Worker secret) entered once per device. The GitHub fine-grained PAT
(scoped to the one repo, contents read/write only) is a Worker secret and never
reaches devices.

## 3. Card format

One markdown file per card. Folder = deck. Filename: `<ulid>-<slug>.md` (slug is
cosmetic; the frontmatter `id` is authoritative, so files can be renamed or moved
between deck folders and review history follows).

```markdown
---
id: 01JXK4M9V7T2C8RbExample
created: 2026-06-10
---
What does `Box<T>` do in Rust?
---
Heap-allocates `T`:

​```rust
let b = Box::new(5);
​```
```

- Frontmatter: `id` (ULID, required), `created` (date, informational).
- The first `---` line after the frontmatter splits **front** from **back**.
  (Use `***` for horizontal rules inside card bodies.)
- Images referenced relatively: `![](../../media/<id>.png)` — renders both in the
  app and natively on GitHub.
- Cards may also be created/edited directly in the repo (VS Code, Obsidian, web).
  The app generates frontmatter for files missing it on next sync.

## 4. Rendering pipeline

`react-markdown` + `remark-gfm` (tables, strikethrough) + `remark-math`/`rehype-katex`
(math) + `rehype-highlight` (code). Raw HTML in markdown is **not** rendered
(XSS-safe default; revisit only if a real need appears). Media URLs `media://<id>`
resolve to IndexedDB blobs.

## 5. Backend (Cloudflare Worker)

Single Worker, Hono router, D1 database. All endpoints require
`Authorization: Bearer <APP_TOKEN>`.

### Card/media endpoints (proxy GitHub Contents API)

| Endpoint | Purpose |
|---|---|
| `GET  /cards/manifest` | Repo tree (paths + blob SHAs) — cheap change detection |
| `GET  /cards/file?path=` | Fetch one file's content |
| `PUT  /cards/file` | Create/update file (path, content, base SHA) → commit |
| `DELETE /cards/file` | Delete file → commit |
| `PUT  /media` | Upload image blob → commit to `media/` |

Commit messages are generated (`add card: <slug>`, `edit card: <slug>`).
Conflicts (stale base SHA) return `409`; client refetches and retries —
acceptable for a single user.

### Review endpoints (D1)

| Endpoint | Purpose |
|---|---|
| `POST /reviews` | Append batch of reviews `[{cardId, rating, reviewedAt, deviceId}]` (idempotent by review ULID) |
| `GET  /reviews?since=` | Pull reviews newer than cursor (cross-device merge) |
| `GET  /state` | Current FSRS state per card (server-derived) |

### D1 schema

```sql
CREATE TABLE reviews (
  id          TEXT PRIMARY KEY,   -- ULID, generated on device
  card_id     TEXT NOT NULL,
  rating      INTEGER NOT NULL,   -- 1 Again · 2 Hard · 3 Good · 4 Easy
  reviewed_at INTEGER NOT NULL,   -- epoch ms
  device_id   TEXT NOT NULL
);
CREATE INDEX idx_reviews_card ON reviews(card_id, reviewed_at);

CREATE TABLE card_state (        -- derived cache, rebuildable from reviews
  card_id    TEXT PRIMARY KEY,
  due        INTEGER NOT NULL,
  stability  REAL, difficulty REAL,
  state      INTEGER,            -- 0 new · 1 learning · 2 review · 3 relearning
  reps       INTEGER, lapses    INTEGER,
  updated_at INTEGER NOT NULL
);
```

The review **log is the source of truth**; `card_state` is a cache updated on each
posted review (replayed via `ts-fsrs` if reviews arrive out of order, e.g. two
devices reviewed offline).

## 6. Sync protocol (client)

- **Cards — pull:** on app open / focus / pull-to-refresh: `GET /cards/manifest`,
  diff blob SHAs against IndexedDB, fetch changed files, parse, update local store.
- **Cards — push:** edits save to IndexedDB immediately and enqueue a `PUT`.
  Queue drains when online; `409` → refetch file, reapply (single user: last-write-wins).
- **Reviews — push:** each rating applies FSRS locally (instant next-due) and
  enqueues; batches POST when online. ULID ids make retries idempotent.
- **Reviews — pull:** `GET /reviews?since=<cursor>` on open/focus; replay merged
  log locally so FSRS state converges on every device.
- **Offline:** everything works offline; queues drain on reconnect.

## 7. Frontend

**Stack:** Vite · React · TypeScript · Tailwind (v4) · Dexie (IndexedDB) ·
`ts-fsrs` · `react-markdown` (+ plugins above) · `vite-plugin-pwa`.

**Screens:**

1. **Decks (home)** — deck list with due/new counts; "Study" per deck.
2. **Review** — front rendered; reveal → back; Again/Hard/Good/Easy buttons with
   predicted intervals. Mobile: large tap targets. Desktop: `Space` reveal, `1–4` rate.
3. **Editor** — markdown textarea + live preview (side-by-side on desktop, tabbed
   on mobile). Paste image → uploads to `media/`, inserts reference. Deck picker.
4. **Browser** — searchable card list (full-text over markdown), edit/delete.
5. **Settings** — Worker URL + app token, dark/light/system, manual sync button,
   export/import full JSON backup.

**PWA:** installable (manifest + service worker, autoUpdate), offline-capable,
hosted on Cloudflare Pages.

**Theme:** dark default; CSS variables + Tailwind `dark:`; respects
`prefers-color-scheme`; manual override persisted.

## 8. Future room (explicitly designed-for, not built)

- **Cloze / reversed cards:** frontmatter `type:` field; one file can emit several
  scheduled "siblings" — `card_state` keys become `cardId#variant`.
- **Anki import:** `.apkg` → markdown files, offline script.
- **Stats:** the append-only review log already contains everything needed.
- **Tags:** frontmatter `tags:` list + browser filter.

## 9. Deployment & cost

| Piece | Service | Cost |
|---|---|---|
| Frontend | Cloudflare Pages | $0 |
| API + sync | Cloudflare Worker + D1 (free tier: 100k req/day, 5 GB) | $0 |
| Card storage | GitHub private repo (Contents API, 5k req/h) | $0 |

One-time setup: free Cloudflare account; GitHub fine-grained PAT (one repo,
contents r/w) stored via `wrangler secret put GITHUB_TOKEN`; choose `APP_TOKEN`
secret; `wrangler deploy`. No credit card required anywhere.

## 10. Repo layout (this project)

```
anki/
  SPEC.md
  app/        # Vite React frontend (PWA)
  worker/     # Cloudflare Worker (Hono + D1) + wrangler.toml + migrations
  cards-repo/ # (separate GitHub repo, user's) — decks/** and media/**
```
