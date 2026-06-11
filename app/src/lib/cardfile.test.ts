import { describe, expect, it } from "vitest";
import { cardPath, deckFromPath, parseCardFile, serializeCardFile, slugify } from "./cardfile";

describe("card file format", () => {
  it("round-trips serialize → parse", () => {
    const card = {
      id: "01JXK4M9V7T2C8R0EXAMPLE00",
      created: "2026-06-10",
      front: "What does `Box<T>` do?",
      back: "Heap-allocates `T`:\n\n```rust\nlet b = Box::new(5);\n```",
    };
    const parsed = parseCardFile(serializeCardFile(card));
    expect(parsed.id).toBe(card.id);
    expect(parsed.created).toBe(card.created);
    expect(parsed.front).toBe(card.front);
    expect(parsed.back).toBe(card.back);
    expect(parsed.hadId).toBe(true);
  });

  it("splits front/back on the first --- after frontmatter only", () => {
    const text = "---\nid: X\ncreated: 2026-01-01\n---\nfront\n---\nback with\n---\nanother divider";
    const parsed = parseCardFile(text);
    expect(parsed.front).toBe("front");
    expect(parsed.back).toBe("back with\n---\nanother divider");
  });

  it("generates an id for hand-authored files without frontmatter", () => {
    const parsed = parseCardFile("just a question\n---\nan answer");
    expect(parsed.hadId).toBe(false);
    expect(parsed.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
    expect(parsed.front).toBe("just a question");
    expect(parsed.back).toBe("an answer");
  });

  it("tolerates a missing back side", () => {
    const parsed = parseCardFile("front only");
    expect(parsed.front).toBe("front only");
    expect(parsed.back).toBe("");
  });

  it("derives deck from path, supporting nested folders", () => {
    expect(deckFromPath("decks/rust/01abc-x.md")).toBe("rust");
    expect(deckFromPath("decks/cs/algo/01abc-x.md")).toBe("cs/algo");
  });

  it("slugifies fronts safely (drops inline code, caps length)", () => {
    expect(slugify("What does `Box<T>` do in Rust?")).toBe("what-does-do-in-rust");
    expect(slugify("!!!")).toBe("card");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it("builds paths under the deck folder", () => {
    expect(cardPath("rust", "01ABC", "Borrow checker?")).toBe(
      "decks/rust/01abc-borrow-checker.md"
    );
  });
});
