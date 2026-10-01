// Request validation. The worker forwards paths and shas to GitHub and rows to
// D1, so anything malformed is stopped here rather than half-applied there.

/** Repo-relative path under decks/ or media/, with no traversal tricks. */
export function isSafePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false; // control chars, backslashes
  const parts = path.split("/");
  if (parts.length < 2 || (parts[0] !== "decks" && parts[0] !== "media")) return false;
  return parts.every((p) => p !== "" && p !== "." && !p.includes(".."));
}

/** A git object id: SHA-1 (40 hex) or SHA-256 (64 hex). */
export function isBlobSha(sha: unknown): sha is string {
  return typeof sha === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha);
}

export interface ReviewRow {
  id: string;
  cardId: string;
  rating: number;
  reviewedAt: number;
  deviceId: string;
}

/** Max reviews accepted per request (the app pushes at most this many). */
export const MAX_REVIEWS_PER_REQUEST = 500;

const MAX_ID_LENGTH = 128;

function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

/**
 * Keep well-formed reviews and count the rest. Dropping a bad row (instead of
 * failing the request) matters: clients resend the whole batch on error, so
 * one corrupt row would otherwise block every later review forever.
 */
export function parseReviews(input: unknown[]): { valid: ReviewRow[]; rejected: number } {
  const valid: ReviewRow[] = [];
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const { id, cardId, rating, reviewedAt, deviceId } = r as Record<string, unknown>;
    if (!isId(id) || !isId(cardId)) continue;
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 4) continue;
    if (typeof reviewedAt !== "number" || !Number.isFinite(reviewedAt) || reviewedAt <= 0) continue;
    valid.push({
      id,
      cardId,
      rating,
      reviewedAt: Math.round(reviewedAt),
      deviceId: isId(deviceId) ? deviceId : "unknown",
    });
  }
  return { valid, rejected: input.length - valid.length };
}

export interface ParamsUpdate {
  retention?: number;
  weights?: number[] | null;
}

/** FSRS-4.5 / 5 / 6 weight vector lengths ts-fsrs understands. */
const WEIGHT_LENGTHS = [17, 19, 21];

/** Returns the update, or an error message for a 400. */
export function parseParamsUpdate(body: unknown): ParamsUpdate | string {
  if (!body || typeof body !== "object") return "expected a JSON object";
  const { retention, weights } = body as Record<string, unknown>;
  const out: ParamsUpdate = {};
  if (retention !== undefined) {
    if (typeof retention !== "number" || !(retention >= 0.7 && retention <= 0.99)) {
      return "retention must be a number between 0.7 and 0.99";
    }
    out.retention = retention;
  }
  if (weights !== undefined) {
    if (weights === null) {
      out.weights = null; // back to FSRS defaults
    } else if (
      Array.isArray(weights) &&
      WEIGHT_LENGTHS.includes(weights.length) &&
      weights.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      out.weights = weights as number[];
    } else {
      return `weights must be null or ${WEIGHT_LENGTHS.join("/")} finite numbers`;
    }
  }
  return out;
}
