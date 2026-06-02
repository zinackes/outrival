import { test, expect } from "bun:test";
import sharp from "sharp";
import {
  computePerceptualHash,
  hammingDistance,
  phashToHex,
  phashFromHex,
} from "../phash";

function solid(r: number, g: number, b: number, size = 64): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

// Left half black, right half white — a strong horizontal contrast so the
// left<right comparisons set many bits.
function leftRightSplit(size = 32): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = x < size / 2 ? 0 : 255;
      const i = (y * size + x) * channels;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels } }).png().toBuffer();
}

test("identical screenshots → distance 0", async () => {
  const a = await solid(120, 120, 120);
  const b = await solid(120, 120, 120);
  const ha = await computePerceptualHash(a);
  const hb = await computePerceptualHash(b);
  expect(hammingDistance(ha, hb)).toBe(0);
});

test("a solid image hashes to 0 (no left<right anywhere)", async () => {
  const h = await computePerceptualHash(await solid(200, 50, 50));
  expect(h).toBe(0n);
});

test("a high-contrast layout differs strongly from a solid", async () => {
  const solidHash = await computePerceptualHash(await solid(10, 10, 10));
  const splitHash = await computePerceptualHash(await leftRightSplit());
  expect(splitHash).not.toBe(0n);
  // Far above the default redesign threshold (15).
  expect(hammingDistance(solidHash, splitHash)).toBeGreaterThan(15);
});

test("hex round-trips and is null-safe", async () => {
  const h = await computePerceptualHash(await leftRightSplit());
  expect(phashFromHex(phashToHex(h))).toBe(h);
  expect(phashFromHex(null)).toBeNull();
  expect(phashFromHex("")).toBeNull();
  expect(phashFromHex("zzzz")).toBeNull();
});
