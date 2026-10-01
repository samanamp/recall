import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

/**
 * Single-user auth: one shared bearer token. A missing secret is a deploy
 * mistake, not a wrong password — say so instead of comparing against
 * "Bearer undefined".
 */
export function bearerAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const secret = c.env.APP_TOKEN;
    if (!secret) {
      return c.json({ error: "server misconfigured: APP_TOKEN unset" }, 500);
    }
    const given = c.req.header("Authorization") ?? "";
    if (!(await constantTimeEqual(given, `Bearer ${secret}`))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

/**
 * Compare without leaking how many leading bytes matched. Hashing first makes
 * both sides 32 bytes, so the length of the secret doesn't leak either.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") return subtle.timingSafeEqual(ha, hb);
  return xorEqual(new Uint8Array(ha), new Uint8Array(hb)); // node (tests) lacks it
}

function xorEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}
