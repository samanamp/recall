#!/usr/bin/env node
/**
 * Rasterize extension/icon.svg → icons/icon-{16,48,128}.png via Chromium, so
 * gradients render exactly and the rounded-square corners stay transparent.
 * (sips flattens gradients and transparency unreliably.) Run after editing the
 * SVG: node tools/rasterize-icon.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appDir = join(root, "app");
const { chromium } = await import(pathToFileURL(join(appDir, "node_modules", "playwright", "index.mjs")).href);

const svg = readFileSync(join(root, "extension", "icon.svg"), "utf8");
const iconsDir = join(root, "extension", "icons");
const browser = await chromium.launch();

for (const size of [16, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const sized = svg.replace("<svg", `<svg width="${size}" height="${size}"`);
  await page.setContent(`<body style="margin:0">${sized}</body>`);
  await page.locator("svg").screenshot({ path: join(iconsDir, `icon-${size}.png`), omitBackground: true });
  await page.close();
  console.log(`wrote icons/icon-${size}.png`);
}
await browser.close();
