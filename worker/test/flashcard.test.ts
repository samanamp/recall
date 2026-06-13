import { describe, expect, it } from "vitest";
import { buildMessages, parseFlashcards } from "../src/flashcard";
import { cardPath, sanitizeDeck, serializeCardFile, slugify } from "../src/cardfile";

describe("parseFlashcards", () => {
  it("parses a JSON array of cards", () => {
    expect(parseFlashcards('[{"front":"Q1","back":"A1"},{"front":"Q2","back":"A2"}]')).toEqual([
      { front: "Q1", back: "A1" },
      { front: "Q2", back: "A2" },
    ]);
  });

  it("accepts an already-parsed array (some models pre-parse)", () => {
    expect(parseFlashcards([{ front: "Q", back: "A" }])).toEqual([{ front: "Q", back: "A" }]);
  });

  it("wraps a single object and a {cards:[]} envelope", () => {
    expect(parseFlashcards('{"front":"Q","back":"A"}')).toEqual([{ front: "Q", back: "A" }]);
    expect(parseFlashcards('{"cards":[{"front":"Q","back":"A"}]}')).toEqual([
      { front: "Q", back: "A" },
    ]);
  });

  it("tolerates code fences and leading prose", () => {
    const raw = 'Sure!\n```json\n[{"front":"What is X?","back":"Y"}]\n```';
    expect(parseFlashcards(raw)).toEqual([{ front: "What is X?", back: "Y" }]);
  });

  it("skips malformed entries but keeps the good ones", () => {
    const raw = '[{"front":"ok","back":"yes"},{"front":"no back"},{"back":"no front"}]';
    expect(parseFlashcards(raw)).toEqual([{ front: "ok", back: "yes" }]);
  });

  it("caps the number of cards", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ front: `q${i}`, back: `a${i}` }));
    expect(parseFlashcards(many).length).toBe(5);
  });

  it("throws when nothing usable is present", () => {
    expect(() => parseFlashcards("[]")).toThrow();
    expect(() => parseFlashcards("no json here")).toThrow();
    expect(() => parseFlashcards("")).toThrow();
  });

  it("trims and clamps runaway output", () => {
    const card = parseFlashcards([{ front: "  Q  ", back: "x".repeat(5000) }])[0];
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
