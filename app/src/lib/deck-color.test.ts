import { describe, expect, it } from "vitest";
import { DECK_SLOTS, deckColor, deckSlot } from "./deck-color";

describe("deckSlot", () => {
  const names = ["machine-learning", "systems-design", "spanish", "papers", "rust", "biology", "history", "ml", "日本語", ""];

  it("is a valid slot for any name, and stable", () => {
    for (const n of names) {
      const s = deckSlot(n);
      expect(Number.isInteger(s) && s >= 0 && s < DECK_SLOTS).toBe(true);
      expect(deckSlot(n)).toBe(s);
      expect(deckColor(n)).toBe(`var(--deck-${s})`);
    }
  });

  it("spreads ordinary names over most of the palette", () => {
    expect(new Set(names.map(deckSlot)).size).toBeGreaterThanOrEqual(5);
  });
});
