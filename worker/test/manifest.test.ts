import { afterEach, describe, expect, it, vi } from "vitest";
import { getTree } from "../src/github";
import { patchFiles, patchManifest, refreshManifest } from "../src/manifest";
import { call, makeEnv } from "./helpers";

const SHA = "a".repeat(40);
const gh = { GITHUB_TOKEN: "t", GITHUB_REPO: "me/cards", GITHUB_BRANCH: "main" };

/** Route stubbed GitHub calls by URL substring → [status, body, headers]. */
function stubGitHub(routes: Record<string, [number, unknown, Record<string, string>?]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      if (!key) throw new Error(`unexpected fetch ${url}`);
      const [status, body, headers] = routes[key];
      return new Response(JSON.stringify(body), { status, headers });
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("getTree", () => {
  it("treats 404 as empty only for a repo that exists with no branches", async () => {
    stubGitHub({ "/git/trees/": [404, {}], "/branches": [200, []], "/repos/me/cards": [200, {}] });
    expect(await getTree(gh)).toEqual({ files: [], repoEmpty: true });
  });

  it("throws when the repo itself is missing or invisible to the token", async () => {
    stubGitHub({ "/git/trees/": [404, {}], "/repos/me/cards": [404, {}] });
    await expect(getTree(gh)).rejects.toThrow(/not found/);
  });

  it("throws when only the branch is missing", async () => {
    stubGitHub({
      "/git/trees/": [404, {}],
      "/branches": [200, [{ name: "master" }]],
      "/repos/me/cards": [200, {}],
    });
    await expect(getTree(gh)).rejects.toThrow(/branch main not found/);
  });

  it("throws on a truncated tree instead of returning a partial manifest", async () => {
    stubGitHub({ "/git/trees/": [200, { tree: [], truncated: true }] });
    await expect(getTree(gh)).rejects.toThrow(/truncated/);
  });
});

describe("refreshManifest", () => {
  it("refuses to replace a non-empty cache with an empty manifest from a non-empty repo", async () => {
    const { env, d1 } = makeEnv();
    d1.sqlite.exec(`UPDATE manifest_cache SET json = '[{"path":"decks/a/x.md","sha":"${SHA}"}]'`);
    stubGitHub({ "/git/trees/": [200, { tree: [{ path: "README.md", sha: SHA, type: "blob" }] }] });
    await expect(refreshManifest(env, 1)).rejects.toThrow(/refusing/);
    expect((d1.sqlite.prepare("SELECT json FROM manifest_cache").get() as { json: string }).json).toContain(
      "decks/a/x.md"
    );
  });

  it("stores sorted files so later patches compare equal to a refresh", async () => {
    const { env, d1 } = makeEnv();
    stubGitHub({
      "/git/trees/": [
        200,
        {
          tree: [
            { path: "decks/b/2.md", sha: SHA, type: "blob" },
            { path: "decks/a-b/1.md", sha: SHA, type: "blob" },
            { path: "decks/a/1.md", sha: SHA, type: "blob" },
          ],
        },
      ],
    });
    const files = await refreshManifest(env, 1);
    expect(files.map((f) => f.path)).toEqual(["decks/a-b/1.md", "decks/a/1.md", "decks/b/2.md"]);
    // A patch adding the same entries in another order yields identical JSON.
    let patched = patchFiles([], "decks/b/2.md", SHA);
    patched = patchFiles(patched, "decks/a/1.md", SHA);
    patched = patchFiles(patched, "decks/a-b/1.md", SHA);
    expect(JSON.stringify(patched)).toBe(
      (d1.sqlite.prepare("SELECT json FROM manifest_cache").get() as { json: string }).json
    );
  });
});

describe("patchManifest", () => {
  it("is a compare-and-swap that retries when another write lands first", async () => {
    const { env, d1 } = makeEnv();
    // Simulate a concurrent patch right after our first read.
    const realPrepare = env.DB.prepare.bind(env.DB);
    let raced = false;
    env.DB.prepare = ((sql: string) => {
      if (!raced && sql.startsWith("UPDATE manifest_cache SET json")) {
        raced = true;
        d1.sqlite.exec(
          `UPDATE manifest_cache SET json = '[{"path":"decks/z/other.md","sha":"${SHA}"}]', version = version + 1`
        );
      }
      return realPrepare(sql);
    }) as typeof env.DB.prepare;
    await patchManifest(env, "decks/a/new.md", SHA);
    const row = d1.sqlite.prepare("SELECT json, version FROM manifest_cache").get() as {
      json: string;
      version: number;
    };
    expect(JSON.parse(row.json).map((f: { path: string }) => f.path)).toEqual([
      "decks/a/new.md",
      "decks/z/other.md",
    ]);
    expect(row.version).toBe(3);
  });
});

describe("GitHub error mapping", () => {
  it("maps a rejected PAT to 502, never 401", async () => {
    const { env } = makeEnv();
    stubGitHub({ "/contents/": [401, { message: "Bad credentials" }] });
    const res = await call(env, "GET", "/cards/file?path=decks/a/x.md");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github: token rejected or lacks access" });
  });

  it("maps rate limits to 503 with Retry-After", async () => {
    const { env } = makeEnv();
    stubGitHub({
      "/contents/": [403, { message: "rate limit" }, { "x-ratelimit-remaining": "0", "retry-after": "42" }],
    });
    const res = await call(env, "GET", "/cards/file?path=decks/a/x.md");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("still passes 404 through", async () => {
    const { env } = makeEnv();
    stubGitHub({ "/contents/": [404, { message: "Not Found" }] });
    expect((await call(env, "GET", "/cards/file?path=decks/a/x.md")).status).toBe(404);
  });
});

describe("/cards/batch validation", () => {
  it("400s bad paths or shas before touching GitHub", async () => {
    const { env } = makeEnv();
    stubGitHub({});
    for (const items of [
      [{ path: "decks/a/x.md", sha: "../../x" }],
      [{ path: "../x", sha: SHA }],
      [{ path: "decks/a/x.md", sha: SHA }, { path: "README.md", sha: SHA }],
      [null],
    ]) {
      expect((await call(env, "POST", "/cards/batch", { items })).status).toBe(400);
    }
  });
});
