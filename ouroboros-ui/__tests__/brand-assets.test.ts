import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The brand marks the shell draws are **copies**, not forks.
 *
 * `docs/brand/` is the asset set cut from the brand sheet by
 * `scripts/split-brand-sheet.py` and checked by `scripts/verify-brand.sh`; Next.js can
 * only serve files under `public/`, so the two the header needs are copied there. This
 * is the check that keeps the copy honest — the same discipline `verify-tokens.sh`
 * applies to `app/tokens.css`, which is a copy of `docs/design/tokens.css` for the same
 * reason.
 *
 * A brand change is therefore made at the source and copied down, and this test fails
 * on the pull request that forgets the second half.
 */

const UI = join(import.meta.dirname, "..");
const REPO = join(UI, "..");

/** The marks the app shell renders, as `public/`-relative and `docs/`-relative pairs. */
const COPIES = [
  ["public/brand/icon-light.png", "docs/brand/icon-light.png"],
  ["public/brand/icon-dark.png", "docs/brand/icon-dark.png"],
] as const;

describe("the brand marks served by the UI", () => {
  it.each(COPIES)("%s is byte-identical to %s", (copy, source) => {
    expect(readFileSync(join(UI, copy)).equals(readFileSync(join(REPO, source)))).toBe(true);
  });

  it("keeps the light and dark marks the same size, so the header never moves", () => {
    // docs/BRAND.md states this property of the asset pair; the shell depends on it,
    // because swapping treatments is a CSS opacity change over a stacked pair — both
    // marks are laid out at all times, so a mismatch would size the box by the larger.
    const [light, dark] = COPIES.map(([copy]) => pngSize(readFileSync(join(UI, copy))));

    expect(light).toEqual(dark);
    // Square, and big enough that the 30px mark stays sharp on a HiDPI display.
    expect(light.width).toBe(light.height);
    expect(light.width).toBeGreaterThanOrEqual(60);
  });
});

/**
 * Read a PNG's pixel dimensions out of its IHDR chunk.
 *
 * @param png The file's bytes.
 * @returns Its width and height in pixels.
 */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
