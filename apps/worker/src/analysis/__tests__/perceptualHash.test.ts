import { describe, expect, it } from "vitest";
import { computeDHash, hammingDistance, isNearDuplicate } from "../perceptualHash.js";

function grid(fn: (row: number, col: number) => number): Buffer {
  const buf = Buffer.alloc(9 * 8);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 9; col++) buf[row * 9 + col] = fn(row, col);
  }
  return buf;
}

describe("computeDHash", () => {
  it("produces a 16-hex-char (64-bit) hash", () => {
    const hash = computeDHash(grid((r, c) => (r + c) * 10));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects a buffer of the wrong size", () => {
    expect(() => computeDHash(Buffer.alloc(10))).toThrow();
  });

  it("is identical for identical images", () => {
    const image = grid((r, c) => (r * 37 + c * 13) % 256);
    expect(computeDHash(image)).toBe(computeDHash(image));
  });

  it("differs for a clearly different image (solid vs. checkerboard)", () => {
    const solid = grid(() => 128);
    const checkerboard = grid((r, c) => ((r + c) % 2 === 0 ? 255 : 0));
    expect(computeDHash(solid)).not.toBe(computeDHash(checkerboard));
  });
});

describe("hammingDistance / isNearDuplicate", () => {
  it("is 0 for identical hashes", () => {
    expect(hammingDistance("abcdef0123456789", "abcdef0123456789")).toBe(0);
  });

  it("is 64 for fully inverted hashes", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("counts a single flipped bit correctly", () => {
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
  });

  it("treats small-distance hashes as near-duplicates and large-distance ones as not", () => {
    expect(isNearDuplicate("0000000000000000", "0000000000000003")).toBe(true); // 2 bits
    expect(isNearDuplicate("0000000000000000", "00000000000000ff")).toBe(false); // 8 bits
  });
});
