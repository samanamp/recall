import { describe, expect, it } from "vitest";
import { deckFolders, resolveDeck, sanitizeDeck } from "../src/cardfile";
import { bytesToBase64, utf8ToBase64 } from "../src/encoding";
import { isBlobSha, isSafePath } from "../src/validate";

describe("isSafePath", () => {
  it("accepts ordinary card and media paths", () => {
    for (const p of [
      "decks/rust/01jxk4m9v7-ownership.md",
      "decks/ML/Transformers/01abc-attention.md",
      "decks/Machine Learning/.gitkeep",
      "media/5bea0cf326b86c9fbd97.webp",
    ]) {
      expect(isSafePath(p), p).toBe(true);
    }
  });

  it("rejects traversal and other adversarial inputs", () => {
    for (const p of [
      "",
      "decks",
      "decks/",
      "/decks/a.md",
      "decks/../secrets.md",
      "decks/a/../../x.md",
      "decks/..",
      "decks/a..b/x.md",
      "decks/./x.md",
      "decks//x.md",
      "decks/a/",
      "decks\\..\\x.md",
      "decks/a\u0000.md",
      "decks/a\n.md",
      ".github/workflows/deploy.yml",
      "README.md",
      "mediax/a.png",
      "decks/" + "a".repeat(2000),
      42,
      null,
      undefined,
    ]) {
      expect(isSafePath(p), JSON.stringify(p)).toBe(false);
    }
  });
});

describe("isBlobSha", () => {
  it("accepts SHA-1 and SHA-256 object ids", () => {
    expect(isBlobSha("a".repeat(40))).toBe(true);
    expect(isBlobSha("0123456789abcdef".repeat(4))).toBe(true);
  });

  it("rejects anything that could reshape the GitHub URL", () => {
    for (const s of [
      "",
      "a".repeat(39),
      "a".repeat(41),
      "a".repeat(63),
      "A".repeat(40),
      "../../contents/x",
      "a".repeat(40) + "?x=1",
      "a".repeat(40) + "/",
      "g".repeat(40),
      ["a".repeat(40)],
      null,
    ]) {
      expect(isBlobSha(s), JSON.stringify(s)).toBe(false);
    }
  });
});

describe("sanitizeDeck", () => {
  it("normalizes names into safe folder paths", () => {
    expect(sanitizeDeck("rust")).toBe("rust");
    expect(sanitizeDeck("  Machine Learning ")).toBe("Machine-Learning");
    expect(sanitizeDeck("ML/Transformers")).toBe("ML/Transformers");
    expect(sanitizeDeck("système_日本語")).toBe("système_日本語");
  });

  it("neutralizes traversal and junk", () => {
    expect(sanitizeDeck("../../etc")).toBe("etc");
    expect(sanitizeDeck("a/./b")).toBe("a/b");
    expect(sanitizeDeck("a//b/")).toBe("a/b");
    expect(sanitizeDeck("/abs/path/")).toBe("abs/path");
    expect(sanitizeDeck("....")).toBe("");
    expect(sanitizeDeck(". /..")).toBe("");
    expect(sanitizeDeck("a\\..\\b")).toBe("ab");
    expect(sanitizeDeck("x\u0000y%2e%2e")).toBe("xy2e2e");
    expect(sanitizeDeck("<script>")).toBe("script");
    expect(sanitizeDeck(undefined as unknown as string)).toBe("");
  });

  it("resolveDeck keeps an existing folder name verbatim, sanitizes new ones", () => {
    const existing = deckFolders([
      "decks/Machine Learning/01a-x.md",
      "decks/a/b/01b-y.md",
      "media/z.webp",
    ]);
    expect([...existing].sort()).toEqual(["Machine Learning", "a/b"]);
    expect(resolveDeck("Machine Learning", existing)).toBe("Machine Learning");
    expect(resolveDeck("/a/b/", existing)).toBe("a/b");
    expect(resolveDeck("New Deck", existing)).toBe("New-Deck");
    expect(resolveDeck("../Machine Learning", existing)).toBe("Machine-Learning");
  });
});

describe("base64 encoding", () => {
  it("handles content far beyond the spread-argument limit", () => {
    const bytes = new Uint8Array(1_000_000).map((_, i) => (i * 31) & 0xff);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("encodes utf-8 text", () => {
    const text = "héllo 日本語 🎴\n".repeat(20_000);
    expect(utf8ToBase64(text)).toBe(Buffer.from(text, "utf8").toString("base64"));
  });
});
