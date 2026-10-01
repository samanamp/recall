/**
 * CORS allow-list. The PWA is normally served by this worker (same origin, no
 * CORS involved); cross-origin callers are local dev servers, the browser
 * extension, and whatever the deployer lists in ALLOWED_ORIGINS (e.g. an app
 * hosted on Pages). Anything else gets no Access-Control-Allow-Origin.
 * `ALLOWED_ORIGINS = "*"` opts back into allowing every origin (every route
 * still needs the bearer token).
 */
const BUILTIN = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^chrome-extension:\/\/[a-p]{32}$/,
  /^moz-extension:\/\/[0-9a-f-]{36}$/,
];

export function allowedOrigin(
  origin: string,
  selfOrigin: string,
  extra: string | undefined
): string | null {
  if (!origin) return null;
  if (origin === selfOrigin) return origin;
  if (BUILTIN.some((re) => re.test(origin))) return origin;
  const listed = (extra ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return listed.includes("*") || listed.includes(origin) ? origin : null;
}
