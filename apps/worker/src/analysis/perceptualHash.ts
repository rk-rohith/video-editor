/**
 * Difference-hash (dHash) perceptual hashing for near-duplicate image
 * detection (spec §4: "duplicates" among uploaded photos). Pure functions,
 * no ffmpeg/filesystem access — the caller extracts a 9x8 grayscale raw
 * pixel buffer (via ffmpeg, see imageAnalysis.ts) and hands it here.
 *
 * dHash works by comparing each pixel to its right neighbor across a 9x8
 * grid (8 comparisons per row x 8 rows = 64 bits): 1 if the pixel is
 * brighter than its neighbor, 0 otherwise. Two images that look alike
 * produce hashes with a small Hamming distance; a handful of bit flips
 * (rather than an exact match) still counts as "the same shot" — that
 * tolerance is exactly what makes it useful for near-duplicate detection
 * as opposed to exact-file dedup (which contentHash already covers).
 */

const WIDTH = 9;
const HEIGHT = 8;

export function computeDHash(grayscalePixels: Buffer): string {
  if (grayscalePixels.length !== WIDTH * HEIGHT) {
    throw new Error(`computeDHash expects a ${WIDTH}x${HEIGHT} grayscale buffer (${WIDTH * HEIGHT} bytes), got ${grayscalePixels.length}`);
  }
  let hash = 0n;
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH - 1; col++) {
      const left = grayscalePixels[row * WIDTH + col]!;
      const right = grayscalePixels[row * WIDTH + col + 1]!;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export function hammingDistance(hashA: string, hashB: string): number {
  const a = BigInt(`0x${hashA}`);
  const b = BigInt(`0x${hashB}`);
  let xor = a ^ b;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

/** Two images with a Hamming distance at or below this are treated as near-duplicates. 64-bit hash; ~10% differing bits is a common, well-tested threshold. */
export const DUPLICATE_HAMMING_THRESHOLD = 6;

export function isNearDuplicate(hashA: string, hashB: string): boolean {
  return hammingDistance(hashA, hashB) <= DUPLICATE_HAMMING_THRESHOLD;
}
