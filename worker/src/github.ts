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

/** Full recursive tree of the branch — used as the sync manifest. */
export async function getTree(env: GitHubEnv): Promise<TreeEntry[]> {
  const res = await fetch(
    `${API}/repos/${env.GITHUB_REPO}/git/trees/${env.GITHUB_BRANCH}?recursive=1`,
    { headers: headers(env) }
  );
  if (res.status === 404) return []; // empty repo (no commits yet)
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const data = (await res.json()) as { tree: TreeEntry[] };
  return data.tree.filter((e) => e.type === "blob");
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
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const data = (await res.json()) as { sha: string; content: string };
  return { path, sha: data.sha, contentBase64: data.content.replace(/\n/g, "") };
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
  if (!res.ok) throw new GitHubError(res.status, await res.text());
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
  if (!res.ok) throw new GitHubError(res.status, await res.text());
}

export class GitHubError extends Error {
  constructor(public status: number, body: string) {
    super(`GitHub API ${status}: ${body.slice(0, 200)}`);
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
