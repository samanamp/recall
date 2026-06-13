# recall

### Spaced-repetition flashcards as plain markdown. Beautiful, runs anywhere (on your phone/desktop, in airplane), and $0/month.

Like Anki — but cards are `.md` files you write in seconds, the scheduler
([FSRS](https://github.com/open-spaced-repetition/ts-fsrs)) means you review
less to remember the same, and you run your own copy on Cloudflare's free tier.
No account. No subscription. Nothing to babysit.

![recall — add a card, review with FSRS, browse, stats, and themes](docs/demo.gif)

<sub>▶ [Watch the full-quality video](docs/demo.mp4)</sub>

## Why you'll keep using it

**Review less, remember more.** FSRS shows you each card right as you're about
to forget it, and retunes itself to *your* memory from your own history. Same
retention, fewer reviews — it gives you your time back.

**Cards you'll actually write.** A card is just `front` / `---` / `back`. Real
markdown: code with highlighting, KaTeX math, paste an image straight in. No
clunky note-type editors to fight.

```markdown
What does `Box<T>` do in Rust?
---
Heap-allocates `T`.
```

**Fast, everywhere, offline.** Opens instantly, works on the subway, syncs the
second you're back. Add it to your phone's home screen and it's an app. Review
on your laptop and phone — the history merges, it never conflicts.

**Never held hostage.** No subscription renting you your own memory, no startup
that can disappear with ten years of your decks. Every card is a text file you
can open, grep, or edit in any editor — today and in thirty years.

## Setup — about 5 minutes, all free

**1. Fork this repo.** → **[Fork](https://github.com/samanamp/recall/fork)**
(Use *Fork*, not "Use this template" — a template can't pull future updates; a
fork can, and that's what powers auto-updates below.)

**2. Create a free Cloudflare account.** → [sign up](https://dash.cloudflare.com/sign-up)
(This is where your copy runs.)

**3. Make a private repo for your cards.** Anything, e.g. `recall-decks`. Your
decks live here as `.md` files — you can even hand-write cards on GitHub.

**4. Create a GitHub token** scoped to *only* that cards repo, **Contents →
Read and write**. → [new fine-grained token](https://github.com/settings/personal-access-tokens/new)

**5. Run the one-command wizard.** It logs into Cloudflare, creates the
database, sets your secrets, builds, and deploys — then prints your personal
app URL.

```bash
git clone https://github.com/<you>/recall
cd recall
node tools/setup.mjs
```

**6. Open your URL on each device.** Paste your app token in **Settings → Sync
now**. On a phone, "Add to Home Screen" installs the app. A welcome deck takes
it from there.

## Auto-updates

**Your copy keeps itself current.** Flip this on once and you never deploy
again — every week it pulls the latest from here and redeploys itself:

1. On your fork → **Actions** tab → enable workflows.
2. **Settings → Secrets and variables → Actions** → add your Cloudflare
   credentials and D1 id (the exact four are listed at the top of
   [deploy.yml](.github/workflows/deploy.yml)). Your worker secrets stay on
   Cloudflare — they're never copied to GitHub.

That's it. A weekly job fast-forwards your fork and redeploys, hands-off.
Want an update *now*? Hit **Sync fork** on your repo, or **Run workflow** on
the Actions page. Customizing? Keep changes on a branch — the auto-sync is
fast-forward-only, so it leaves a diverged `main` alone and just redeploys it.

<sub>GitHub pauses a fork's scheduled jobs after 60 days idle — it emails you, one click resumes. Prefer fully manual? `git pull upstream main && node tools/setup.mjs` re-runs safely.</sub>

## Will I really pay $0?

Yes. Steady-state sync is one ~100ms request, and even a heavy 200-reviews-a-day
habit doesn't come close to Cloudflare's free limits (100k requests and 100k DB
writes per day). One deployment comfortably covers you — and a few family
members. Running a public service off one free account is the only thing it's
not built for.

## Architecture

```
app/     — React PWA (Vite + TS + Tailwind + Dexie + ts-fsrs)
worker/  — Cloudflare Worker: serves the app (static assets) + API at /api
           (Hono + D1 + GitHub proxy)
tools/   — setup wizard, maintenance scripts
```

- **Cards/media:** the app keeps a local copy in IndexedDB and pushes edits as
  git commits via the worker (your GitHub token never leaves Cloudflare).
  Pulls diff the repo tree against local blob SHAs.
- **Reviews:** each rating is scheduled locally with `ts-fsrs` immediately and
  queued; the worker stores the append-only log in D1 and derives canonical
  FSRS state by replaying each card's log, which devices adopt on next sync.
- Everything works offline; queues drain on reconnect.

See [SPEC.md](SPEC.md) for the original design document.

## Development

```bash
cd worker && cp wrangler.example.toml wrangler.toml  # fill in placeholders
cd worker && npx wrangler dev    # API + local D1 at localhost:8787
cd app && npm run dev            # app at localhost:5173, /api proxied to 8787
```

Tests: `npx vitest run` in `app/` (card format, scheduler, optimizer data
prep) and `worker/` (replay determinism/convergence). CI runs both plus
typechecks on every push.

## License

[MIT](LICENSE)
