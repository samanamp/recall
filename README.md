# recall

Markdown flashcards with FSRS spaced repetition. Cards live as plain `.md` files
in your own GitHub repo; review history lives in Cloudflare D1. Dark mode, code
highlighting, KaTeX math, image paste. Works on phone and desktop as a PWA.
**$0/month.** See [SPEC.md](SPEC.md) for the design.

```
app/     — React PWA (Vite + TS + Tailwind + Dexie + ts-fsrs)
worker/  — Cloudflare Worker API (Hono + D1 + GitHub proxy)
```

## Setup (one time, ~15 minutes)

### 1. Create your cards repo

Create a **private GitHub repo** (e.g. `recall-decks`). Cards will appear as
`decks/<deck>/<id>-<slug>.md`. You can also hand-write cards there:

```markdown
What does `Box<T>` do in Rust?
---
Heap-allocates `T`.
```

(Frontmatter with a stable `id` is added automatically on first sync.)

### 2. Create a GitHub token

GitHub → Settings → Developer settings → **Fine-grained personal access token**:
- Repository access: **only** your cards repo
- Permissions: **Contents → Read and write**

### 3. Deploy the worker

```bash
cd worker
npm install
npx wrangler login                       # free Cloudflare account
npx wrangler d1 create mdanki            # paste the printed database_id into wrangler.toml
# also set GITHUB_REPO = "samanamp/recall-decks" in wrangler.toml
npx wrangler d1 migrations apply mdanki --remote
npx wrangler secret put GITHUB_TOKEN     # the PAT from step 2
npx wrangler secret put APP_TOKEN        # invent a long random string, e.g. `openssl rand -hex 32`
npx wrangler deploy                      # note the printed workers.dev URL
```

### 4. Deploy the app

```bash
cd app
npm install
npm run build
npx wrangler pages deploy dist --project-name recall
```

(Or connect the repo to Cloudflare Pages for auto-deploys: build command
`npm run build`, output `dist`, root directory `app`.)

### 5. Connect your devices

Open the Pages URL on each device → **Settings** → enter the worker URL and your
`APP_TOKEN` → Save → Sync now. On your phone, use "Add to Home Screen" to
install it as an app.

## Development

```bash
cd app && npm run dev        # frontend at localhost:5173
cd worker && npx wrangler dev  # worker at localhost:8787 (uses local D1)
```

## How sync works

- **Cards/media:** the app keeps a local copy in IndexedDB and pushes edits as
  git commits via the worker (your GitHub token never leaves Cloudflare).
  Pulls diff the repo tree against local blob SHAs.
- **Reviews:** each rating is scheduled locally with `ts-fsrs` immediately and
  queued; the worker stores the append-only log in D1 and derives canonical FSRS
  state by replaying each card's log, which devices adopt on next sync.
- Everything works offline; queues drain on reconnect.
