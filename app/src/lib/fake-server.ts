import { createEmptyCard } from "ts-fsrs";
import { vi } from "vitest";
import { ApiError, type ManifestFile, type ServerCardState } from "./api";

/**
 * Test double for the worker: an in-memory repo + review log implementing
 * the slice of `api` that sync.ts and actions.ts use. Tests reach into
 * `files`/`reviews` to play "another device", and wrap individual methods
 * (`mockImplementationOnce`) to interleave local actions with a request.
 */

interface Review {
  id: string;
  cardId: string;
  rating: number;
  reviewedAt: number;
  deviceId: string;
}

function textToB64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export class FakeServer {
  files = new Map<string, { sha: string; content: string }>();
  reviews = new Map<string, Review>();
  /** Bumped on every change, like the worker's version:params:seq cursor. */
  seq = 0;
  private shaN = 0;

  write(path: string, content: string): string {
    const sha = `sha${++this.shaN}`;
    this.files.set(path, { sha, content });
    this.seq++;
    return sha;
  }

  remove(path: string): void {
    this.files.delete(path);
    this.seq++;
  }

  cursor(): string {
    return `c${this.seq}`;
  }

  manifest(): ManifestFile[] {
    return [...this.files].map(([path, f]) => ({ path, sha: f.sha }));
  }

  /** Derived card_state: one row per card with reviews (stand-in for replay). */
  state(): ServerCardState[] {
    const n = new Map<string, number>();
    for (const r of this.reviews.values()) n.set(r.cardId, (n.get(r.cardId) ?? 0) + 1);
    return [...n].map(([card_id, count]) => ({
      card_id,
      due: count,
      state: 2,
      fsrs_json: JSON.stringify({ ...createEmptyCard(new Date(0)), state: 2, reps: count }),
    }));
  }

  private addReviews(reviews: Review[]): void {
    for (const r of reviews) this.reviews.set(r.id, r);
    if (reviews.length) this.seq++;
  }

  /** vi.fn-wrapped implementations, to Object.assign onto the mocked `api`. */
  api() {
    return {
      sync: vi.fn(async (reviews: Review[], cursor?: string) => {
        this.addReviews(reviews);
        const base = { cursor: this.cursor(), reviewCount: this.reviews.size, accepted: reviews.length };
        if (reviews.length === 0 && cursor === this.cursor()) {
          return { ...base, unchanged: true as const };
        }
        return {
          ...base,
          files: this.manifest(),
          state: this.state(),
          params: { retention: 0.9, weights: null },
        } as {
          cursor: string;
          reviewCount: number;
          accepted: number;
          files: ManifestFile[];
          state: ServerCardState[];
          params: { retention: number; weights: number[] | null };
          stateIsDelta?: true;
        };
      }),
      postReviews: vi.fn(async (reviews: Review[]) => {
        if (reviews.length > 500) throw new ApiError(400, "400: bad request");
        this.addReviews(reviews);
        return { ok: true as const };
      }),
      deleteReview: vi.fn(async (id: string) => {
        if (!this.reviews.delete(id)) return { ok: true as const, missing: true as const };
        this.seq++;
        return { ok: true as const };
      }),
      manifest: vi.fn(async () => ({ files: this.manifest() })),
      batchFiles: vi.fn(async (items: { path: string; sha: string }[]) => ({
        files: items
          .filter((it) => this.files.has(it.path))
          .map((it) => {
            const f = this.files.get(it.path)!;
            return { path: it.path, sha: f.sha, contentBase64: textToB64(f.content) };
          }),
      })),
      getFile: vi.fn(async (path: string) => {
        const f = this.files.get(path);
        if (!f) throw new ApiError(404, "404: not found");
        return { path, sha: f.sha, contentBase64: textToB64(f.content) };
      }),
      putFile: vi.fn(async (body: { path: string; content: string; sha?: string }) => {
        const f = this.files.get(body.path);
        // GitHub: updating needs the current sha; creating must omit it (422 → 409).
        if (f ? body.sha !== f.sha : body.sha !== undefined) throw new ApiError(409, "409: conflict");
        return { sha: this.write(body.path, body.content) };
      }),
      deleteFile: vi.fn(async (body: { path: string }) => {
        if (this.files.has(body.path)) this.remove(body.path);
        return { ok: true as const };
      }),
      putMedia: vi.fn(async (path: string, base64: string) => {
        if (this.files.has(path)) throw new ApiError(409, "409: already exists");
        return { sha: this.write(path, base64) };
      }),
      getMediaBlob: vi.fn(async (path: string) => {
        const f = this.files.get(path);
        if (!f) throw new ApiError(404, `media ${path}: 404`);
        return new Blob([f.content]);
      }),
    };
  }
}
