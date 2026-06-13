# recall — browser extension

Highlight text on any page → **right-click → "Create recall flashcard"** → a
small panel drafts a few atomic cards with AI (one per idea worth remembering),
you trim/edit them, hit Save. They land in your deck like any other card.

The generation runs on **your** recall worker via Cloudflare Workers AI — no
extra account, no API key, free-tier covers hundreds of cards a day. The card
is always shown for review before saving; nothing is created silently.

## Install (load unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. **Load unpacked** → select this `extension/` folder.
3. Click the recall icon (or the extension's **Details → Extension options**)
   and enter your **Worker URL** (e.g. `https://recall-api.yourname.workers.dev`)
   and your **App token** — the same two values your recall app uses. Hit
   **Test connection**.

That's it. Works in Chrome, Edge, Brave, and other Chromium browsers.

> Requires the worker to have the Workers AI binding (it's in
> `wrangler.example.toml`). If you deployed before this feature, redeploy:
> `cd worker && npx wrangler deploy`.

## Using it

- Select text → right-click → **Create recall flashcard from "…"**.
- The panel drafts 1–4 atomic cards (a rich passage yields several; a thin one,
  just one). Edit any of them, **×** to drop the ones you don't want, and pick a
  deck (it remembers your last and suggests existing decks).
- **↻ Regenerate** for a different set. **Save** (or `⌘/Ctrl+Enter`) keeps what's
  left; **Esc** discards everything.

## How it's wired

```
content.js    shadow-DOM preview overlay (no page-style bleed); UI only
background.js context menu + all worker calls — the app token stays here,
              never enters the page
worker        POST /api/flashcard  (text → {cards:[…]} via Workers AI)
              POST /api/cards       (creates one card file in your repo)
```

The app token lives only in the service worker and `chrome.storage`; the
content script never sees it. Nothing is sent anywhere except your own worker.

## Notes

- It can't run on `chrome://` pages, the Chrome Web Store, or some PDF viewers
  (the browser blocks content scripts there) — use it on normal web pages.
- `host_permissions` is broad (`<all_urls>`) because your worker URL is
  yours to choose; the extension only ever calls that one origin.
