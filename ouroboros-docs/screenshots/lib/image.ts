import sharp from "sharp";

/**
 * Turning a raw capture into the file the site serves (CZ.1 #1170, roadmap decision D6).
 *
 * Captures are taken at device scale 2 for crisp text, then brought down to the width the
 * site lays them out at and written as a palette PNG — small enough for the repository and
 * the image, sharp enough to read. sharp writes no timestamps or other metadata, so the same
 * capture always becomes the same bytes.
 */

/** The width every published screenshot is written at, in pixels. */
export const PUBLISHED_WIDTH = 1440;

/**
 * Downscales and optimises one capture.
 *
 * @param capture the PNG Playwright took (2× the viewport).
 * @param width the published width; defaults to {@link PUBLISHED_WIDTH}. A capture already
 *   that narrow — a cropped element — is never enlarged.
 * @returns the optimised PNG.
 */
export async function optimiseCapture(
  capture: Buffer,
  width: number = PUBLISHED_WIDTH,
): Promise<Buffer> {
  return sharp(capture)
    .resize({ width, withoutEnlargement: true, kernel: "lanczos3" })
    .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9, dither: 0 })
    .toBuffer();
}
