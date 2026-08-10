# Ouroboros — brand assets

The logo asset set: what each file is, where it belongs, and the rules that keep it
looking like one brand across the product, the docs and the marketing site.

Filed as issue [#14](https://github.com/NobuData/ouroboros/issues/14). The conventions
this document sits inside are [`CONVENTIONS.md`](CONVENTIONS.md); the palette and theme
tokens built on top of these assets are
[#16](https://github.com/NobuData/ouroboros/issues/16).

## Source of truth

[`logo-unsplit.png`](../logo-unsplit.png) at the repository root is the brand sheet — one
1376×768 rendering carrying two finished treatments side by side, a light-mode half on
near-white and a dark-mode half on charcoal. It is the only original. Everything in
[`brand/`](brand) is cut from it by
[`scripts/split-brand-sheet.py`](../scripts/split-brand-sheet.py), so no crop is a hand
edit nobody can reproduce, and a change to the brand means re-rendering the sheet and
re-running the script rather than retouching six files.

## The asset set

Six files, three pieces in a light and a dark treatment. Every one is a straight-alpha
RGBA PNG with a genuinely transparent background — no matte, no white box, no
`mix-blend-mode` trick needed to hide one.

| File | Pixels | Working size | Minimum | For |
|---|---|---|---|---|
| [`brand/icon-light.png`](brand/icon-light.png) · [`icon-dark.png`](brand/icon-dark.png) | 512×512 | 256×256 | 16 px | Favicons and PWA icons ([#15](https://github.com/NobuData/ouroboros/issues/15)), avatars, any square slot |
| [`brand/glyph-light.png`](brand/glyph-light.png) · [`glyph-dark.png`](brand/glyph-dark.png) | 512×296 | 256×148 | 96 px wide | App shell and nav ([#41](https://github.com/NobuData/ouroboros/issues/41)), server surfaces ([#18](https://github.com/NobuData/ouroboros/issues/18)), anywhere the mark stands alone |
| [`brand/lockup-tagline-light.png`](brand/lockup-tagline-light.png) · [`lockup-tagline-dark.png`](brand/lockup-tagline-dark.png) | 640×471 | 320×236 | 200 px wide | Login ([#44](https://github.com/NobuData/ouroboros/issues/44)), doc headers, marketing, slides |

**Working size** is the size the asset is meant to be drawn at; the file is 2× that, so
it stays sharp on a HiDPI display. **Minimum** is where the piece stops reading — under
96 px the glyph's circuit tracery turns to mush, so use the icon instead; under 200 px
the tagline stops being legible, so use the glyph and set the words in type.

The light and dark files of a pair are pixel-identical in size, so swapping one for the
other never moves a layout.

### The pieces

- **Icon** — the right-hand loop with the snake's head, squared. The full infinity is a
  nearly 2:1 ribbon that disappears in a 16 px browser tab; this loop keeps a ring, a
  glow and a silhouette at that size, and the head comes back at 32 px. The artwork
  deliberately bleeds off all four edges, as icons cut from a larger mark do.
- **Glyph** — the circuit snake alone, tight-cropped to its own glow.
- **Lockup with tagline** — mark, `OUROBOROS` wordmark and the tagline *Infinity in
  Autonomy*, stacked as the sheet sets them. There is no lockup without the tagline: if
  a surface has no room for it, that surface wants the glyph.

## Which treatment goes on which surface

The variant follows **the surface it sits on**, not the theme the application is in — a
dark card on a light page still takes the dark treatment.

| Ground | Use | Because |
|---|---|---|
| `#12181d`, `#171f26` and other dark surfaces | `*-dark.png` | The wordmark is near-white and the glow is bright — the light treatment's navy ink disappears into the ground |
| `#f5f8fa` and other light surfaces | `*-light.png` | The wordmark is deep navy and the mark's blue is deepened to hold contrast — the dark treatment washes out on white |
| Photography, video, unknown backgrounds | Neither directly | Place the lockup on a solid brand-coloured panel first, then pick the treatment for that panel |

Both treatments are cleanly transparent on either ground — putting the wrong one down is
a contrast mistake, never a rectangle-of-background mistake.

## Clear space

Keep clear space on all four sides of at least **25% of the asset's rendered height**.
Nothing enters it: no text, no rule, no button, no edge of the page.

```
┌───────────────────────────────┐
│         ↕ 0.25 h              │   h = the height the asset is drawn at
│      ┌───────────────┐        │
│ ←→   │   the asset   │   ←→   │   the file is tight-cropped, so measure
│ .25h │               │  .25h  │   clear space from the file's own edge
│      └───────────────┘        │
│         ↕ 0.25 h              │
└───────────────────────────────┘
```

The glyph and the lockup carry only a 3 px working margin — enough that resampling cannot
shave the faintest glow — and the icon carries none, because its artwork runs off the
frame on purpose. Clear space is a layout rule, not padding baked into the PNG, so a
surface that needs more can simply give more.

## Rules

**Do**

- Scale proportionally, and at or above the minimum in the table.
- Serve a derivative — a resized WebP or AVIF — from these masters. They are lossless
  full-colour PNGs, sized for quality rather than for the wire.
- Put the mark's glow to work for *live* things; the accent's glow is reserved for
  running loops, primary actions and the active nav item.

**Do not**

- Recolour, re-tint, invert or apply a filter. Both treatments already exist; a third is
  a new brand asset, not a CSS property.
- Stretch, squash, rotate, skew, or add an outline, shadow or gradient behind it.
- Rebuild the lockup by placing the glyph next to live type — the spacing is part of the
  artwork.
- Crop or re-cut the sheet by hand. Change
  [`split-brand-sheet.py`](../scripts/split-brand-sheet.py) and regenerate, so the next
  person gets the same result.
- Use `mix-blend-mode: screen` on them. The mockups' older crops
  ([`mockups/assets/`](mockups/assets)) need it because their background was never
  removed; these do not, and blending them changes their colour.

## Transparency

Each half of the sheet is a flat ground with artwork composited over it, so the ground is
removed by solving that composite: the channel that has travelled furthest from the
ground gives the coverage, and undoing the composite gives back the paint. Coverage below
the ground's own noise floor is cleared outright, which is why the background is exactly
transparent rather than almost transparent — a 2% film is invisible on the ground it came
from and a grey box everywhere else.

The generator refuses to write assets that fail its own checks: the ground must be gone
from the background of both halves, and the two measured crops must close on a fully
transparent border. `scripts/verify-brand.sh` re-asserts the structural half of that
against the committed files.

## Colours sampled from the sheet

Measured from the halves, as the starting point for the token work in
[#16](https://github.com/NobuData/ouroboros/issues/16) — the derived palette lives in
[`DESIGN_TOKENS.md`](DESIGN_TOKENS.md), not here.

| Sample | Light half | Dark half |
|---|---|---|
| Ground | `#f5fafb` | `#1f2428` |
| Wordmark ink | `#022b57` | `#d7fefe` |
| Tagline ink | `#042852` | `#d7fbfd` |
| Mark, mid-tone | `#32b1e5` | `#2496c5` |

The committed accent stays `#3dd6f5`, the electric cyan the mockups' design system
already builds on — in the dark palette. On a light surface it measures 1.7:1 and cannot
carry text, so the light palette deepens it to `#07708e`; the reasoning and the measured
ratios are in [`DESIGN_TOKENS.md`](DESIGN_TOKENS.md#where-the-two-palettes-came-from).

## Regenerating and verifying

The generator needs [Pillow](https://python-pillow.org/); it is the one piece of repo
tooling that is not dependency-free POSIX shell, because it runs by hand when the brand
changes rather than on every pull request.

```bash
uv run --with Pillow scripts/split-brand-sheet.py          # rewrite docs/brand/
uv run --with Pillow scripts/split-brand-sheet.py --check  # still match the sheet?
uv run --with Pillow scripts/split-brand-sheet.py --proof DIR   # + both grounds
scripts/verify-brand.sh                                    # assets ↔ this document
```

`--proof` writes the six assets composited over the dark and the light ground side by
side. Look at those before merging a brand change: contrast and halos are a judgement a
script cannot make for you.

A change to the icon pair does not stop here. The favicon set above is scaled from those
two files, so rebuilding the brand means rebuilding it too, in the same pull request —
otherwise the browser tab goes on showing the previous mark and nothing says so:

```bash
uv run --with Pillow scripts/build-favicons.py    # rewrite ouroboros-ui/public/
scripts/verify-favicons.sh                        # files ↔ manifest ↔ documents
```

## The favicon and manifest set

The icon pair is a source as well as an asset: it is what the browser and home-screen
icons in [`../ouroboros-ui/public/`](../ouroboros-ui/public) are scaled from, by
[`scripts/build-favicons.py`](../scripts/build-favicons.py)
([#15](https://github.com/NobuData/ouroboros/issues/15)). Seven derived files, and the
same rule about surfaces decides which treatment each one gets.

| File | Size | From | Ground |
|---|---|---|---|
| `favicon.ico` | 16, 32, 48 | `icon-dark.png` | `#12181d`, opaque |
| `favicon-32-light.png` | 32×32 | `icon-light.png` | transparent |
| `favicon-32-dark.png` | 32×32 | `icon-dark.png` | transparent |
| `apple-touch-icon.png` | 180×180 | `icon-dark.png` | `#12181d`, opaque |
| `icon-192.png` | 192×192 | `icon-dark.png` | `#12181d`, opaque |
| `icon-512.png` | 512×512 | `icon-dark.png` | `#12181d`, opaque |
| `manifest.webmanifest` | — | — | declares `#12181d` |

A browser tab is a surface whose colour the page does not own, so the tab icons stay
transparent and the browser picks between them with `prefers-color-scheme`. A home screen
is an unknown background — the case the table above answers with "place the mark on a
solid brand-coloured panel first" — so every icon a launcher draws is flattened onto the
dark ground and written without an alpha channel, which is what stops a launcher drawing
its own colour through the mark. `favicon.ico` is flattened for a different reason: one
file cannot answer a media query, so the fallback is the one that reads on any chrome
rather than the one that reads on half of it.

Nothing in that set is re-cropped, re-tinted or re-centred; scaling is the only thing
done to the artwork, which is the rule below applied to a generator rather than to a
person. The two treatments frame their mark slightly differently inside the shared
square, so trimming either one to its ink would make the tab jump as the scheme changed.

Sizes, the wiring the Next.js app owes them, and the regeneration commands are in
[`../ouroboros-ui/README.md`](../ouroboros-ui/README.md);
[`scripts/verify-favicons.sh`](../scripts/verify-favicons.sh) asserts the files, the
manifest and both documents still agree.

## Formats still to come

- **SVG** — the sheet is a raster, so the icon is enlarged 1.7× from its native crop to
  give #15 a 512 px master; the glyph and lockup are at (or within 13% of) native size. A
  retrace to vector is the v2 answer if the mark ever needs to go bigger than these
  files.

## Related issues

- [#14](https://github.com/NobuData/ouroboros/issues/14) — this asset set
- [#15](https://github.com/NobuData/ouroboros/issues/15) — favicon and web-app manifest
- [#16](https://github.com/NobuData/ouroboros/issues/16) — design tokens, light and dark
- [#18](https://github.com/NobuData/ouroboros/issues/18) — server-side brand surfaces
- [#41](https://github.com/NobuData/ouroboros/issues/41) — application shell
- [#44](https://github.com/NobuData/ouroboros/issues/44) — login screen
