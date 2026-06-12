# recall — agent/developer knowledge base

Markdown flashcard PWA with FSRS spaced repetition. Personal single-user app,
hard constraint: **$0/month ongoing cost**. Read SPEC.md for the original
design; this file is the living knowledge that isn't obvious from the code.

## Live deployment (owner: samanamp / Cloudflare account info@cnversion.io)

| Piece | Where | Deploy command |
|---|---|---|
| App (PWA) | https://recall-3c5.pages.dev (CF Pages project `recall`) | `cd app && npm run build && npx wrangler pages deploy dist --project-name recall` |
| API | https://recall-api.info-d80.workers.dev (worker `recall-api`) | `cd worker && npx wrangler deploy` |
| DB | Cloudflare D1, name `mdanki` (pre-rename, kept) | `npx wrangler d1 migrations apply mdanki --remote` |
| Cards | github.com/samanamp/recall-decks (private) | written via worker only |
| Code | github.com/samanamp/recall (public) | `git push` |

Worker secrets (via `wrangler secret put`): `APP_TOKEN` (device bearer token),
`GITHUB_TOKEN` (fine-grained PAT, contents r/w on recall-decks only — never
ships to devices). The default worker URL is baked into `app/.env`
(`VITE_WORKER_URL`); the user enters only the token per device.

## Architecture invariants — break these and sync corrupts

1. **The D1 review log is the source of truth for scheduling.** `card_state`
   is a derived cache: the worker replays a card's full log through ts-fsrs
   (`worker/src/replay.ts`) after every insert. Never write `card_state`
   except via replay. This is what makes offline reviews on two devices
   converge.
2. **FSRS params (retention + optimized weights) are server-authoritative**
   (D1 `params` table). Worker replay and device schedulers must use the same
   params or due dates diverge. Devices receive them in the `/sync` response
   and cache in Dexie kv. `PUT /params` re-replays every card.
3. **The repo manifest is cached in D1** (`manifest_cache`) because GitHub's
   tree API costs 600–1200ms. Every worker write (`putFile`/`deleteFile`/
   media) must `patchManifest()` synchronously; background revalidation
   (60s TTL, `waitUntil`) covers edits made directly on GitHub. If a write
   path forgets to patch, devices miss changes for up to 60s (and tests
   won't catch it — check manually). Refresh write-backs are CAS-guarded by
   a `version` column: a slow tree fetch must not clobber patches made while
   it ran (this race actually happened during the Anki bulk import — a card
   silently vanished from the manifest while sitting safely in GitHub).
4. **Card identity is the frontmatter `id` (ULID), not the file path.**
   Files can be renamed/moved between deck folders; review history follows
   the id. Files hand-authored without an id get one queued back on first
   sync (normalization in `app/src/lib/sync.ts` pullFiles).
5. **Pushes are sequential, pulls are batched.** Parallel commits to one git
   branch race (GitHub 409s); the client drains `pendingFiles` one at a time,
   LWW on conflict. Pulls use `POST /cards/batch` (worker fans out to GitHub
   in parallel) and raw-binary `/media/file` fetches, 6 at a time.

## Data flow (steady state = one network call)

`POST /sync` does everything: pending reviews up; manifest + card_state +
params + reviewCount down (~100ms measured). Further calls happen only when
the manifest shows changed files. Client is local-first: IndexedDB (Dexie)
is read/written instantly; queues (`pendingFiles`, `pendingReviews`) drain
on sync. Auto-sync triggers: launch, focus, online, visibilitychange, 60s
heartbeat, plus debounced `requestSync()` from every mutating action in
`app/src/lib/actions.ts` (screens never call sync directly).

## Card file format

```markdown
---
id: 01JXK4M9V7T2C8R0EXAMPLE
created: 2026-06-10
---
front markdown
---
back markdown
```

Path: `decks/<deck>/<ulid>-<slug>.md`. Deck = folder. Empty decks persist as
`decks/<name>/.gitkeep`. Images: `media/<contenthash>.webp`, referenced as
`![](../../media/<file>)` (renders on GitHub too). Images are optimized
client-side at paste time (`app/src/lib/image.ts`): max 1000px (= 500px
mobile @2x DPR), WebP q0.8, content-hash dedupe. GIF/SVG pass through.
`tools/optimize-repo-images.mjs` re-encodes legacy repo images (needs sharp,
`RECALL_TOKEN` env).

## Gotchas learned the hard way

- App tsconfig has `erasableSyntaxOnly`: no TS parameter properties
  (`constructor(public x ...)` fails the build).
- GitHub contents API base64 + `atob()` corrupts non-latin1; always pass
  base64 to the client and decode with TextDecoder (`b64ToText`).
- `fsrs-browser` (WASM optimizer) must stay behind a dynamic import — it's a
  ~445kB gzip chunk. Same for the markdown renderer (`MarkdownInner.tsx`
  behind `lazy()`): keeps initial JS ~120kB gzip so first sync fires fast.
- Tailwind v4 (CSS-first config): dark mode is class-based via
  `@custom-variant dark` in `index.css`; typography plugin's inline-code
  backticks are stripped there too.
- CI uses `npm install`, NOT `npm ci`: macOS-generated lockfiles drift on
  wasm/platform optional deps (`@rolldown/binding-wasm32-wasi` -> `@emnapi/*`,
  npm/cli#4828) and strict `npm ci` rejects them on linux. Regenerating the
  lockfile only holds until the next mac-side `npm install` — don't bother.
- The PWA service worker (`vite-plugin-pwa`, autoUpdate) serves stale assets
  for one load after a deploy — always test on the *second* load.
- Free-tier D1 is fast (~30-65ms) but GitHub API from the worker is 300ms+:
  keep GitHub off the hot path (see invariant 3).
- Browser image APIs (`createImageBitmap`, `OffscreenCanvas`) don't exist in
  node — only `contentHash`/passthrough paths of image.ts are unit-testable.
- Anki imports: key everything by `cards.id` (cid), NOT `notes.id` — they
  usually match but cids can be nid+1, and a mismatch silently drops that
  card's revlog (cards then look "new"). Always reconcile sent-review counts
  against Anki's per-deck revlog total. Anki v3 scheduler ease is 1-4 for
  every review type (identity mapping; do not remap learn-phase eases).
- fsrs-browser `computeParameters` needs FSRS prefix items (one per
  cross-day review, history up to it), not whole-card items; and it
  *consumes* the Fsrs instance — never call `.free()` after it.

## Testing & CI

- `cd app && npx vitest run` — pure-logic tests (cardfile parse/serialize,
  scheduler behavior, optimizer data prep, image hashing).
- `cd worker && npx vitest run` — replay determinism/convergence tests.
- GitHub Actions (`.github/workflows/ci.yml`) runs build + typecheck + tests
  for both packages on every push/PR.
- No integration tests against real GitHub/D1; verify sync changes manually
  (two browsers, or curl the worker — `Authorization: Bearer <APP_TOKEN>`).

## Conventions

- Commits: imperative subject + short why-body.
- UI: Tailwind only, zinc palette, sky accent, dark default. Surfaces are
  `bg-white dark:bg-zinc-900/70` with `border-zinc-200 dark:border-zinc-800`.
- All user-facing mutations live in `app/src/lib/actions.ts` and are
  responsible for their own `requestSync()`.
- Future roadmap (designed-for, unbuilt): cloze/reversed cards (frontmatter
  `type:` + `cardId#variant` state keys), .apkg import, stats from the
  review log, tags.
