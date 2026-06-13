# Contributing to recall

Thanks for considering it! recall is intentionally small — a personal tool
that happens to be deployable — so the bar for new code is "keeps the whole
thing understandable by one person in one sitting."

## Dev setup

```bash
cd worker && cp wrangler.example.toml wrangler.toml   # placeholders are fine for local dev
cd worker && npm install && npx wrangler dev           # API + local D1 on :8787
cd app && npm install && npm run dev                   # app on :5173, /api proxied to :8787
```

Tests and typechecks (CI runs all of these on every push/PR):

```bash
cd app && npx tsc -b --noEmit && npx vitest run
cd worker && npx tsc --noEmit && npx vitest run
```

## What makes a good PR here

- **Bug fixes with a test** — always welcome.
- **Features**: open an issue first. The roadmap favors cloze/reversed cards,
  import/export fidelity, and stats — and disfavors anything that adds a
  server dependency, a paid service, or an account system. The $0/month
  constraint and the "cards are plain markdown in your repo" contract are
  load-bearing; PRs that bend either will be declined kindly.
- **Sync-touching changes**: read the invariants in [CLAUDE.md](CLAUDE.md)
  first (review log is the source of truth; manifest cache must be patched on
  every write; card identity is the frontmatter id). These are the things
  that corrupt data when broken, and tests don't catch all of them.

## Conventions

- Commits: imperative subject + a short body explaining *why*.
- UI: Tailwind only, zinc palette + accent tokens, dark mode default.
- All user-facing mutations live in `app/src/lib/actions.ts` and handle their
  own `requestSync()` — screens never call sync directly.
- No new runtime dependencies without a conversation; bundle size is a
  feature (initial JS is ~120 kB gzip and first sync depends on it).

## Verifying sync changes

There are no integration tests against real GitHub/D1. Test manually with two
browser profiles against your own deployment, or `curl` the worker with
`Authorization: Bearer <APP_TOKEN>`. The PWA service worker serves stale
assets for one load after a deploy — always check the *second* load.
