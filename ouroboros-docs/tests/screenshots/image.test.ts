import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { PUBLISHED_WIDTH, optimiseCapture } from "../../screenshots/lib/image.ts";

/**
 * A synthetic 2× capture: a gradient with blocks of colour, so quantisation has work to do.
 *
 * @param width the width in pixels.
 * @param height the height in pixels.
 * @returns a PNG.
 */
async function capture(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = (x * 255) / width;
      pixels[offset + 1] = (y * 255) / height;
      pixels[offset + 2] = (x + y) % 64 < 32 ? 40 : 200;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe("optimiseCapture", () => {
  it("brings a 2× capture down to the published width, keeping the aspect ratio", async () => {
    const out = await optimiseCapture(await capture(2880, 1800));
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(PUBLISHED_WIDTH);
    expect(meta.height).toBe(900);
    expect(meta.format).toBe("png");
  });

  it("never enlarges a narrower capture", async () => {
    const meta = await sharp(await optimiseCapture(await capture(600, 300))).metadata();
    expect(meta.width).toBe(600);
  });

  it("turns the same capture into the same bytes", async () => {
    const raw = await capture(1200, 800);
    expect((await optimiseCapture(raw)).equals(await optimiseCapture(raw))).toBe(true);
  });

  it("writes a palette PNG smaller than the capture", async () => {
    const raw = await capture(2880, 1800);
    const out = await optimiseCapture(raw);
    expect((await sharp(out).metadata()).isPalette).toBe(true);
    expect(out.length).toBeLessThan(raw.length);
  });
});
