import { describe, expect, it } from "vitest";
import { buildMessages, parseFlashcard } from "../src/flashcard";
import { cardPath, sanitizeDeck, serializeCardFile, slugify } from "../src/cardfile";

describe("parseFlashcard", () => {
  it("parses a clean JSON object", () => {
    expect(parseFlashcard('{"front":"Q?","back":"A"}')).toEqual({ front: "Q?", back: "A" });
  });

  it("accepts an already-parsed object (some models pre-parse)", () => {
    expect(parseFlashcard({ front: "Q?", back: "A" })).toEqual({ front: "Q?", back: "A" });
  });

  it("tolerates code fences and leading prose", () => {
    const raw = 'Sure!\n```json\n{"front":"What is X?","back":"Y"}\n```';
    expect(parseFlashcard(raw)).toEqual({ front: "What is X?", back: "Y" });
  });

  it("grabs the object even with trailing text", () => {
    expect(parseFlashcard('{"front":"a","back":"b"} hope this helps')).toEqual({
      front: "a",
      back: "b",
    });
  });

  it("throws on missing fields or non-JSON", () => {
    expect(() => parseFlashcard('{"front":"only front"}')).toThrow(/back/);
    expect(() => parseFlashcard('{"back":"only back"}')).toThrow(/front/);
    expect(() => parseFlashcard("no json here")).toThrow();
    expect(() => parseFlashcard("")).toThrow();
  });

  it("trims and clamps runaway output", () => {
    const long = "x".repeat(5000);
    const card = parseFlashcard(JSON.stringify({ front: "  Q  ", back: long }));
    expect(card.front).toBe("Q");
    expect(card.back.length).toBe(2000);
  });
});

describe("buildMessages", () => {
  it("includes the passage, context, and a JSON instruction", () => {
    const msgs = buildMessages("Some text", { title: "Page T", url: "http://x" });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toMatch(/JSON/);
    expect(msgs[1].content).toContain("Some text");
    expect(msgs[1].content).toContain("Page T");
    expect(msgs[1].content).toContain("http://x");
  });

  it("adds a 'make it different' nudge when regenerating", () => {
    const msgs = buildMessages("t", { avoid: "old question?" });
    expect(msgs[1].content).toContain("old question?");
    expect(msgs[1].content).toMatch(/different/i);
  });

  it("caps a giant passage", () => {
    const msgs = buildMessages("a".repeat(9000));
    expect(msgs[1].content.length).toBeLessThan(5000);
  });
});

describe("worker cardfile", () => {
  it("sanitizes deck names", () => {
    expect(sanitizeDeck("  rust ")).toBe("rust");
    expect(sanitizeDeck("../../etc")).toBe("/etc".replace(/^\/+/, "")); // .. stripped, slashes trimmed
    expect(sanitizeDeck("/a/")).toBe("a");
  });

  it("builds a safe path and matches the app's slug rules", () => {
    expect(slugify("What does `Box<T>` do?")).toBe("what-does-do");
    const p = cardPath("rust", "01ABCDEF", "Hello World");
    expect(p).toBe("decks/rust/01abcdef-hello-world.md");
  });

  it("serializes in the canonical card-file shape", () => {
    expect(serializeCardFile({ id: "01X", created: "2026-06-12", front: " F ", back: " B " })).toBe(
      "---\nid: 01X\ncreated: 2026-06-12\n---\nF\n---\nB\n"
    );
  });
});
