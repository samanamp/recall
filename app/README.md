# recall — app

The recall client: an offline-first PWA for reviewing markdown flashcards with
FSRS spaced repetition. Cards, scheduling state and pending reviews live in
IndexedDB (Dexie), so the app works without a connection and syncs with your
recall worker when it can. The worker stores cards as `.md` files in your GitHub
repo and review history in D1. See the [root README](../README.md) for setup
and [SPEC.md](../SPEC.md) for the design.

Stack: React 19, Tailwind 4, Dexie, react-markdown with GFM, KaTeX and
highlight.js, ts-fsrs, and vite-plugin-pwa.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
```

Open **Settings** and enter:

- **App token**: the `APP_TOKEN` you set for your worker.
- **Worker URL**: your worker, e.g. `https://recall-api.<you>.workers.dev`.
  Leave it blank when the worker serves the app itself (production). Locally,
  `/api` is proxied to `wrangler dev` on `:8787`, so run the worker from
  `../worker` and leave it blank, or point it at a deployed worker. You can
  preset it with `VITE_WORKER_URL`.

Then hit **Save & sync now**.

## Scripts

| Script            | What it does                                         |
| ----------------- | ---------------------------------------------------- |
| `npm run dev`     | Vite dev server with HMR                             |
| `npm run build`   | Type-check (`tsc -b`), then build to `dist/` with the service worker |
| `npm run preview` | Serve the production build locally                   |
| `npm test`        | Unit tests (Vitest)                                  |
| `npm run lint`    | ESLint                                               |

## Layout

```
index.html            CSP, pre-paint theme script (public/theme-init.js)
public/               icon, theme-init.js
src/
  main.tsx            boot: theme, auto-sync, service-worker updates
  App.tsx             header (mark, nav, sync status), routes, phone tab bar
  index.css           design tokens (paper/ink/accent), card typography
  fonts.css           bundled Literata, Inter, JetBrains Mono (latin subsets)
  screens/            Decks, Review, Editor, Browser, Stats, Settings
  components/         Markdown renderer (lazy), SyncPill, Mark, icons
  lib/
    db.ts             Dexie schema + kv helpers
    sync.ts           sync engine (push files, sync reviews, pull state)
    api.ts            worker API client
    actions.ts        user actions: save/delete card, record/undo review
    scheduler.ts      FSRS queue building and interval previews
    theme.ts          light/dark/system mode and accent themes
    apkg*.ts          Anki .apkg import
    optimize.ts       on-device FSRS parameter optimizer (wasm)
```

## Design notes

The UI follows an "index card" idea. Each card is near-white stock on a cool
grey desk, with a coloured header rule in the accent colour. Card text is set in
Literata, a typeface made for reading on screens, and the chrome uses Inter.
Colours are CSS custom properties in `src/index.css` (`--paper`, `--ink`,
`--muted`, `--hairline`, `--accent-*`), with light and dark values, exposed to
Tailwind through `@theme`. Each of the five accent themes sets its own text,
fill and rule colours, and deck colours rotate around the accent's hue
(`lib/deck-color.ts`). All text pairs meet WCAG AA.
