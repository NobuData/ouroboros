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

/**
 * The icon pair the app shell's header draws (#41), as `public/`- and `docs/`-relative names.
 */
const ICONS = [
  ["public/brand/icon-light.png", "docs/brand/icon-light.png"],
  ["public/brand/icon-dark.png", "docs/brand/icon-dark.png"],
] as const;

/**
 * The tagline-lockup pair the login screen's brand panel draws (#44).
 *
 * `docs/BRAND.md` nominates the lockup for exactly this — "Login, doc headers, marketing,
 * slides" — and it is the one asset in the set that is not square, because the tagline is
 * set under the mark rather than beside it.
 */
const LOCKUPS = [
  ["public/brand/lockup-tagline-light.png", "docs/brand/lockup-tagline-light.png"],
  ["public/brand/lockup-tagline-dark.png", "docs/brand/lockup-tagline-dark.png"],
] as const;

/**
 * The glyph pair the dashboard's pulse card draws (#83).
 *
 * `docs/BRAND.md` nominates the glyph for "anywhere the mark stands alone", which is what a
 * card centrepiece is — the lockup would bring a wordmark and a tagline into a panel that is
 * already titled, and the icon is the square crop cut for a favicon.
 */
const GLYPHS = [
  ["public/brand/glyph-light.png", "docs/brand/glyph-light.png"],
  ["public/brand/glyph-dark.png", "docs/brand/glyph-dark.png"],
] as const;

/** Every copy this module serves. */
const COPIES = [...ICONS, ...LOCKUPS, ...GLYPHS];

describe("the brand marks served by the UI", () => {
  it.each(COPIES)("%s is byte-identical to %s", (copy, source) => {
    expect(readFileSync(join(UI, copy)).equals(readFileSync(join(REPO, source)))).toBe(true);
  });

  it("keeps the header's light and dark marks the same size, so the header never moves", () => {
    // docs/BRAND.md states this property of the asset pair; the shell depends on it,
    // because swapping treatments is a CSS opacity change over a stacked pair — both
    // marks are laid out at all times, so a mismatch would size the box by the larger.
    const [light, dark] = ICONS.map(([copy]) => pngSize(readFileSync(join(UI, copy))));

    expect(light).toEqual(dark);
    // Square, and big enough that the 30px mark stays sharp on a HiDPI display.
    expect(light.width).toBe(light.height);
    expect(light.width).toBeGreaterThanOrEqual(60);
  });

  it("keeps the pulse card's glyphs the same size, so the card never reflows", () => {
    // The stacked-pair technique again (app/dashboard/dashboard.css), so the same
    // requirement: both treatments are laid out at all times and a mismatch would size the
    // box by the larger. `aspect-ratio` in that sheet is this ratio, written down.
    const [light, dark] = GLYPHS.map(([copy]) => pngSize(readFileSync(join(UI, copy))));

    expect(light).toEqual(dark);
    // Wider than tall, and wide enough that the 150px mark stays sharp on a HiDPI display —
    // docs/BRAND.md puts the glyph's floor at 96px wide, and this is drawn well above it.
    expect(light.width).toBeGreaterThan(light.height);
    expect(light.width).toBeGreaterThanOrEqual(512);
  });

  it("keeps the login lockups the same size, so the brand panel never reflows", () => {
    // The same stacked-pair technique as the header (app/login/login.css), so the same
    // requirement: both are laid out at all times and a mismatch would size the box by the
    // larger. `aspect-ratio` in that sheet is this ratio, written down.
    const [light, dark] = LOCKUPS.map(([copy]) => pngSize(readFileSync(join(UI, copy))));

    expect(light).toEqual(dark);
    // Wider than tall, and wide enough that the 360px lockup stays sharp on a HiDPI display.
    expect(light.width).toBeGreaterThan(light.height);
    expect(light.width).toBeGreaterThanOrEqual(640);
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
