// One-off: re-encode existing repo images to the app's current spec
// (max 1000px, WebP q80, content-hash names) and rewrite card references.
import sharp from "sharp";
import { createHash } from "node:crypto";

const W = process.env.RECALL_API ?? "https://recall-api.info-d80.workers.dev";
const H = { Authorization: `Bearer ${process.env.RECALL_TOKEN}` };
const JSONH = { ...H, "Content-Type": "application/json" };

async function req(path, init = {}) {
  const res = await fetch(`${W}${path}`, { headers: JSONH, ...init, headers: { ...JSONH, ...init.headers } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res;
}

const { files } = await (await req("/sync", { method: "POST", body: '{"reviews":[]}' })).json();
const mediaFiles = files.filter((f) => f.path.startsWith("media/") && !f.path.endsWith(".webp"));
const cardFiles = files.filter((f) => f.path.startsWith("decks/") && f.path.endsWith(".md"));

const renames = new Map(); // old filename -> new filename
for (const m of mediaFiles) {
  const buf = Buffer.from(await (await req(`/media/file?path=${encodeURIComponent(m.path)}`)).arrayBuffer());
  const out = await sharp(buf)
    .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const hash = createHash("sha256").update(out).digest("hex").slice(0, 20);
  const newPath = `media/${hash}.webp`;
  await req("/media", { method: "PUT", body: JSON.stringify({ path: newPath, base64: out.toString("base64") }) });
  renames.set(m.path.split("/")[1], newPath.split("/")[1]);
  console.log(`${m.path} ${buf.length}B -> ${newPath} ${out.length}B (${Math.round((1 - out.length / buf.length) * 100)}% smaller)`);
}

for (const c of cardFiles) {
  const file = await (await req(`/cards/file?path=${encodeURIComponent(c.path)}`)).json();
  let text = Buffer.from(file.contentBase64, "base64").toString("utf8");
  let changed = false;
  for (const [oldName, newName] of renames) {
    if (text.includes(oldName)) {
      text = text.replaceAll(oldName, newName);
      changed = true;
    }
  }
  if (changed) {
    await req("/cards/file", {
      method: "PUT",
      body: JSON.stringify({ path: c.path, content: text, sha: file.sha, message: `rewrite image refs: ${c.path}` }),
    });
    console.log(`updated refs in ${c.path}`);
  }
}

for (const m of mediaFiles) {
  await req("/cards/file", {
    method: "DELETE",
    body: JSON.stringify({ path: m.path, sha: m.sha, message: `remove unoptimized ${m.path}` }),
  });
  console.log(`deleted ${m.path}`);
}
console.log("done");
