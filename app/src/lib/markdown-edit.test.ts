import { describe, expect, it } from "vitest";
import { toggleMarker } from "./markdown-edit";

describe("toggleMarker", () => {
  it("wraps a selection", () => {
    const r = toggleMarker("hello world", 0, 5, "**");
    expect(r.text).toBe("**hello** world");
    expect([r.selStart, r.selEnd]).toEqual([2, 7]);
  });

  it("inserts a pair at a collapsed cursor outside any span", () => {
    const r = toggleMarker("hello", 5, 5, "**");
    expect(r.text).toBe("hello****");
    expect([r.selStart, r.selEnd]).toEqual([7, 7]); // cursor between markers
  });

  it("unwraps when the selection includes the markers", () => {
    const r = toggleMarker("a **bold** b", 2, 10, "**");
    expect(r.text).toBe("a bold b");
    expect([r.selStart, r.selEnd]).toEqual([2, 6]);
  });

  it("unwraps when markers sit just outside the selection", () => {
    const r = toggleMarker("a **bold** b", 4, 8, "**");
    expect(r.text).toBe("a bold b");
    expect([r.selStart, r.selEnd]).toEqual([2, 6]);
  });

  it("de-bolds when a collapsed cursor sits inside a bold span", () => {
    //               0123456789...
    const r = toggleMarker("a **bold** b", 6, 6, "**"); // cursor between 'o' and 'l'
    expect(r.text).toBe("a bold b");
    expect([r.selStart, r.selEnd]).toEqual([4, 4]); // cursor stays between o and l
  });

  it("de-bolds a partial selection inside a bold span", () => {
    const r = toggleMarker("a **bold** b", 5, 7, "**"); // 'ol' selected
    expect(r.text).toBe("a bold b");
    expect([r.selStart, r.selEnd]).toEqual([3, 5]);
  });

  it("italic inside ***both*** unwraps only the italic", () => {
    const r = toggleMarker("***both***", 5, 5, "*");
    expect(r.text).toBe("**both**");
  });

  it("bold inside ***both*** unwraps only the bold", () => {
    const r = toggleMarker("***both***", 5, 5, "**");
    expect(r.text).toBe("*both*");
  });

  it("cursor inside a LATER span unwraps that span, not the first", () => {
    const r = toggleMarker("**a** and **b**", 12, 12, "**");
    expect(r.text).toBe("**a** and b");
  });

  it("cursor between two spans (not inside either) wraps fresh", () => {
    const r = toggleMarker("**a** x **b**", 7, 7, "**");
    expect(r.text).toBe("**a** x**** **b**");
  });

  it("italic tokens are not confused by bold markers", () => {
    const r = toggleMarker("**bold** and *it*", 15, 15, "*"); // cursor inside *it*
    expect(r.text).toBe("**bold** and it");
  });
});
