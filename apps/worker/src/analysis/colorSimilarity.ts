/**
 * dHash alone is color-blind — a solid blue image and a solid red image of
 * identical dimensions hash identically, because dHash only encodes local
 * brightness gradients, not absolute color (see perceptualHash.ts). For
 * near-duplicate detection we therefore require BOTH a small Hamming
 * distance AND overlapping dominant colors before calling two images
 * duplicates.
 */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

function colorsClose(a: string, b: string, threshold: number): boolean {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.abs(ar - br) <= threshold && Math.abs(ag - bg) <= threshold && Math.abs(ab - bb) <= threshold;
}

/** True if any color in `a` is close to any color in `b` — matches the coarse 32-unit quantization used when extracting dominant colors. */
export function hasOverlappingDominantColor(a: string[], b: string[], threshold = 48): boolean {
  return a.some((colorA) => b.some((colorB) => colorsClose(colorA, colorB, threshold)));
}
