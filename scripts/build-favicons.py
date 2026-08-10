#!/usr/bin/env python3
"""build-favicons.py — derive the favicon and web-app manifest set (issue #15).

`docs/brand/icon-{light,dark}.png` are the 512x512 transparent squares issue #14 cut
from the brand sheet as the favicon source. This script turns that pair into the files a
browser and a home screen actually ask for, in `ouroboros-ui/public/`:

    favicon.ico              16/32/48 in one file, on the dark ground
    favicon-32-light.png     transparent, for light browser chrome
    favicon-32-dark.png      transparent, for dark browser chrome
    apple-touch-icon.png     180x180 on the dark ground
    icon-192.png             192x192 on the dark ground   (manifest)
    icon-512.png             512x512 on the dark ground   (manifest)
    manifest.webmanifest     name, scheme colours, and the two icons above

Two treatments, two jobs. A browser tab is a surface whose colour the page does not own,
so the tab icons are the transparent pair and the browser picks by `prefers-color-scheme`
— the rule docs/BRAND.md sets out, that the variant follows the surface it sits on. A
home screen is an unknown background, which BRAND.md answers by putting the mark on a
brand-coloured panel first: every icon a launcher or an installed app draws is therefore
flattened onto the dark ground, opaque, with the dark treatment that ground calls for.
`favicon.ico` is flattened for the same reason — one file cannot answer a media query, so
the fallback is the one that reads on any chrome rather than the one that reads on half.

Opacity is structural, not documented: the flattened outputs are written as RGB PNGs with
no alpha channel at all, so `scripts/verify-favicons.sh` can assert it from the PNG header
without decoding a pixel.

Nothing here re-crops, re-tints or re-centres the source. The two treatments have
different ink bounding boxes inside their shared square, so trimming to ink would make the
pair jump as the browser switched schemes, and BRAND.md rules out re-cutting in any case.
Scaling is all this script does to the artwork.

Usage:
    scripts/build-favicons.py                        # write ouroboros-ui/public/
    scripts/build-favicons.py --check                # verify the committed files
    scripts/build-favicons.py --brand D --out D      # non-default paths

Exit status:
    0  the set was written (or, with --check, the committed files match)
    1  a source icon is not what this script expects, a self-check failed, or --check
       found a difference
    2  Pillow is not installed

Requires Pillow, like scripts/split-brand-sheet.py and for the same reason: it is a
generator run by hand when the brand changes, not a check run in CI.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path
from typing import NamedTuple

try:
    from PIL import Image
except ModuleNotFoundError:  # pragma: no cover - exercised by hand, not by the suite
    sys.stderr.write(
        "build-favicons: Pillow is required — `pip install Pillow` or "
        "`uv run --with Pillow scripts/build-favicons.py`\n"
    )
    raise SystemExit(2) from None

# --------------------------------------------------------------------------------------
# The source
# --------------------------------------------------------------------------------------

# What issue #14 publishes for icon-{light,dark}.png, asserted before anything is scaled:
# a re-export at another size, or one flattened onto a background, changes what every
# output below means.
SOURCE_SIZE = (512, 512)

# --------------------------------------------------------------------------------------
# The outputs
# --------------------------------------------------------------------------------------

# The dark ground from docs/BRAND.md — the surface the flattened icons are placed on, and
# the manifest's own theme and background colour.
DARK_GROUND = (18, 24, 29)
DARK_GROUND_HEX = "#12181d"

# The light ground, for the record in the manifest's sibling documentation. A manifest
# carries one theme colour; the per-scheme pair is a <meta name="theme-color" media="…">
# matter and belongs to the layout that #39 lands. See ouroboros-ui/README.md.
LIGHT_GROUND_HEX = "#f5f8fa"

# favicon.ico carries the three sizes Windows and the browsers actually pull out of it:
# 16 for the tab, 32 for a HiDPI tab and the address bar, 48 for the desktop shortcut.
ICO_SIZES = (16, 32, 48)

# The theme-aware tab pair. One size, not two: a browser new enough to honour `media` on
# <link rel="icon"> downsamples 32 to 16 cleanly, and favicon.ico already carries a purpose
# built 16 for the ones that do not.
TAB_SIZE = 32

# iOS home screen. Full-bleed by Apple's own guidance — the system applies the rounded
# corner mask, and artwork that stops short of the edge reads as a floating stamp.
APPLE_SIZE = 180

# The two sizes an installable web app is expected to declare.
PWA_SIZES = (192, 512)

MANIFEST_FILE = "manifest.webmanifest"
APP_NAME = "Ouroboros — Infinity in Autonomy"
APP_SHORT_NAME = "Ouroboros"
APP_DESCRIPTION = "Autonomous development loops: issue in, verified pull request out."

# The PNG signature, for telling a PNG-framed ICO entry from a BMP-framed one.
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class Plan(NamedTuple):
    """Everything the generator produces, before any of it is written.

    Attributes:
        pngs: File name to finished image. Flattened outputs are mode RGB (no alpha
            channel); the tab pair is mode RGBA.
        ico_frames: The favicon.ico frames, smallest first, one per ICO_SIZES entry.
        manifest: The full text of manifest.webmanifest, newline-terminated.
    """

    pngs: dict[str, Image.Image]
    ico_frames: list[Image.Image]
    manifest: str


def load_icon(brand: Path, theme: str) -> Image.Image:
    """Open one brand icon and assert it is the source this script was written against.

    Args:
        brand: The directory holding the brand asset set (docs/brand).
        theme: "light" or "dark".

    Returns:
        The icon as RGBA.

    Raises:
        ValueError: The file is not SOURCE_SIZE, or it has no transparency left — both
            of which mean the favicons derived from it would be silently wrong.
    """
    path = brand / f"icon-{theme}.png"
    icon = Image.open(path).convert("RGBA")
    if icon.size != SOURCE_SIZE:
        raise ValueError(
            f"{path} is {icon.size[0]}x{icon.size[1]}, expected "
            f"{SOURCE_SIZE[0]}x{SOURCE_SIZE[1]} — regenerate the brand set first "
            "(scripts/split-brand-sheet.py)"
        )
    if icon.getchannel("A").getextrema()[0] != 0:
        raise ValueError(
            f"{path} has no fully transparent pixel — it looks flattened onto a "
            "background, and the tab icons cut from it would carry that background"
        )
    return icon


def resample(image: Image.Image, size: int) -> Image.Image:
    """Scale a square image to a square of `size` pixels.

    Args:
        image: The image to scale; assumed square.
        size: The output edge length in pixels.

    Returns:
        A new image at size x size, or `image` itself when it is already that size.
    """
    if image.size == (size, size):
        return image
    return image.resize((size, size), Image.LANCZOS)


def flatten(icon: Image.Image, ground: tuple[int, int, int]) -> Image.Image:
    """Composite a transparent icon onto a solid ground.

    Args:
        icon: The RGBA source icon.
        ground: The background colour as an (r, g, b) triple.

    Returns:
        A mode RGB image — no alpha channel, so its opacity is a property of the file
        format rather than of its pixel values.
    """
    panel = Image.new("RGBA", icon.size, ground + (255,))
    return Image.alpha_composite(panel, icon).convert("RGB")


def manifest_document(icons: list[str]) -> str:
    """Render manifest.webmanifest.

    Generated rather than committed by hand so the icon list cannot drift from the files
    this same run writes beside it.

    Args:
        icons: File names of the PWA icons, which are served from the root of the site
            because everything in `public/` is.

    Returns:
        The manifest as newline-terminated JSON text.
    """
    document = {
        "id": "/",
        "name": APP_NAME,
        "short_name": APP_SHORT_NAME,
        "description": APP_DESCRIPTION,
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": DARK_GROUND_HEX,
        "theme_color": DARK_GROUND_HEX,
        "icons": [
            {
                "src": f"/{name}",
                "sizes": f"{size}x{size}",
                "type": "image/png",
                "purpose": "any",
            }
            for name, size in zip(icons, PWA_SIZES)
        ],
    }
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def build(brand: Path) -> Plan:
    """Produce the whole set from the brand icon pair.

    Args:
        brand: The directory holding the brand asset set (docs/brand).

    Returns:
        The finished Plan.

    Raises:
        ValueError: A source icon is not what load_icon expects, or an output failed one
            of the self-checks below.
    """
    icons = {theme: load_icon(brand, theme) for theme in ("light", "dark")}
    panel = flatten(icons["dark"], DARK_GROUND)

    pngs = {
        f"favicon-{TAB_SIZE}-light.png": resample(icons["light"], TAB_SIZE),
        f"favicon-{TAB_SIZE}-dark.png": resample(icons["dark"], TAB_SIZE),
        "apple-touch-icon.png": resample(panel, APPLE_SIZE),
    }
    pwa_icons = [f"icon-{size}.png" for size in PWA_SIZES]
    for name, size in zip(pwa_icons, PWA_SIZES):
        pngs[name] = resample(panel, size)

    # The self-checks. Each one is a way the set could come out plausible and wrong, and
    # the generator refuses to write any of it rather than write that.
    for name, image in pngs.items():
        transparent = name.startswith("favicon-")
        expected = "RGBA" if transparent else "RGB"
        if image.mode != expected:
            raise ValueError(f"{name}: expected mode {expected}, got {image.mode}")
        if transparent and image.getchannel("A").getextrema()[0] != 0:
            raise ValueError(f"{name}: a tab icon with no transparent pixel left")

    return Plan(
        pngs=pngs,
        ico_frames=[resample(panel, size) for size in ICO_SIZES],
        manifest=manifest_document(pwa_icons),
    )


def save_png(image: Image.Image, path: Path) -> None:
    """Write one PNG, optimised and free of metadata.

    Args:
        image: The finished image, in the mode it should be stored in.
        path: Destination file; its parent is created if missing.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def save_ico(frames: list[Image.Image], path: Path) -> None:
    """Write the multi-resolution favicon.ico.

    Pillow drops any requested size larger than the image it is saving, and rescales any
    size it was not handed a frame for. Both are avoided by saving the largest frame and
    offering every frame: each entry in the file is then one of the renders above rather
    than a resample of a resample.

    Args:
        frames: The frames, smallest first, one per ICO_SIZES entry.
        path: Destination file; its parent is created if missing.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    largest = frames[-1]
    largest.save(
        path,
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=frames,
    )


def ico_frames(path: Path) -> dict[int, Image.Image]:
    """Read every frame out of an ICO file.

    Args:
        path: The ICO to read.

    Returns:
        Edge length to decoded RGB frame, empty when the file cannot be read as an ICO.
    """
    try:
        with Image.open(path) as ico:
            sizes = sorted(ico.info.get("sizes", ()))
            return {
                size[0]: ico.ico.getimage(size).convert("RGB")
                for size in sizes
                if size[0] == size[1]
            }
    except (OSError, ValueError, AttributeError):
        return {}


def ico_directory(path: Path) -> list[int]:
    """Read the edge lengths an ICO's own directory advertises.

    The directory is what a browser reads to choose a frame, so it is worth reading
    independently of what Pillow can decode: an entry can advertise a size its image data
    does not hold.

    Args:
        path: The ICO to read.

    Returns:
        The advertised edge lengths in file order, or an empty list when the header is
        not an ICONDIR.
    """
    try:
        data = path.read_bytes()
    except OSError:
        return []
    if len(data) < 6:
        return []
    reserved, kind, count = struct.unpack("<HHH", data[:6])
    if reserved != 0 or kind != 1 or len(data) < 6 + count * 16:
        return []
    # A zero in the width byte means 256, which is the format's way of fitting 256 into a
    # byte. None of ICO_SIZES is 256, but reading it correctly keeps the value honest.
    return [data[6 + index * 16] or 256 for index in range(count)]


def matches_image(image: Image.Image, path: Path) -> bool:
    """Report whether a committed PNG holds exactly the pixels of a fresh render.

    Compares decoded pixels and the mode, not file bytes: two Pillow releases can encode
    one image into different PNGs, and a re-encode is not a change to the artwork. The
    mode is part of the comparison because it is what carries the opacity contract.

    Args:
        image: The freshly built image.
        path: The committed file.

    Returns:
        True when the file exists, decodes, and is identical in mode and pixels.
    """
    if not path.is_file():
        return False
    try:
        with Image.open(path) as committed:
            return (
                committed.mode == image.mode
                and committed.tobytes() == image.tobytes()
            )
    except OSError:
        return False


def matches_ico(frames: list[Image.Image], path: Path) -> bool:
    """Report whether a committed ICO holds exactly the frames of a fresh render.

    Args:
        frames: The freshly built frames, smallest first.
        path: The committed file.

    Returns:
        True when the directory advertises exactly ICO_SIZES and every frame decodes to
        the matching render.
    """
    if sorted(ico_directory(path)) != sorted(ICO_SIZES):
        return False
    committed = ico_frames(path)
    if sorted(committed) != sorted(ICO_SIZES):
        return False
    return all(
        committed[size].tobytes() == frame.tobytes()
        for size, frame in zip(ICO_SIZES, frames)
    )


def matches_text(text: str, path: Path) -> bool:
    """Report whether a committed text file holds exactly this text.

    Args:
        text: The freshly rendered text.
        path: The committed file.

    Returns:
        True when the file exists and its contents are identical.
    """
    try:
        return path.read_text(encoding="utf-8") == text
    except OSError:
        return False


def main(argv: list[str] | None = None) -> int:
    """Entry point.

    Args:
        argv: Command-line arguments, defaulting to sys.argv[1:].

    Returns:
        The process exit status.
    """
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Derive the favicon and web-app manifest set from the brand icons."
    )
    parser.add_argument(
        "--brand",
        type=Path,
        default=root / "docs" / "brand",
        help="directory holding icon-light.png and icon-dark.png",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=root / "ouroboros-ui" / "public",
        help="directory to write the set into",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare the committed files with a fresh render and write nothing",
    )
    args = parser.parse_args(argv)

    try:
        plan = build(args.brand)
    except (OSError, ValueError) as error:
        sys.stderr.write(f"build-favicons: {error}\n")
        return 1

    ico_path = args.out / "favicon.ico"
    manifest_path = args.out / MANIFEST_FILE

    if args.check:
        stale = []
        for name in sorted(plan.pngs):
            path = args.out / name
            if not matches_image(plan.pngs[name], path):
                stale.append(path)
        if not matches_ico(plan.ico_frames, ico_path):
            stale.append(ico_path)
        if not matches_text(plan.manifest, manifest_path):
            stale.append(manifest_path)
        for path in stale:
            sys.stderr.write(
                f"build-favicons: {path} is missing or does not match the brand icons\n"
            )
        if stale:
            return 1
        print(f"{len(plan.pngs) + 2} files match {args.brand}/icon-*.png")
        return 0

    def shown(path: Path) -> Path:
        """Print a path relative to the repository root when it is inside it."""
        return path.relative_to(root) if path.is_relative_to(root) else path

    for name in sorted(plan.pngs):
        image = plan.pngs[name]
        path = args.out / name
        save_png(image, path)
        print(f"{shown(path)}  {image.width}x{image.height} {image.mode}")

    save_ico(plan.ico_frames, ico_path)
    print(f"{shown(ico_path)}  {'/'.join(str(size) for size in ICO_SIZES)}")

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(plan.manifest, encoding="utf-8")
    print(f"{shown(manifest_path)}  {len(plan.manifest)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
