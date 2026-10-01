import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "../src/auth";
import { allowedOrigin } from "../src/origins";
import { call, makeEnv, TOKEN } from "./helpers";

describe("bearer auth", () => {
  it("500s when APP_TOKEN is unset instead of matching 'Bearer undefined'", async () => {
    const { env } = makeEnv({ APP_TOKEN: undefined });
    const res = await call(env, "GET", "/state", undefined, { Authorization: "Bearer undefined" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server misconfigured: APP_TOKEN unset" });
  });

  it("401s a wrong or missing token", async () => {
    const { env } = makeEnv();
    expect((await call(env, "GET", "/state", undefined, { Authorization: "Bearer nope" })).status).toBe(401);
    expect((await call(env, "GET", "/state", undefined, { Authorization: "" })).status).toBe(401);
    expect(
      (await call(env, "GET", "/state", undefined, { Authorization: `Bearer ${TOKEN}x` })).status
    ).toBe(401);
  });

  it("lets the right token through", async () => {
    const { env } = makeEnv();
    const res = await call(env, "GET", "/state");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: [] });
  });

  it("constantTimeEqual compares exactly", async () => {
    expect(await constantTimeEqual("abc", "abc")).toBe(true);
    expect(await constantTimeEqual("abc", "abd")).toBe(false);
    expect(await constantTimeEqual("abc", "abcd")).toBe(false);
    expect(await constantTimeEqual("", "")).toBe(true);
  });
});

describe("CORS allow-list", () => {
  const self = "https://recall.example.workers.dev";

  it("allows same origin, localhost dev, extensions and listed origins", () => {
    expect(allowedOrigin(self, self, undefined)).toBe(self);
    expect(allowedOrigin("http://localhost:5173", self, undefined)).toBe("http://localhost:5173");
    expect(allowedOrigin("http://127.0.0.1:8787", self, undefined)).toBe("http://127.0.0.1:8787");
    const ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    expect(allowedOrigin(ext, self, undefined)).toBe(ext);
    const moz = "moz-extension://12345678-1234-1234-1234-123456789abc";
    expect(allowedOrigin(moz, self, undefined)).toBe(moz);
    expect(allowedOrigin("https://recall.pages.dev", self, " https://recall.pages.dev/ ,x")).toBe(
      "https://recall.pages.dev"
    );
  });

  it("allows any origin when the list is a wildcard", () => {
    expect(allowedOrigin("https://anything.example", self, "*")).toBe("https://anything.example");
  });

  it("refuses everything else", () => {
    expect(allowedOrigin("https://evil.example", self, undefined)).toBeNull();
    expect(allowedOrigin("http://localhost.evil.example", self, undefined)).toBeNull();
    expect(allowedOrigin("https://localhost:5173", self, "")).toBeNull();
    expect(allowedOrigin("", self, undefined)).toBeNull();
  });

  it("preflight from a foreign origin gets no allow-origin header", async () => {
    const { env } = makeEnv();
    const res = await call(env, "OPTIONS", "/sync", undefined, {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST",
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const ok = await call(env, "OPTIONS", "/sync", undefined, {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
    });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });
});
