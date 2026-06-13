#!/usr/bin/env node
/**
 * Renders candidate extension icons into one comparison sheet so a human can
 * pick. Each candidate is shown big, and at 16px on both light and dark menus
 * (the real constraint). Run: node tools/icon-lab.mjs ; opens /tmp/recall-icons.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "app");
const { chromium } = await import(pathToFileURL(join(appDir, "node_modules", "playwright", "index.mjs")).href);

// ---- Flip variants: more contrast + modern (viewBox 0 0 128 128) ----
const candidates = [
  {
    id: "flip-pop",
    name: "Pop — white + sky on ink",
    svg: `<rect width="128" height="128" rx="30" fill="#0b1220"/>
      <path d="M64 22 L24 33 V95 L64 106 Z" fill="#f8fafc"/>
      <path d="M64 22 L104 33 V95 L64 106 Z" fill="#38bdf8"/>
      <line x1="64" y1="22" x2="64" y2="106" stroke="#0b1220" stroke-width="5"/>`,
  },
  {
    id: "flip-grad",
    name: "Glow — gradient on near-black",
    svg: `<defs><linearGradient id="gA" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#2dd4bf"/><stop offset=".5" stop-color="#38bdf8"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs>
      <rect width="128" height="128" rx="30" fill="#08080f"/>
      <path d="M64 22 L24 33 V95 L64 106 Z" fill="#cffafe"/>
      <path d="M64 22 L104 33 V95 L64 106 Z" fill="url(#gA)"/>
      <line x1="64" y1="20" x2="64" y2="108" stroke="#f0fdff" stroke-width="4"/>`,
  },
  {
    id: "flip-light",
    name: "Duotone — indigo + sky on light",
    svg: `<rect width="128" height="128" rx="30" fill="#eef2f7"/>
      <path d="M64 22 L24 33 V95 L64 106 Z" fill="#4f46e5"/>
      <path d="M64 22 L104 33 V95 L64 106 Z" fill="#38bdf8"/>
      <line x1="64" y1="22" x2="64" y2="106" stroke="#eef2f7" stroke-width="5"/>`,
  },
  {
    id: "flip-vibrant",
    name: "Vibrant — white card on gradient",
    svg: `<defs><linearGradient id="gB" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs>
      <rect width="128" height="128" rx="30" fill="url(#gB)"/>
      <path d="M64 22 L24 33 V95 L64 106 Z" fill="#ffffff"/>
      <path d="M64 22 L104 33 V95 L64 106 Z" fill="#c7d2fe"/>
      <line x1="64" y1="22" x2="64" y2="106" stroke="#4f46e5" stroke-width="4" opacity=".35"/>`,
  },
];

const svgEl = (inner, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

const cells = candidates
  .map(
    (c) => `
  <div class="col">
    <div class="big">${svgEl(c.svg, 112)}</div>
    <div class="name">${c.name}</div>
    <div class="row">
      <div class="chip light">${svgEl(c.svg, 16)} <span>16 light</span></div>
      <div class="chip dark">${svgEl(c.svg, 16)} <span>16 dark</span></div>
    </div>
    <div class="row">
      <div class="chip light">${svgEl(c.svg, 32)} <span>32</span></div>
      <div class="chip dark">${svgEl(c.svg, 32)} <span>32</span></div>
    </div>
  </div>`
  )
  .join("");

const html = `<!doctype html><meta charset="utf8"><body style="margin:0">
<div style="font:600 15px system-ui;color:#e4e4e7;background:#09090b;padding:24px">
  <div style="margin-bottom:16px;font-size:18px">recall icon candidates</div>
  <div style="display:flex;gap:20px;align-items:flex-start">${cells}</div>
</div>
<style>
  .col{background:#18181b;border:1px solid #27272a;border-radius:14px;padding:14px;width:150px}
  .big{display:flex;justify-content:center;margin-bottom:10px}
  .name{font-size:12px;color:#a1a1aa;text-align:center;height:32px;margin-bottom:8px}
  .row{display:flex;gap:8px;margin-top:8px}
  .chip{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border-radius:8px}
  .chip span{font-size:9px;color:#71717a}
  .chip.light{background:#ffffff}.chip.light span{color:#71717a}
  .chip.dark{background:#1f1f23}
</style></body>`;

const out = "/tmp/recall-icons.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.locator("body > div").screenshot({ path: out });
await browser.close();

// Also dump each candidate's SVG so the chosen one can be rasterized later.
mkdirSync("/tmp/iconcand", { recursive: true });
for (const c of candidates) {
  writeFileSync(join("/tmp/iconcand", `${c.id}.svg`), svgEl(c.svg, 128));
}
console.log("wrote", out);
