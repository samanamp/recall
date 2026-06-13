#!/usr/bin/env node
/**
 * Records a feature-tour video of recall against the local build — no real
 * deployment touched. Seeds demo data into IndexedDB, mocks /api at the
 * network layer (sync looks healthy, Stats gets pretty numbers), and drives
 * a scripted tour with a visible fake cursor.
 *
 * Usage:  cd app && npm run build   # the tour runs against app/dist
 *         node tools/demo-video.mjs
 * Output: docs/demo.webm (+ docs/demo.mp4 if ffmpeg available), docs/screenshot.png
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appDir = join(root, "app");
const docsDir = join(root, "docs");
mkdirSync(docsDir, { recursive: true });

const appModule = (m) => import(pathToFileURL(join(appDir, "node_modules", m)).href);
const { chromium } = await appModule("playwright/index.mjs");
const { fsrs, createEmptyCard } = await appModule("ts-fsrs/dist/index.mjs");

// ---------------------------------------------------------------- demo data

/** Genuine ts-fsrs state with a due date in the past — grading on camera is real. */
function dueState(cardId) {
  const f = fsrs({});
  let card = createEmptyCard(new Date(Date.now() - 40 * 864e5));
  let when = new Date(Date.now() - 40 * 864e5);
  for (;;) {
    const next = f.next(card, when, 3); // Good
    if (next.card.due.getTime() > Date.now() - 864e5) break;
    card = next.card;
    when = card.due;
  }
  return { cardId, due: card.due.getTime(), state: card.state, fsrsJson: JSON.stringify(card) };
}

const C = (id, deck, front, back) => ({
  id,
  deck,
  front,
  back,
  path: `decks/${deck}/${id.toLowerCase()}-demo.md`,
  sha: "demo",
  created: "2026-05-01",
});

const cards = [
  C("01DEMO0000000000000000RS01", "rust", "What does `Box<T>` give you?", "A **fixed-size pointer** to heap-allocated `T`.\n\nUse it for recursive types and trait objects."),
  C("01DEMO0000000000000000RS02", "rust", "`Rc<T>` vs `Arc<T>`?", "**Rc** — single-threaded reference counting.\n**Arc** — atomic counts, `Send + Sync`, slightly slower."),
  C("01DEMO0000000000000000RS03", "rust", "What does this print?\n```rust\nlet v = vec![1, 2, 3];\nprintln!(\"{}\", v.iter().sum::<i32>());\n```", "`6`"),
  C("01DEMO0000000000000000RS04", "rust", "Why prefer `&str` over `String` in function arguments?", "It accepts both `&String` (deref coercion) and string literals — **borrow, don't own**."),
  C("01DEMO0000000000000000SD01", "system-design", "CAP theorem: what does a partition force you to choose between?", "**Consistency** or **availability** — and partitions *will* happen, so the choice is real."),
  C("01DEMO0000000000000000SD02", "system-design", "When does a Bloom filter lie to you?", "Only with **false positives**:\n\n$P \\approx (1 - e^{-kn/m})^k$\n\nNever false negatives."),
  C("01DEMO0000000000000000SD03", "system-design", "Write-through vs write-back cache?", "**Write-through**: write cache + store synchronously — safe, slower.\n**Write-back**: write cache, flush later — fast, can lose data."),
  C("01DEMO0000000000000000JP01", "japanese", "犬", "**dog** — いぬ (*inu*)"),
  C("01DEMO0000000000000000JP02", "japanese", "ありがとう", "**thank you** — arigatou"),
  C("01DEMO0000000000000000JP03", "japanese", "水曜日", "**Wednesday** — すいようび (*suiyoubi*)"),
];

const dueIds = ["01DEMO0000000000000000RS01", "01DEMO0000000000000000RS02", "01DEMO0000000000000000SD01", "01DEMO0000000000000000SD02", "01DEMO0000000000000000JP01"];
const states = dueIds.map(dueState);
const decks = [{ name: "rust" }, { name: "system-design" }, { name: "japanese" }];
const kv = [
  { key: "appToken", value: "demo" },
  { key: "welcomeSeeded", value: true },
  { key: "reviewCount", value: 2847 },
  { key: "syncCursor", value: "demo" },
  { key: "newPerDay", value: 20 },
  { key: "editorDraft", value: "" },
  { key: "lastDeck", value: "" },
  { key: "fsrsParams", value: { retention: 0.9, weights: null } },
];

function statsPayload() {
  const daily = [];
  const day = (off) => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10);
  for (let i = 89; i >= 0; i--) {
    const weekday = new Date(Date.now() - i * 864e5).getDay();
    const base = 25 + Math.round(30 * Math.exp(-i / 45));
    const n = Math.max(8, Math.round(base * (weekday === 0 || weekday === 6 ? 0.55 : 1) + 14 * Math.sin(i * 1.7)));
    daily.push({ day: day(-i), n, again: Math.max(1, Math.round(n * (0.08 + 0.06 * Math.abs(Math.sin(i)))))});
  }
  const forecast = [];
  for (let i = 1; i <= 21; i++) {
    forecast.push({ day: day(i), n: Math.max(2, Math.round(30 * Math.exp(-i / 9) + 8 * Math.abs(Math.sin(i * 2.1)))) });
  }
  return { daily, forecast };
}

// ---------------------------------------------------------------- server

const preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], {
  cwd: appDir,
  stdio: "ignore",
});
const BASE = "http://localhost:4173";
for (let i = 0; ; i++) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (i > 40) throw new Error("vite preview did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ---------------------------------------------------------------- recording

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2, // crisp page.screenshot (retina); video is CSS-res regardless
  colorScheme: "dark", // recall's signature look; theme demo toggles from here
  serviceWorkers: "block", // the PWA SW would dodge our route mocks
  // MUST equal the viewport: Playwright records at CSS-pixel resolution, so a
  // larger canvas just grey-pads the frame instead of scaling content up.
  recordVideo: { dir: "/tmp/recall-demo", size: { width: 1280, height: 800 } },
});

await context.route("**/api/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/sync")) {
    return route.fulfill({ json: { unchanged: true, cursor: "demo", reviewCount: 2847, accepted: 0 } });
  }
  if (path.endsWith("/stats")) return route.fulfill({ json: statsPayload() });
  return route.fulfill({ json: { ok: true } });
});

const page = await context.newPage();

// Visible cursor dot so viewers can follow the interactions.
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText =
      "position:fixed;z-index:99999;width:22px;height:22px;border-radius:50%;" +
      "background:rgba(56,189,248,.45);border:2px solid rgba(56,189,248,.95);" +
      "pointer-events:none;transform:translate(-50%,-50%);left:-50px;top:-50px;" +
      "transition:left .05s linear, top .05s linear";
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    }, true);
    addEventListener("mousedown", () => (dot.style.background = "rgba(56,189,248,.9)"), true);
    addEventListener("mouseup", () => (dot.style.background = "rgba(56,189,248,.45)"), true);
  });
});

const sleep = (ms) => page.waitForTimeout(ms);
async function glideClick(locator, pause = 600) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${locator}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await sleep(250);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await sleep(pause);
}

// Load once so Dexie creates its schema, then seed and reload.
await page.goto(BASE);
await sleep(1200);
await page.evaluate(
  async ({ cards, states, decks, kv }) => {
    const idb = await new Promise((res, rej) => {
      const req = indexedDB.open("recall");
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const put = (store, rows) =>
      new Promise((res, rej) => {
        const tx = idb.transaction(store, "readwrite");
        for (const r of rows) tx.objectStore(store).put(r);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    await put("cards", cards);
    await put("state", states);
    await put("decks", decks);
    await put("kv", kv.map((e) => ({ key: e.key, value: e.value })));
    idb.close();
  },
  { cards, states, decks, kv }
);
await page.goto(BASE);
await sleep(2000);

// ---- 1. Decks overview
await page.mouse.move(640, 300, { steps: 15 });
await sleep(900);
await glideClick(page.locator("a", { hasText: "rust" }).first(), 0); // tile is a link → into the rust deck's review
await sleep(1400);

// ---- 2. Review: real grading
for (const grade of ["Good", "Easy"]) {
  const card = page.locator('[aria-label="Show answer"]');
  if (await card.count()) await glideClick(card.first(), 1300);
  await glideClick(page.locator("button", { hasText: grade }).first(), 1100);
}
const card3 = page.locator('[aria-label="Show answer"]');
if (await card3.count()) {
  await glideClick(card3.first(), 1200);
  await glideClick(page.locator("button", { hasText: "Again" }).first(), 900);
}

// ---- 3. Add a card (deck chips dim, live markdown preview)
await glideClick(page.getByRole("link", { name: "Add" }).first(), 800);
await glideClick(page.locator("button", { hasText: "system-design" }).first(), 700);
const ta = page.locator("textarea");
await glideClick(ta, 300);
await page.keyboard.type(
  "How does **FSRS** pick the next interval?\n---\nFrom two memory variables — stability $S$ and difficulty $D$ —\ntargeting recall probability $R = 0.9$ at review time.",
  { delay: 26 }
);
await sleep(1400);
await glideClick(page.locator("button", { hasText: "Add card" }).first(), 1600);

// ---- 4. Browse + search
await glideClick(page.getByRole("link", { name: "Browse" }).first(), 900);
const search = page.getByPlaceholder("Search cards…");
await glideClick(search, 200);
await page.keyboard.type("cache", { delay: 70 });
await sleep(1600);

// ---- 5. Stats
await glideClick(page.getByRole("link", { name: "Stats" }).first(), 1000);
await page.mouse.move(640, 500, { steps: 20 });
await sleep(2200);

// ---- 6. Themes: accent + light/dark
await glideClick(page.getByRole("link", { name: "Settings" }).first(), 300);
// straight to Appearance — don't dwell on the sync credentials section
await page.mouse.wheel(0, 800);
await sleep(900);
await glideClick(page.locator("button", { hasText: "Violet" }).first(), 1100);
await glideClick(page.locator("button", { hasText: "Matrix" }).first(), 1100);
await glideClick(page.locator("button", { hasText: "light" }).first(), 1300);
await glideClick(page.locator("button", { hasText: "dark" }).first(), 900);
await glideClick(page.locator("button", { hasText: "Sky" }).first(), 900);

// ---- 7. Close on the decks screen + grab the README screenshot
await glideClick(page.getByRole("link", { name: "Decks" }).first(), 1000);
await page.mouse.move(1100, 720, { steps: 18 });
await sleep(1800);
await page.screenshot({ path: join(docsDir, "screenshot.png") });

await context.close(); // flushes the video
const video = readdirSync("/tmp/recall-demo").find((f) => f.endsWith(".webm"));
const webm = join(docsDir, "demo.webm");
renameSync(join("/tmp/recall-demo", video), webm);
await browser.close();
preview.kill();
console.log(`✓ ${webm}`);
console.log(`✓ ${join(docsDir, "screenshot.png")}`);

// Transcode to the committed assets: MP4 (full quality) + GIF (inline in the
// README). Needs a full ffmpeg (libx264 + palettegen) — Playwright's bundled
// build is webm-only, so we look for a system one and skip cleanly if absent.
const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"].find((p) => {
  const r = spawnSync(p, ["-version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
});
if (!ffmpeg) {
  console.log("• no system ffmpeg found — skipping mp4/gif (webm kept). brew install ffmpeg to enable.");
  process.exit(0);
}
const mp4 = join(docsDir, "demo.mp4");
const gif = join(docsDir, "demo.gif");
const palette = join("/tmp", "recall-palette.png");
const ff = (args) => spawnSync(ffmpeg, ["-y", ...args], { stdio: "ignore" });
// MP4: keep the full 1600px source, near-visually-lossless.
ff(["-i", webm, "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "20", mp4]);
// GIF at the native 1280px width — NO downscale. The old 960px GIF shrank the
// ~896px content to ~672px, which GitHub then upscaled back to its ~880px column
// (upscaling = the blur). At 1280 the content lands ~1:1 in the README.
// dither=none: recall's UI is mostly flat dark surfaces + solid accent colors,
// so error diffusion only added noise (softer text, bigger file). None is both
// crisper and ~1MB smaller here.
const gscale = "fps=12,scale=1280:-1:flags=lanczos";
ff(["-i", webm, "-vf", `${gscale},palettegen=max_colors=256:stats_mode=diff`, palette]);
ff(["-i", webm, "-i", palette, "-lavfi", `${gscale}[x];[x][1:v]paletteuse=dither=none`, gif]);
console.log(`✓ ${mp4}`);
console.log(`✓ ${gif}`);
