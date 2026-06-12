import { beforeEach, describe, expect, it, vi } from "vitest";
import { getColorTheme, setColorTheme } from "./theme";

describe("color theme", () => {
  const values = new Map<string, string>();
  const dataset: Record<string, string> = {};

  beforeEach(() => {
    values.clear();
    for (const key of Object.keys(dataset)) delete dataset[key];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("document", { documentElement: { dataset } });
  });

  it("defaults invalid or missing values to sky", () => {
    expect(getColorTheme()).toBe("sky");
    values.set("colorTheme", "unknown");
    expect(getColorTheme()).toBe("sky");
  });

  it("persists and immediately applies a selection", () => {
    setColorTheme("terminal");
    expect(values.get("colorTheme")).toBe("terminal");
    expect(dataset.accentTheme).toBe("terminal");
  });
});
