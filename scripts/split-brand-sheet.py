#!/usr/bin/env python3
"""split-brand-sheet.py — cut the brand sheet into the logo asset set (issue #14).

`logo-unsplit.png` at the repository root is a single 1376x768 rendering carrying two
finished treatments side by side: a light-mode half on near-white and a dark-mode half
on charcoal. Both halves hold the same three pieces stacked vertically — the circuit
snake mark, the OUROBOROS wordmark, the "INFINITY IN AUTONOMY" tagline — plus a
"LIGHT MODE"/"DARK MODE" caption above and below that is annotation, not brand.

This script turns that sheet into the six transparent PNGs the product uses:

    docs/brand/icon-{light,dark}.png            head-and-loop square, favicon source
    docs/brand/glyph-{light,dark}.png           the mark alone
    docs/brand/lockup-tagline-{light,dark}.png  mark + wordmark + tagline

Every asset is regenerated from the sheet, so the sheet stays the single source of
truth and no crop is a hand edit nobody can reproduce. Usage rules for the output live
in docs/BRAND.md; `scripts/verify-brand.sh` asserts the committed files match what this
script promises.

Usage:
    scripts/split-brand-sheet.py                     # write docs/brand/*.png
    scripts/split-brand-sheet.py --check             # verify the committed files
    scripts/split-brand-sheet.py --proof DIR         # also write on-ground proof sheets
    scripts/split-brand-sheet.py --source S --out D  # non-default paths

Exit status:
    0  assets written (or, with --check, the committed assets match)
    1  the source sheet is not the expected rendering, a self-check failed, or --check
       found a difference
    2  Pillow is not installed

Requires Pillow (`pip install Pillow`, or `uv run --with Pillow`). It is the one piece
of repo tooling that is not dependency-free POSIX shell, because it is a generator run
by hand when the brand changes rather than a check run in CI.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ModuleNotFoundError:  # pragma: no cover - exercised by hand, not by the suite
    sys.stderr.write(
        "split-brand-sheet: Pillow is required — `pip install Pillow` or "
        "`uv run --with Pillow scripts/split-brand-sheet.py`\n"
    )
    raise SystemExit(2) from None

# A crop rectangle, (left, top, right, bottom), in the coordinates of whatever it is
# being cut from. Every box in this script is one of these.
Box = tuple[int, int, int, int]

# --------------------------------------------------------------------------------------
# The sheet
#
# Coordinates below are pixels in logo-unsplit.png and are only meaningful for that
# exact rendering, so SHEET_SIZE is asserted before anything is measured. A re-rendered
# sheet means re-deriving this block, which is why the numbers sit together at the top.
# --------------------------------------------------------------------------------------

SHEET_SIZE = (1376, 768)

# The halves. Column 687 is the seam — the one column that mixes both grounds — so each
# half stops short of it. The four outermost pixels of the sheet carry a compression
# fringe a shade off the ground, which would survive matte removal as a faint frame;
# SCAN_INSET keeps it out of every measurement, and no crop reaches that far anyway.
LIGHT_HALF = (0, 0, 686, 768)
DARK_HALF = (689, 0, 1376, 768)
SCAN_INSET = 6

# Horizontal bands, in half-local y. The sheet stacks: caption, mark, wordmark, tagline,
# caption. MARK_BOTTOM is the trough between the mark's glow and the wordmark's — on the
# dark half the two overlap and never reach zero, and 447 is where the overlap is
# faintest (peak alpha 14/255, invisible against any ground). LOCKUP_BOTTOM sits in the
# empty run between the tagline and the bottom caption.
BAND_TOP = 95
MARK_BOTTOM = 447
LOCKUP_BOTTOM = 620

# The icon crop: the right-hand loop with the snake's head, in half-local coordinates.
# A square, because every icon consumer wants one, and this loop rather than the whole
# mark because the full infinity is a 2:1 ribbon that turns to mush below 32 px. The
# same box serves both halves: the two treatments are registered to within 3 px. Unlike
# the other two crops this one bleeds — the body runs on past the frame, as it does in
# any icon cut from a larger mark.
ICON_BOX = (340, 145, 640, 445)

# Rows at the foot of the mark band whose alpha is ramped to zero. On the dark half the
# mark's glow and the wordmark's overlap, so the band ends on ~6% coverage rather than
# on nothing and the crop would close with a straight cut. The mark's own glow is spent
# several rows above the trough, so the ramp costs the artwork nothing and buys the
# glyph a border that is provably empty.
FEATHER_ROWS = 8

# Breathing room added around the measured crops, in sheet pixels. Small on purpose: it
# exists so the outermost ink is not the outermost pixel — which keeps resampling from
# shaving the faintest glow and leaves a transparent border to assert on — not to supply
# clear space, which is a layout rule (docs/BRAND.md) rather than part of the file.
CROP_PAD = 3

# --------------------------------------------------------------------------------------
# Matte removal
# --------------------------------------------------------------------------------------

# Ground estimate: the median of a border ring this wide, per channel, per half.
# Measured rather than hard-coded so a re-exported sheet with a slightly different
# ground still lands on true transparency.
RING_WIDTH = 24

# Alpha at or below this is the ground's own noise — the halves vary by up to 5/255 from
# their median. Everything under the floor is cleared and what remains is rescaled, so
# the background is exactly transparent instead of almost transparent. Real glow starts
# an order of magnitude above it.
ALPHA_FLOOR = 6

# Output dimensions. The sheet is a raster: the icon is enlarged 1.7x from its 300 px
# crop to give issue #15 the 512 px master a PWA manifest needs, and the other two are
# within a hair of their native crop. An SVG retrace is the v2 answer if these ever need
# to go bigger.
ICON_SIZE = 512
GLYPH_WIDTH = 512
LOCKUP_WIDTH = 640

# Grounds the assets are proofed against: the committed dark ground and the light ground
# the tokens (#16) will be built on.
DARK_GROUND = (18, 24, 29)
LIGHT_GROUND = (245, 248, 250)


def estimate_ground(image: Image.Image) -> tuple[int, int, int]:
    """Return the flat background colour of a half, as a median RGB triple.

    Samples the border ring — RING_WIDTH pixels in from each edge, inside SCAN_INSET —
    which on both halves is ground and nothing else. The median ignores the handful of
    stray pixels a caption or a compression artefact could contribute.

    Args:
        image: One half of the sheet, RGB.

    Returns:
        The per-channel median of the ring, as an (r, g, b) tuple of 0-255 ints.
    """
    width, height = image.size
    inner = (
        SCAN_INSET + RING_WIDTH,
        SCAN_INSET + RING_WIDTH,
        width - SCAN_INSET - RING_WIDTH,
        height - SCAN_INSET - RING_WIDTH,
    )
    samples: list[tuple[int, int, int]] = []
    pixels = image.load()
    for y in range(SCAN_INSET, height - SCAN_INSET):
        in_vertical_band = inner[1] <= y < inner[3]
        for x in range(SCAN_INSET, width - SCAN_INSET):
            if in_vertical_band and inner[0] <= x < inner[2]:
                continue
            samples.append(pixels[x, y])
    return tuple(
        sorted(channel[i] for channel in samples)[len(samples) // 2] for i in range(3)
    )


def unmatte(
    image: Image.Image, ground: tuple[int, int, int], on_dark: bool
) -> Image.Image:
    """Lift artwork off a flat background into straight (unpremultiplied) RGBA.

    Every pixel of the sheet is `ground` with some amount of artwork composited over it:
    ``p = a * c + (1 - a) * ground``. That is three equations in four unknowns, so it
    needs one assumption, and the artwork supplies the usual one — the strongest channel
    of the paint is saturated. On the dark half the paint is light, so the assumption is
    "some channel reaches 255"; on the light half the paint is dark, so it is "some
    channel reaches 0". Either way the channel that has travelled furthest from the
    ground gives the coverage:

        on dark:   a = max over channels of (p - ground) / (255 - ground)
        on light:  a = max over channels of (ground - p) / ground

    and the colour comes back by undoing the composite: ``c = ground + (p - ground)/a``.

    Coverage under ALPHA_FLOOR is the ground's own noise and is cleared; what is left is
    rescaled so the faintest surviving glow still starts from zero rather than from a
    step. The result composites back over `ground` as the original pixel, and over any
    other surface as the artwork alone — which is the whole point, and what the mockups'
    `mix-blend-mode: screen` crops could only fake on dark.

    Args:
        image: One half of the sheet, RGB.
        ground: The background colour to remove, from estimate_ground().
        on_dark: True when the artwork is lighter than its ground (the dark half),
            False when it is darker (the light half).

    Returns:
        A new RGBA image, same size, with the ground fully transparent.
    """
    width, height = image.size
    source = image.load()
    result = Image.new("RGBA", (width, height))
    target = result.load()

    # Denominators are fixed per half, so compute them once rather than per pixel.
    span = [(255 - ground[i]) if on_dark else ground[i] for i in range(3)]
    floor = ALPHA_FLOOR / 255.0

    for y in range(height):
        for x in range(width):
            pixel = source[x, y]
            alpha = 0.0
            for i in range(3):
                delta = (pixel[i] - ground[i]) if on_dark else (ground[i] - pixel[i])
                if delta > 0 and span[i] > 0:
                    coverage = delta / span[i]
                    if coverage > alpha:
                        alpha = coverage
            if alpha <= floor:
                continue  # already (0, 0, 0, 0)
            if alpha > 1.0:
                alpha = 1.0
            colour = []
            for i in range(3):
                value = ground[i] + (pixel[i] - ground[i]) / alpha
                colour.append(
                    0 if value < 0 else 255 if value > 255 else int(round(value))
                )
            # Rescale the surviving range [floor, 1] back onto [0, 1].
            scaled = (alpha - floor) / (1.0 - floor)
            target[x, y] = (colour[0], colour[1], colour[2], int(round(scaled * 255)))

    return result


def ink_bbox(layer: Image.Image, top: int, bottom: int) -> Box:
    """Return the bounding box of everything visible in a horizontal band.

    Args:
        layer: An unmatted RGBA half.
        top: First row of the band, half-local.
        bottom: One past the last row of the band, half-local.

    Returns:
        The (left, top, right, bottom) box of non-transparent pixels, in half-local
        coordinates, with the band's own offset already added back.

    Raises:
        ValueError: The band is empty, which means the band constants no longer match
            the sheet.
    """
    width = layer.width
    band = layer.crop((SCAN_INSET, top, width - SCAN_INSET, bottom)).getchannel("A")
    box = band.getbbox()
    if box is None:
        raise ValueError(f"no artwork between y={top} and y={bottom}")
    return (box[0] + SCAN_INSET, box[1] + top, box[2] + SCAN_INSET, box[3] + top)


def union(first: Box, second: Box) -> Box:
    """Return the smallest box containing both boxes.

    The two halves are cropped to one shared box per asset so the light and dark files
    have identical dimensions and swap with no layout shift.

    Args:
        first: An (left, top, right, bottom) box.
        second: Another box.

    Returns:
        The union box.
    """
    return (
        min(first[0], second[0]),
        min(first[1], second[1]),
        max(first[2], second[2]),
        max(first[3], second[3]),
    )


def pad(box: Box, limits: Box) -> Box:
    """Grow a box by CROP_PAD on every side without leaving its band.

    Args:
        box: The measured (left, top, right, bottom) ink box.
        limits: The box it may not grow past — the half's scannable area on the sides,
            the band's own top and bottom.

    Returns:
        The padded box.
    """
    return (
        max(limits[0], box[0] - CROP_PAD),
        max(limits[1], box[1] - CROP_PAD),
        min(limits[2], box[2] + CROP_PAD),
        min(limits[3], box[3] + CROP_PAD),
    )


def fit_width(box: Box, width: int) -> tuple[int, int]:
    """Return the output size that scales a crop box to a target width.

    Args:
        box: The crop box the asset is cut from.
        width: The intended output width in pixels.

    Returns:
        An (width, height) pair with the box's aspect ratio preserved, height rounded to
        the nearest pixel and never zero.
    """
    box_width = box[2] - box[0]
    box_height = box[3] - box[1]
    return (width, max(1, int(round(width * box_height / box_width))))


def fade_bottom(image: Image.Image, rows: int) -> Image.Image:
    """Ramp the alpha of an image's last rows linearly to zero.

    Args:
        image: An RGBA crop.
        rows: How many rows to ramp. Values below 1, or taller than the image, are
            ignored and the image is returned untouched.

    Returns:
        A new RGBA image with the ramp applied.
    """
    if rows < 1 or rows >= image.height:
        return image
    faded = image.copy()
    alpha = faded.getchannel("A")
    pixels = alpha.load()
    first = image.height - rows
    for row in range(first, image.height):
        # Row `first` keeps (rows-1)/rows of its coverage; the last row keeps none.
        scale = (image.height - 1 - row) / rows
        for column in range(image.width):
            pixels[column, row] = int(pixels[column, row] * scale)
    faded.putalpha(alpha)
    return faded


def render(
    layer: Image.Image,
    box: Box,
    size: tuple[int, int],
    feather: int = 0,
) -> Image.Image:
    """Cut one asset out of an unmatted half and scale it to its output size.

    Args:
        layer: An unmatted RGBA half.
        box: The crop box, half-local.
        size: The (width, height) to resample to.
        feather: Rows at the foot of the crop to ramp to zero, before scaling.

    Returns:
        The finished RGBA asset.
    """
    crop = fade_bottom(layer.crop(box), feather)
    if crop.size == size:
        return crop
    return crop.resize(size, Image.LANCZOS)


def border_peak(image: Image.Image) -> int:
    """Return the highest alpha found on an image's one-pixel border.

    Args:
        image: Any RGBA image.

    Returns:
        The maximum alpha, 0-255, over the four edge strips.
    """
    alpha = image.getchannel("A")
    width, height = image.size
    strips = (
        alpha.crop((0, 0, width, 1)),
        alpha.crop((0, height - 1, width, height)),
        alpha.crop((0, 0, 1, height)),
        alpha.crop((width - 1, 0, width, height)),
    )
    return max(strip.getextrema()[1] for strip in strips)


def ring_peak(layer: Image.Image) -> int:
    """Return the highest alpha left in the background ring of an unmatted half.

    This is the anti-halo assertion. If any of the ground survived matte removal it
    survives everywhere the ground is, so the ring the ground colour was measured from
    is where to catch it — and catching it there catches it for every crop, including
    the ones whose own edges are artwork.

    Args:
        layer: An unmatted RGBA half.

    Returns:
        The maximum alpha, 0-255, over the ring.
    """
    width, height = layer.size
    outer = layer.crop(
        (SCAN_INSET, SCAN_INSET, width - SCAN_INSET, height - SCAN_INSET)
    )
    ring = Image.new("RGBA", outer.size)
    ring.paste(outer)
    ring.paste(
        (0, 0, 0, 0),
        (RING_WIDTH, RING_WIDTH, outer.width - RING_WIDTH, outer.height - RING_WIDTH),
    )
    return ring.getchannel("A").getextrema()[1]


def build(source: Path) -> dict[str, Image.Image]:
    """Produce every brand asset from the sheet.

    Args:
        source: Path to logo-unsplit.png.

    Returns:
        A dict of file stem ("icon-dark", "glyph-light", ...) to finished RGBA image.

    Raises:
        ValueError: The sheet is not the expected rendering, a band is empty, or an
            asset came out with a dirty edge.
    """
    sheet = Image.open(source).convert("RGB")
    if sheet.size != SHEET_SIZE:
        raise ValueError(
            f"{source} is {sheet.size[0]}x{sheet.size[1]}, expected "
            f"{SHEET_SIZE[0]}x{SHEET_SIZE[1]} — the crop coordinates are specific to "
            "that rendering and have to be re-derived for another"
        )

    layers = {}
    for theme, half, on_dark in (
        ("light", LIGHT_HALF, False),
        ("dark", DARK_HALF, True),
    ):
        half_image = sheet.crop(half)
        layers[theme] = unmatte(half_image, estimate_ground(half_image), on_dark)
        peak = ring_peak(layers[theme])
        if peak != 0:
            raise ValueError(
                f"{theme} half: ground survived matte removal (alpha {peak}/255)"
            )

    # One shared box per asset, so the pair is interchangeable. The icon's is fixed; the
    # other two follow their own ink, which is what keeps the crop tight when the glow
    # differs between the treatments.
    sides = (SCAN_INSET, layers["dark"].width - SCAN_INSET)
    glyph_box = pad(
        union(*(ink_bbox(layer, BAND_TOP, MARK_BOTTOM) for layer in layers.values())),
        (sides[0], BAND_TOP, sides[1], MARK_BOTTOM),
    )
    lockup_box = pad(
        union(*(ink_bbox(layer, BAND_TOP, LOCKUP_BOTTOM) for layer in layers.values())),
        (sides[0], BAND_TOP, sides[1], LOCKUP_BOTTOM),
    )

    # bleeds: whether the crop cuts through artwork on purpose. The two measured crops
    # do not, so their border must come out empty; the icon's does, so it is exempt.
    # feather: rows ramped to zero at the foot of the crop — needed only where a box
    # closes on the mark band's floor, inside the wordmark's glow.
    plan = (
        ("icon", ICON_BOX, (ICON_SIZE, ICON_SIZE), True, 0),
        (
            "glyph",
            glyph_box,
            fit_width(glyph_box, GLYPH_WIDTH),
            False,
            FEATHER_ROWS if glyph_box[3] >= MARK_BOTTOM else 0,
        ),
        ("lockup-tagline", lockup_box, fit_width(lockup_box, LOCKUP_WIDTH), False, 0),
    )

    assets = {}
    for name, box, size, bleeds, feather in plan:
        for theme, layer in layers.items():
            asset = render(layer, box, size, feather)
            if not bleeds and border_peak(asset) != 0:
                raise ValueError(f"{name}-{theme}: crop edge is not transparent")
            assets[f"{name}-{theme}"] = asset
    return assets


def save(asset: Image.Image, path: Path) -> None:
    """Write one asset as an optimised, metadata-free PNG.

    Args:
        asset: The finished RGBA image.
        path: Destination file; its parent is created if missing.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    asset.save(path, format="PNG", optimize=True)


def matches(asset: Image.Image, path: Path) -> bool:
    """Report whether a committed file holds exactly the pixels of a fresh render.

    Compares decoded pixels rather than file bytes: two Pillow releases can encode the
    same image into different PNGs, and a re-encode is not a drift in the artwork.

    Args:
        asset: The freshly built RGBA image.
        path: The committed file to compare against.

    Returns:
        True when the file exists, decodes, and is pixel-identical.
    """
    if not path.is_file():
        return False
    try:
        with Image.open(path) as committed:
            return committed.convert("RGBA").tobytes() == asset.tobytes()
    except OSError:
        return False


def write_proof(assets: dict[str, Image.Image], directory: Path) -> None:
    """Write each asset composited over both grounds, for eyes-on review.

    The pairs are proofed on the ground they are for and on the one they are not, so a
    review can see both that the intended surface works and that nothing is hiding a
    rectangle on the other.

    Args:
        assets: The finished assets, keyed by file stem.
        directory: Where to write the proof PNGs; created if missing.
    """
    directory.mkdir(parents=True, exist_ok=True)
    margin = 32
    for ground_name, ground in (("dark", DARK_GROUND), ("light", LIGHT_GROUND)):
        columns = [assets[name] for name in sorted(assets)]
        width = sum(a.width for a in columns) + margin * (len(columns) + 1)
        height = max(a.height for a in columns) + margin * 2
        sheet = Image.new("RGBA", (width, height), ground + (255,))
        x = margin
        for asset in columns:
            sheet.alpha_composite(asset, (x, (height - asset.height) // 2))
            x += asset.width + margin
        sheet.convert("RGB").save(directory / f"proof-on-{ground_name}.png")


def main(argv: list[str] | None = None) -> int:
    """Entry point.

    Args:
        argv: Command-line arguments, defaulting to sys.argv[1:].

    Returns:
        The process exit status.
    """
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Cut logo-unsplit.png into the brand asset set."
    )
    parser.add_argument(
        "--source", type=Path, default=root / "logo-unsplit.png", help="the brand sheet"
    )
    parser.add_argument(
        "--out", type=Path, default=root / "docs" / "brand", help="asset directory"
    )
    parser.add_argument(
        "--proof", type=Path, help="also write proof sheets to this directory"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare the committed assets with a fresh render and write nothing",
    )
    args = parser.parse_args(argv)

    try:
        assets = build(args.source)
    except (OSError, ValueError) as error:
        sys.stderr.write(f"split-brand-sheet: {error}\n")
        return 1

    if args.check:
        stale = []
        for name, asset in sorted(assets.items()):
            path = args.out / f"{name}.png"
            if not matches(asset, path):
                stale.append(path)
        for path in stale:
            sys.stderr.write(
                f"split-brand-sheet: {path} is missing or does not match the sheet\n"
            )
        if stale:
            return 1
        print(f"{len(assets)} assets match {args.source.name}")
        return 0

    for name, asset in sorted(assets.items()):
        path = args.out / f"{name}.png"
        save(asset, path)
        shown = path.relative_to(root) if path.is_relative_to(root) else path
        print(f"{shown}  {asset.width}x{asset.height}")

    if args.proof:
        write_proof(assets, args.proof)
        print(f"proof sheets in {args.proof}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
