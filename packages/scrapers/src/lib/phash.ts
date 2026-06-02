import sharp from "sharp";

/**
 * Perceptual (difference) hash of a screenshot — patch-17. Catches a visual
 * redesign that the structured text diff misses: same copy, new layout / palette
 * still moves the hash. dHash is ~50 ms, no ML, deterministic.
 *
 * PURE: a buffer in, a bigint out — no DB, no network. Only depends on sharp
 * (already pulled for screenshots). Exposed as the `@outrival/scrapers/phash`
 * subpath so the worker imports it without pulling crawlee/playwright.
 */

/**
 * 64-bit dHash of an image. Resize to 9×8 grayscale, then for each of the 8 rows
 * compare each pixel to its right neighbour → one bit per of the 64 comparisons.
 * Two visually similar images differ in only a few bits.
 */
export async function computePerceptualHash(buffer: Buffer): Promise<bigint> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      if (left < right) {
        hash |= 1n << BigInt(y * 8 + x);
      }
    }
  }
  return hash;
}

/**
 * Hamming distance between two hashes (number of differing bits). 0 = identical,
 * 64 = fully different.
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

/** Hex string for storage on the snapshot row (text, not bigint, for portability). */
export function phashToHex(hash: bigint): string {
  return hash.toString(16);
}

/** Parse a stored hex hash back to a bigint; null/invalid → null (never throws). */
export function phashFromHex(hex: string | null | undefined): bigint | null {
  if (!hex) return null;
  try {
    return BigInt(`0x${hex}`);
  } catch {
    return null;
  }
}
