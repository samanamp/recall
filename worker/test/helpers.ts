import app from "../src/index";
import type { Env } from "../src/env";
import { createFakeD1, fakeCtx, type FakeD1 } from "./fakeD1";

export const TOKEN = "test-token-0123456789abcdef0123456789";

export function makeEnv(overrides: Partial<Env> = {}): { env: Env; d1: FakeD1 } {
  const d1 = createFakeD1();
  // A fresh manifest cache keeps GitHub off every request path under test.
  d1.sqlite
    .prepare("INSERT INTO manifest_cache (k, json, fetched_at, version) VALUES (1, '[]', ?, 1)")
    .run(Date.now() + 3_600_000);
  const env = {
    DB: d1.db,
    APP_TOKEN: TOKEN,
    GITHUB_TOKEN: "gh-test",
    GITHUB_REPO: "me/cards",
    GITHUB_BRANCH: "main",
    AI: { run: async () => "" },
    ...overrides,
  } as Env;
  return { env, d1 };
}

export function call(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return app.request(
    `https://recall.example.workers.dev/api${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    env,
    fakeCtx
  );
}

const DAY = 86_400_000;
export const T0 = Date.UTC(2026, 0, 1, 12);

/** A deterministic multi-card log: card i gets (i % 6) + 1 reviews. */
export function sampleReviews(cards: number, prefix = "card") {
  const out: { id: string; cardId: string; rating: number; reviewedAt: number; deviceId: string }[] = [];
  for (let i = 0; i < cards; i++) {
    const n = (i % 6) + 1;
    for (let j = 0; j < n; j++) {
      out.push({
        id: `${prefix}-${i}-r${j}`,
        cardId: `${prefix}-${String(i).padStart(3, "0")}`,
        rating: ((i + j) % 4) + 1,
        reviewedAt: T0 + (j * (j + 1) * DAY) / 2 + i * 1000,
        deviceId: j % 2 ? "phone" : "laptop",
      });
    }
  }
  return out;
}
