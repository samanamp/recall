import { getSettings } from "./db";

/** Typed client for the recall worker. All calls require configured settings. */

export interface ManifestFile {
  path: string;
  sha: string;
}

export interface ServerCardState {
  card_id: string;
  due: number;
  state: number;
  fsrs_json: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const settings = await getSettings();
  if (!settings) throw new ApiError(0, "not configured — set worker URL and token in Settings");
  const res = await fetch(`${settings.workerUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.appToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  manifest: () => request<{ files: ManifestFile[] }>("/cards/manifest"),

  getFile: (path: string) =>
    request<{ path: string; sha: string; contentBase64: string }>(
      `/cards/file?path=${encodeURIComponent(path)}`
    ),

  putFile: (body: { path: string; content: string; sha?: string; message?: string }) =>
    request<{ sha: string }>("/cards/file", { method: "PUT", body: JSON.stringify(body) }),

  deleteFile: (body: { path: string; sha: string; message?: string }) =>
    request<{ ok: true }>("/cards/file", { method: "DELETE", body: JSON.stringify(body) }),

  putMedia: (path: string, base64: string) =>
    request<{ sha: string }>("/media", { method: "PUT", body: JSON.stringify({ path, base64 }) }),

  postReviews: (
    reviews: { id: string; cardId: string; rating: number; reviewedAt: number; deviceId: string }[]
  ) => request<{ ok: true }>("/reviews", { method: "POST", body: JSON.stringify(reviews) }),

  getState: () => request<{ state: ServerCardState[] }>("/state"),
};

// ---- base64 helpers (GitHub file contents travel as base64) ----

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function b64ToText(b64: string): string {
  return new TextDecoder().decode(b64ToBytes(b64));
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
