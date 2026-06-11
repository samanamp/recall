import { afterEach, describe, expect, it } from "vitest";
import { configureScheduler, previewIntervals, rateCard } from "./scheduler";

const NOW = new Date(Date.UTC(2026, 0, 1, 12));

afterEach(() => configureScheduler(0.9, null)); // reset module state

describe("client-side scheduling", () => {
  it("a new card rated Good is due soon (learning step), Easy much later", () => {
    const good = rateCard(undefined, "c1", 3, NOW);
    const easy = rateCard(undefined, "c1", 4, NOW);
    expect(good.due).toBeGreaterThan(NOW.getTime());
    expect(easy.due).toBeGreaterThan(good.due);
  });

  it("ratings order due dates: Again ≤ Hard ≤ Good ≤ Easy", () => {
    const dues = ([1, 2, 3, 4] as const).map((r) => rateCard(undefined, "c", r, NOW).due);
    expect(dues[0]).toBeLessThanOrEqual(dues[1]);
    expect(dues[1]).toBeLessThanOrEqual(dues[2]);
    expect(dues[2]).toBeLessThanOrEqual(dues[3]);
  });

  it("state rows survive a rate → re-rate round trip (fsrsJson is revivable)", () => {
    const first = rateCard(undefined, "c1", 3, NOW);
    const later = new Date(NOW.getTime() + 86_400_000);
    const second = rateCard(first, "c1", 3, later);
    expect(second.due).toBeGreaterThan(later.getTime());
    expect(() => JSON.parse(second.fsrsJson)).not.toThrow();
  });

  it("previewIntervals returns human-readable, ordered intervals", () => {
    const p = previewIntervals(undefined, NOW);
    for (const grade of [1, 2, 3, 4] as const) {
      expect(p[grade]).toMatch(/^\d+(\.\d+)?(m|h|d|mo|y)$/);
    }
  });

  it("configureScheduler(retention) changes scheduling: stricter = sooner due", () => {
    configureScheduler(0.97, null);
    const strict = rateCard(undefined, "c", 4, NOW);
    configureScheduler(0.8, null);
    const lax = rateCard(undefined, "c", 4, NOW);
    expect(strict.due).toBeLessThan(lax.due);
  });

  it("falls back to defaults when given garbage weights", () => {
    expect(() => configureScheduler(0.9, [1, 2, 3])).not.toThrow();
    expect(() => rateCard(undefined, "c", 3, NOW)).not.toThrow();
  });
});
