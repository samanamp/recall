#!/usr/bin/env node
/**
 * recall one-shot setup: D1 database, config, secrets, build, deploy.
 *
 * Prerequisites (have these ready):
 *   1. A free Cloudflare account.
 *   2. A GitHub repo for your cards (private recommended), e.g. yourname/recall-decks.
 *   3. A fine-grained GitHub PAT: Repository access = only that repo,
 *      Permissions = Contents: Read and write.
 *      https://github.com/settings/personal-access-tokens/new
 *
 * Usage: node tools/setup.mjs        (from the repo root)
 * Re-running is safe: existing wrangler.toml / database / secrets are reused.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workerDir = join(root, "worker");
const appDir = join(root, "app");
const rl = createInterface({ input: process.stdin, output: process.stdout });

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.error) throw r.error;
  return r;
}

/** Run wrangler in worker/, capturing output. */
const wrangler = (args, opts = {}) =>
  run("npx", ["wrangler", ...args], { cwd: workerDir, ...opts });

function step(msg) {
  console.log(`\n\x1b[1m→ ${msg}\x1b[0m`);
}

function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function ask(question, fallback) {
  const a = (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();
  return a || fallback || "";
}

// ---------------------------------------------------------------- deps

step("Installing dependencies (app + worker)");
for (const dir of [appDir, workerDir]) {
  const r = run("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) die(`npm install failed in ${dir}`);
}

// ---------------------------------------------------------------- cloudflare auth

step("Checking Cloudflare login");
const who = wrangler(["whoami"]);
if (who.status !== 0 || `${who.stdout}${who.stderr}`.includes("not authenticated")) {
  console.log("Opening browser for Cloudflare login (free account is fine)…");
  const r = wrangler(["login"], { stdio: "inherit", encoding: undefined });
  if (r.status !== 0) die("wrangler login failed");
}

// ---------------------------------------------------------------- config

const tomlPath = join(workerDir, "wrangler.toml");
let dbName = "recall";

if (existsSync(tomlPath)) {
  step("Found existing worker/wrangler.toml — reusing it");
  dbName = readFileSync(tomlPath, "utf8").match(/database_name\s*=\s*"([^"]+)"/)?.[1] ?? dbName;
} else {
  const repo = await ask('GitHub repo that holds your cards (e.g. "yourname/recall-decks")');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) die(`"${repo}" doesn't look like owner/repo`);
  const branch = await ask("Branch", "main");

  step(`Creating D1 database "${dbName}"`);
  let dbId;
  const created = wrangler(["d1", "create", dbName]);
  if (created.status === 0) {
    dbId = created.stdout.match(UUID_RE)?.[0];
  } else if (`${created.stdout}${created.stderr}`.includes("already exists")) {
    console.log("Database already exists — looking up its id…");
    const list = wrangler(["d1", "list", "--json"]);
    dbId = JSON.parse(list.stdout).find((d) => d.name === dbName)?.uuid;
  }
  if (!dbId) die(`could not determine the D1 database id:\n${created.stdout}${created.stderr}`);

  step("Writing worker/wrangler.toml");
  const toml = readFileSync(join(workerDir, "wrangler.example.toml"), "utf8")
    .replace("__DATABASE_ID__", dbId)
    .replace("__CARDS_REPO__", repo)
    .replace("__CARDS_BRANCH__", branch);
  writeFileSync(tomlPath, toml);
}

// ---------------------------------------------------------------- schema

step("Applying D1 migrations");
if (wrangler(["d1", "migrations", "apply", dbName, "--remote"], { stdio: "inherit", encoding: undefined }).status !== 0) {
  die("migrations failed");
}

// ---------------------------------------------------------------- secrets

const existing = wrangler(["secret", "list"]).stdout;
const putSecret = (name, value) => {
  if (wrangler(["secret", "put", name], { input: value }).status !== 0) {
    die(`failed to set secret ${name}`);
  }
};

step("App token (what your devices use to log in)");
let appToken = null;
if (existing.includes("APP_TOKEN")) {
  console.log("APP_TOKEN already set — keeping it (enter a value below to rotate).");
  const v = await ask("New app token (blank = keep)");
  if (v) putSecret("APP_TOKEN", (appToken = v));
} else {
  appToken = (await ask("App token (blank = generate one)")) || randomBytes(24).toString("base64url");
  putSecret("APP_TOKEN", appToken);
}

step("GitHub token (fine-grained PAT, contents r/w on your cards repo only)");
if (existing.includes("GITHUB_TOKEN")) {
  console.log("GITHUB_TOKEN already set — keeping it (enter a value below to rotate).");
  const v = await ask("New GitHub token (blank = keep)");
  if (v) putSecret("GITHUB_TOKEN", v);
} else {
  const v = await ask("GitHub token");
  if (!v) die("a GitHub token is required — create one at https://github.com/settings/personal-access-tokens/new");
  putSecret("GITHUB_TOKEN", v);
}

// ---------------------------------------------------------------- build + deploy

step("Building the app");
if (run("npm", ["run", "build"], { cwd: appDir, stdio: "inherit" }).status !== 0) die("app build failed");

step("Deploying the worker (app + API)");
const deployed = wrangler(["deploy"]);
process.stdout.write(deployed.stdout);
if (deployed.status !== 0) die(`deploy failed:\n${deployed.stderr}`);
const url = deployed.stdout.match(/https:\/\/\S+\.workers\.dev/)?.[0] ?? "(your workers.dev URL)";

console.log(`
\x1b[1m✓ recall is live: ${url}\x1b[0m

Next steps:
  1. Open ${url} on each device (Add to Home Screen for the PWA).
  2. In Settings, paste your app token and hit "Sync now":
     ${appToken ? `\x1b[1m${appToken}\x1b[0m` : "(the APP_TOKEN you kept)"}
  3. Add your first card. It lands as a markdown file in your cards repo.

To update later: git pull, then "node tools/setup.mjs" again — or set up the
fork-deploy GitHub Action (see README).
`);
rl.close();
