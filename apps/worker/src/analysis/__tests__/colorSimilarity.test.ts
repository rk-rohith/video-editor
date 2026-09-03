import { describe, expect, it } from "vitest";
import { hasOverlappingDominantColor } from "../colorSimilarity.js";

describe("hasOverlappingDominantColor", () => {
  it("matches identical colors", () => {
    expect(hasOverlappingDominantColor(["#0000ff"], ["#0000ff"])).toBe(true);
  });

  it("matches close-but-not-identical colors within the threshold", () => {
    expect(hasOverlappingDominantColor(["#0000ff"], ["#0000d0"])).toBe(true);
  });

  it("rejects clearly different colors (blue vs red)", () => {
    expect(hasOverlappingDominantColor(["#0000ff"], ["#ff0000"])).toBe(false);
  });

  it("matches if ANY pair overlaps across multi-color palettes", () => {
    expect(hasOverlappingDominantColor(["#111111", "#0000ff"], ["#eeeeee", "#0000e0"])).toBe(true);
  });

  it("returns false for an empty palette on either side", () => {
    expect(hasOverlappingDominantColor([], ["#0000ff"])).toBe(false);
  });
});
