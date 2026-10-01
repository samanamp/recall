// Thin wrapper around the GitHub Contents/Trees API for the cards repo.

export interface GitHubEnv {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "owner/repo"
  GITHUB_BRANCH: string;
}

const API = "https://api.github.com";

function headers(env: GitHubEnv): HeadersInit {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "recall-api",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export interface TreeEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
}

export interface Tree {
  files: TreeEntry[];
  /** True only when the repo was verified to exist and have no commits. */
  repoEmpty: boolean;
}

/**
 * Full recursive tree of the branch — used as the sync manifest. An empty
 * result wipes every device's local cards, so it is only ever returned for a
 * repo confirmed to exist and be empty; anything ambiguous throws.
 */
export async function getTree(env: GitHubEnv): Promise<Tree> {
  const res = await fetch(
    `${API}/repos/${env.GITHUB_REPO}/git/trees/${env.GITHUB_BRANCH}?recursive=1`,
    { headers: headers(env) }
  );
  // GitHub answers 404 (or 409 "Git Repository is empty") for a repo with no
  // commits — but also 404 for a typo'd repo, a missing branch, or a token
  // that can't see the repo. Tell those apart before trusting "empty".
  if (res.status === 404 || res.status === 409) {
    await assertRepoEmpty(env, res.status);
    return { files: [], repoEmpty: true };
  }
  if (!res.ok) throw await GitHubError.from(res);
  const data = (await res.json()) as { tree: TreeEntry[]; truncated?: boolean };
  if (data.truncated) {
    // A partial list would look like mass deletion to every device.
    throw new Error("GitHub tree truncated: cards repo too large for one tree call");
  }
  return { files: data.tree.filter((e) => e.type === "blob"), repoEmpty: false };
}

async function assertRepoEmpty(env: GitHubEnv, treeStatus: number): Promise<void> {
  const repo = await fetch(`${API}/repos/${env.GITHUB_REPO}`, { headers: headers(env) });
  if (!repo.ok) {
    if (repo.status === 404) {
      throw new Error(
        `cards repo ${env.GITHUB_REPO} not found, or GITHUB_TOKEN can't access it`
      );
    }
    throw await GitHubError.from(repo);
  }
  // No branches at all = no commits yet. Otherwise the branch name is wrong.
  const branches = await fetch(`${API}/repos/${env.GITHUB_REPO}/branches?per_page=1`, {
    headers: headers(env),
  });
  if (!branches.ok) throw await GitHubError.from(branches);
  if (((await branches.json()) as unknown[]).length > 0) {
    throw new Error(
      `branch ${env.GITHUB_BRANCH} not found in ${env.GITHUB_REPO} (tree ${treeStatus})`
    );
  }
}

/** Returns content as base64 — client decodes (utf-8 for cards, blob for media). */
export async function getFile(
  env: GitHubEnv,
  path: string
): Promise<{ path: string; sha: string; contentBase64: string }> {
  const res = await fetch(
    `${API}/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}?ref=${env.GITHUB_BRANCH}`,
    { headers: headers(env) }
  );
  if (!res.ok) throw await GitHubError.from(res);
  const data = (await res.json()) as { sha: string; content: string };
  return { path, sha: data.sha, contentBase64: data.content.replace(/\n/g, "") };
}

/** Fetch a blob by sha (from the manifest tree) — returns base64 content. */
export async function getBlobBase64(env: GitHubEnv, sha: string): Promise<string> {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/git/blobs/${sha}`, {
    headers: headers(env),
  });
  if (!res.ok) throw await GitHubError.from(res);
  const data = (await res.json()) as { content: string };
  return data.content.replace(/\n/g, "");
}

/** Fetch a file as raw bytes (streamed) — used for media. */
export async function getRawFile(env: GitHubEnv, path: string): Promise<Response> {
  const res = await fetch(
    `${API}/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}?ref=${env.GITHUB_BRANCH}`,
    { headers: { ...headers(env), Accept: "application/vnd.github.raw+json" } }
  );
  if (!res.ok) throw await GitHubError.from(res);
  return res;
}

/** Create or update a file. `sha` is required when updating, omitted when creating. */
export async function putFile(
  env: GitHubEnv,
  path: string,
  contentBase64: string,
  message: string,
  sha?: string
): Promise<{ sha: string }> {
  const res = await fetch(
    `${API}/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}`,
    {
      method: "PUT",
      headers: { ...headers(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: contentBase64,
        branch: env.GITHUB_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    }
  );
  if (!res.ok) throw await GitHubError.from(res);
  const data = (await res.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}

export async function deleteFile(
  env: GitHubEnv,
  path: string,
  sha: string,
  message: string
): Promise<void> {
  const res = await fetch(
    `${API}/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}`,
    {
      method: "DELETE",
      headers: { ...headers(env), "Content-Type": "application/json" },
      body: JSON.stringify({ message, sha, branch: env.GITHUB_BRANCH }),
    }
  );
  if (!res.ok) throw await GitHubError.from(res);
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    body: string,
    /** Seconds to wait when GitHub rate-limited us; null otherwise. */
    public retryAfter: number | null = null
  ) {
    super(`GitHub API ${status}: ${body.slice(0, 200)}`);
  }

  static async from(res: Response): Promise<GitHubError> {
    return new GitHubError(res.status, await res.text().catch(() => ""), rateLimitWait(res));
  }

  /** 401/403 that isn't a rate limit: the PAT is bad or lacks access. */
  get isAuth(): boolean {
    return (this.status === 401 || this.status === 403) && this.retryAfter === null;
  }
}

/**
 * GitHub signals rate limits as 429, or 403 with x-ratelimit-remaining: 0
 * (primary) or a retry-after header (secondary).
 */
function rateLimitWait(res: Response): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = Number(res.headers.get("retry-after"));
  if (retryAfter > 0) return Math.ceil(retryAfter);
  if (res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const wait = reset ? Math.ceil(reset - Date.now() / 1000) : 60;
    return Math.max(1, wait);
  }
  return res.status === 429 ? 60 : null;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
