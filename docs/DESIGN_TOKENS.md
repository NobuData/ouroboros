# Ouroboros — design tokens

Two palettes, one sheet. What every token means, what the light half was derived from,
and the measured contrast that says both halves are legible.

Filed as issue [#16](https://github.com/NobuData/ouroboros/issues/16). The sheet is
[`design/tokens.css`](design/tokens.css); the brand assets its light palette is sampled
from are [`BRAND.md`](BRAND.md); the rule that no CSS in this repository carries a literal
colour is [`CONVENTIONS.md`](CONVENTIONS.md#6-code-style).

## Where this goes

The sheet is the product's colour vocabulary, and it lands before the application that
consumes it, because deriving a palette and proving it legible is not application work.

| Issue | What it does with the sheet |
|---|---|
| [#40](https://github.com/NobuData/ouroboros/issues/40) | Copies `tokens.css` into `ouroboros-ui/app/`, imports it from `globals.css`, and maps the `next/font` variables onto `--f-disp`, `--f-ui` and `--f-mono` |
| [#17](https://github.com/NobuData/ouroboros/issues/17) | Stamps `data-theme` before first paint, persists the choice, and tracks the OS while the choice is *system* |
| [#46](https://github.com/NobuData/ouroboros/issues/46) | Builds the primitives — every colour a `var(--token)`, every surface checked in both themes |

#40 has landed, so the sheet has two consumers: the application, at
[`../ouroboros-ui/app/tokens.css`](../ouroboros-ui/app/tokens.css), and
[`design/tokens-preview.html`](design/tokens-preview.html), which stays the page that
proves the sheet is *sufficient* — it renders the whole design system with no colour
literal in its own stylesheet, which the application's placeholder page cannot yet claim
to exercise. The application's copy is held byte-identical to this one by
`scripts/verify-tokens.sh`; edit the palette here, not there.

The mockups in [`mockups/`](mockups) keep their own frozen dark-only stylesheet
and are not retrofitted: they are the design source of truth for page anatomy, not for
colour.

## Where the two palettes came from

**Dark is extracted, not designed.** It is the committed identity from
[`mockups/assets/ouroboros.css`](mockups/assets/ouroboros.css) — the ground `#12181d`, the
card `#171f26`, the ink `#e9f2f6`, the electric cyan `#3dd6f5`, the semantic green, amber
and red, and the violet the model chips use. Seventeen of those literals are carried over
byte for byte, and `scripts/verify-tokens.sh` compares them against the mockup sheet on
every run so the identity cannot drift while nobody is looking.

**Light is derived.** It did not exist — the mockups declare `color-scheme: dark` and stop.
The starting points are the brand sheet's light half as measured in
[`BRAND.md`](BRAND.md#colours-sampled-from-the-sheet): the near-white ground `#f5fafb`, the
deep navy wordmark `#022b57`, the mark's mid-tone `#32b1e5`. From there every value is
chosen against the contrast tables below rather than by eye, which is what moves the ink
towards `#16232b` and deepens the accent.

The accent is the interesting one. `#3dd6f5` on white is 1.7:1 — invisible. A cyan that
carries text on a white card has to be deepened until it clears 4.5:1, which lands at
`#07708e`: 5.65:1 on the card, 5.30:1 on the page, and still unmistakably the brand's
cyan rather than a navy. It is the same hue family as the light-half mark, one step
further down.

## Structure

Three blocks, in this order, and nothing else in the file:

```css
:root                            /* the light palette + type, spacing, shape */
:root[data-theme="dark"]         /* the dark palette — an explicit choice */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"])  /* the same dark palette, for the unset case */
}
```

Three properties of that arrangement are load-bearing:

1. **Light is the base.** Every token is defined once on `:root`; the dark blocks
   redefine only colour. Type, spacing and shape are theme-independent and appear
   exactly once, so a scale can never disagree with itself across themes.
2. **An explicit choice beats the OS.** `:not([data-theme="light"])` is what lets a user
   who has asked for light keep light on a machine set to dark. Without it the media
   query would win whenever it matched.
3. **The two dark blocks are identical.** CSS cannot share a declaration block across a
   media boundary, so the dark palette is written twice — and asserted identical, because
   a palette that differs between "the user asked for dark" and "the OS is dark" is a bug
   that only appears when someone toggles.

`color-scheme` is declared alongside the palette in all three blocks, which is what makes
native scrollbars, form controls and the browser's own canvas follow the theme.

### The contract for #17

The theme engine has one job here: put `data-theme="light"`, `data-theme="dark"` or
nothing at all on `<html>`. Nothing is *system* — the media query then decides. No other
attribute or class participates, and no component reads the theme; a component reads
tokens and gets whichever palette is in force.

## The palette

Thirty-seven colour tokens, in the order the sheet defines them.

### Surfaces

The plane a thing sits on, from the deepest ground outward.

| Token | Light | Dark | What it is |
|---|---|---|---|
| `--ground-deep` | `#e6edf1` | `#0d1216` | Behind the page: gutters, backdrops, the sticky header's ground |
| `--ground` | `#f5f8fa` | `#12181d` | The page |
| `--surface` | `#ffffff` | `#171f26` | Cards, menus, the raised plane |
| `--raised` | `#e9f1f5` | `#1e2831` | Chips, default buttons, hover on a card |
| `--inset` | `#eff4f7` | `#0f1519` | Wells: inputs, code blocks, canvases |
| `--scrim` | `rgba(245, 248, 250, 0.88)` | `rgba(13, 18, 22, 0.88)` | Sticky chrome over content scrolling beneath it |

In dark, `--inset` recedes below the page and `--raised` lifts above it. In light both move
*away from white*, so `--surface` is the brightest plane and the page is a shade below it —
which is why a light card reads as lifted while a dark one reads as inlaid.

### Lines

| Token | Light | Dark | What it is |
|---|---|---|---|
| `--line` | `#d4dee5` | `#253039` | Separators: table rows, card edges, dividers |
| `--line-strong` | `#bccad3` | `#32404c` | The hairline on a chip, tag or keycap |
| `--line-control` | `#788894` | `#62727e` | The boundary of an interactive control — inputs, buttons, the switch track |

Only `--line-control` is held to a contrast minimum. WCAG 1.4.11 asks 3:1 of the visual
boundary a user needs in order to *find* a control, and exempts decoration; a rule between
two table rows is decoration, the edge of a text input is not. `--line-control` is the
token that answers 1.4.11, and it is the one a form field, a button or a switch takes.

### Ink

| Token | Light | Dark | What it is |
|---|---|---|---|
| `--ink` | `#16232b` | `#e9f2f6` | Body text, headings, values |
| `--ink-dim` | `#33454f` | `#b9c8d2` | Secondary text, field labels, code body |
| `--ink-mut` | `#4e626d` | `#8b9da9` | Muted prose, an idle navigation item |
| `--ink-faint` | `#5c6f7a` | `#7e9099` | Hints, placeholders, table heads, stat labels |

All four clear 4.5:1 on every surface they are used on, in both palettes. There is no
fifth, fainter step: the mockups' `--faint` was one, and it does not pass — see
[Departures](#departures-from-the-mockup-sheet).

### Accent

| Token | Light | Dark | What it is |
|---|---|---|---|
| `--accent` | `#07708e` | `#3dd6f5` | Links, the active state, the primary fill, the focus ring |
| `--accent-lift` | `#097693` | `#46dcf8` | The primary fill's light stop, and hover |
| `--accent-deep` | `#055872` | `#1793c4` | The fill's deep stop, meter fills, the switch's on-track |
| `--accent-ink` | `#f4fbfd` | `#06222c` | Text and icons on an accent fill |
| `--accent-panel` | `#06506a` | `#0f4a63` | A deep accent panel that stays deep in both themes: the avatar, a banner |
| `--accent-panel-ink` | `#eaf7fd` | `#dff7fe` | Text on that panel, and the switch's knob |
| `--accent-line` | `rgba(7, 112, 142, 0.35)` | `rgba(61, 214, 245, 0.35)` | The border of an accent-filled chip |
| `--accent-tint` | `rgba(7, 112, 142, 0.10)` | `rgba(61, 214, 245, 0.12)` | The fill of an accent chip, and the focus halo |
| `--accent-wash` | `rgba(7, 112, 142, 0.05)` | `rgba(61, 214, 245, 0.04)` | Row hover |
| `--accent-select` | `rgba(7, 112, 142, 0.18)` | `rgba(61, 214, 245, 0.25)` | `::selection` |
| `--accent-glow` | `rgba(7, 112, 142, 0.28)` | `rgba(61, 214, 245, 0.45)` | The glow, reserved for live things: running loops, the primary action, the active nav item |

`--accent-ink` inverts between the palettes because the fill does: a bright cyan button
takes near-black text, a deep cyan button takes near-white. `--accent-panel` exists for the
one case that does *not* invert — a panel that is deep cyan in both themes, whose ink is
therefore always the near-white `--accent-panel-ink`. In light the two gradient stops sit
close together on purpose: a cyan light enough to look electric cannot carry legible text,
so the light fill trades the ramp for legibility.

The translucent tokens are alpha over *whatever is beneath them*, which is why the tables
below name a surface for each one.

### Status

Each hue three ways: text-capable ink, a 35% border, a 10–12% fill.

| Token | Light | Dark | What it is |
|---|---|---|---|
| `--ok` | `#0b7048` | `#3edc97` | Success, healthy, merged |
| `--ok-line` | `rgba(11, 112, 72, 0.35)` | `rgba(62, 220, 151, 0.35)` | The border of an ok pill |
| `--ok-tint` | `rgba(11, 112, 72, 0.10)` | `rgba(62, 220, 151, 0.12)` | The fill of an ok pill |
| `--warn` | `#7a4c00` | `#f5b83d` | Needs attention, degraded, at budget |
| `--warn-line` | `rgba(122, 76, 0, 0.35)` | `rgba(245, 184, 61, 0.35)` | The border of a warn pill |
| `--warn-tint` | `rgba(122, 76, 0, 0.10)` | `rgba(245, 184, 61, 0.12)` | The fill of a warn pill, and the nav badge |
| `--err` | `#b52121` | `#ff6b6b` | Failed, blocked, destructive |
| `--err-line` | `rgba(181, 33, 33, 0.35)` | `rgba(255, 107, 107, 0.35)` | The border of an err pill |
| `--err-tint` | `rgba(181, 33, 33, 0.10)` | `rgba(255, 107, 107, 0.12)` | The fill of an err pill |
| `--model` | `#5b34c4` | `#a78bfa` | The LLM / model-routing hue |
| `--model-line` | `rgba(91, 52, 196, 0.35)` | `rgba(167, 139, 250, 0.35)` | The border of a model chip |
| `--model-tint` | `rgba(91, 52, 196, 0.10)` | `rgba(167, 139, 250, 0.12)` | The fill of a model chip |

The light hues are much darker than their dark counterparts and that is the point: a
bright green readable on charcoal is 1.9:1 on white. Hue is what carries the meaning
across the two palettes, not lightness — and never hue alone, which is why status
surfaces pair the colour with a word or a glyph.

### Texture

| Token | Light | Dark | What it is |
|---|---|---|---|
| `--grid-dot` | `rgba(78, 98, 109, 0.05)` | `rgba(139, 157, 169, 0.055)` | The page's dot grid |

## Type

Families first. `next/font` supplies the real faces and redefines these three tokens
without touching a component — the application self-hosts each face under its own
variable and `ouroboros-ui/app/globals.css` maps it onto the token, keeping the stack
below intact so a face that fails to load falls back to the families named here.

| Token | Value | Dark override | What it is |
|---|---|---|---|
| `--f-disp` | `"Chakra Petch", "Trebuchet MS", sans-serif` | — | Display: headings, wordmark, numbers, effort chips |
| `--f-ui` | `"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif` | — | UI: body copy, labels, controls |
| `--f-mono` | `"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace` | — | Data: identifiers, code, timings, uppercase labels |

Sizes are **rem, never px**, so the five-step font-size preference in
[`DESIGN_SYSTEM_APP_SHELL.md`](DESIGN_SYSTEM_APP_SHELL.md#4-font-size-preference-readability-on-high-resolution-monitors)
scales every surface from one change to the root element. The px column is what each step
resolves to at the browser default of 16px — a reading aid, not a value to use.

| Token | Value | Dark override | What it is |
|---|---|---|---|
| `--t-2xs` | `0.6875rem` | — | 11px — eyebrows, table heads, tags, keycaps |
| `--t-xs` | `0.75rem` | — | 12px — pills, hints, small print |
| `--t-sm` | `0.8125rem` | — | 13px — buttons, navigation, table body |
| `--t-md` | `0.875rem` | — | 14px — body, inputs |
| `--t-lg` | `0.9375rem` | — | 15px — section headings |
| `--t-xl` | `1.125rem` | — | 18px — card headings |
| `--t-2xl` | `1.625rem` | — | 26px — page title |
| `--t-3xl` | `1.875rem` | — | 30px — stat values |

The mockups reach for half-pixel sizes — 10.5, 11.5, 12.5, 13.5 — that a rem scale has no
business preserving. Each collapses onto the nearest step above.

| Token | Value | Dark override | What it is |
|---|---|---|---|
| `--lh-tight` | `1.1` | — | Display numbers |
| `--lh-snug` | `1.35` | — | Headings |
| `--lh-body` | `1.5` | — | Body copy |
| `--lh-loose` | `1.65` | — | Code blocks |
| `--tr-tight` | `0.01em` | — | Display headings |
| `--tr-wide` | `0.05em` | — | Card titles, effort chips |
| `--tr-wider` | `0.14em` | — | The wordmark, uppercase labels |
| `--tr-widest` | `0.18em` | — | Eyebrows |

## Spacing

One scale, in rem so it scales with the type. 2px granularity where the design is dense
and coarser above it; a layout snaps to a step rather than inventing a value.

| Token | Value | Dark override | What it is |
|---|---|---|---|
| `--sp-1` | `0.125rem` | — | 2px |
| `--sp-2` | `0.25rem` | — | 4px |
| `--sp-3` | `0.375rem` | — | 6px |
| `--sp-4` | `0.5rem` | — | 8px |
| `--sp-5` | `0.625rem` | — | 10px |
| `--sp-6` | `0.75rem` | — | 12px |
| `--sp-7` | `0.875rem` | — | 14px |
| `--sp-8` | `1rem` | — | 16px |
| `--sp-9` | `1.25rem` | — | 20px |
| `--sp-10` | `1.5rem` | — | 24px |
| `--sp-11` | `2rem` | — | 32px |
| `--sp-12` | `4rem` | — | 64px |

## Shape

| Token | Value | Dark override | What it is |
|---|---|---|---|
| `--r-xs` | `0.25rem` | — | 4px — focus rings, meters, tight chips |
| `--r-sm` | `0.375rem` | — | 6px — small buttons, tags |
| `--r-md` | `0.625rem` | — | 10px — buttons, inputs, nav items |
| `--r-lg` | `0.875rem` | — | 14px — cards |
| `--r-pill` | `999px` | — | Fully rounded ends |
| `--r-round` | `50%` | — | Circles: dots, avatars |

Radii are rem for the same reason type is: at 150% font scale a 4px corner on a 1.5×
button looks like a mistake. The last two are ratios, not lengths, and do not scale.

## Contrast

Every ratio below is **computed from `tokens.css`, not asserted by hand**.
[`scripts/verify-tokens.sh`](../scripts/verify-tokens.sh) re-derives each one with
[`scripts/lib/contrast.awk`](../scripts/lib/contrast.awk) on every run and fails if a
published number has drifted from the sheet or has fallen below its minimum — so this
table cannot go stale, and a palette edit that breaks legibility breaks the build.

The maths is WCAG 2.x: sRGB channels linearised, weighted into a relative luminance, and
compared as `(lighter + 0.05) / (darker + 0.05)`. A translucent colour is composited over
the surface named in the *On* column first, because alpha has no contrast of its own.

### Text — minimum 4.5:1

AA for body text at any size. Nothing in this product is large-scale text by WCAG's
definition (18.66px bold / 24px regular), so the 3:1 large-text allowance is never used.

| Ink | On | Where | Minimum | Light | Dark |
|---|---|---|---|---|---|
| `--ink` | `--ground` | body text on the page | 4.5:1 | 15.04 | 15.75 |
| `--ink` | `--ground-deep` | body text on the deep ground | 4.5:1 | 13.55 | 16.59 |
| `--ink` | `--surface` | body text on a card | 4.5:1 | 16.04 | 14.67 |
| `--ink` | `--inset` | input value, code in a well | 4.5:1 | 14.47 | 16.20 |
| `--ink` | `--raised` | button label | 4.5:1 | 14.03 | 13.18 |
| `--ink` | `--scrim` over `--ground` | title in the sticky header | 4.5:1 | 15.04 | 16.49 |
| `--ink-dim` | `--ground` | secondary text on the page | 4.5:1 | 9.35 | 10.44 |
| `--ink-dim` | `--surface` | field labels, code body | 4.5:1 | 9.98 | 9.72 |
| `--ink-dim` | `--raised` | pill text | 4.5:1 | 8.72 | 8.73 |
| `--ink-mut` | `--ground` | muted prose, idle nav item | 4.5:1 | 5.98 | 6.38 |
| `--ink-mut` | `--surface` | muted prose on a card | 4.5:1 | 6.38 | 5.95 |
| `--ink-mut` | `--raised` | tag and keycap text | 4.5:1 | 5.58 | 5.34 |
| `--ink-faint` | `--ground` | hints and placeholders | 4.5:1 | 4.91 | 5.40 |
| `--ink-faint` | `--surface` | table heads, stat labels | 4.5:1 | 5.24 | 5.03 |
| `--ink-faint` | `--raised` | faint text on a chip | 4.5:1 | 4.58 | 4.52 |
| `--accent` | `--ground` | links and eyebrows on the page | 4.5:1 | 5.30 | 10.34 |
| `--accent` | `--surface` | card links | 4.5:1 | 5.65 | 9.63 |
| `--accent` | `--accent-tint` over `--surface` | live pill, active nav item | 4.5:1 | 4.90 | 7.45 |
| `--accent-ink` | `--accent` | label on the primary fill | 4.5:1 | 5.40 | 9.53 |
| `--accent-ink` | `--accent-lift` | label on the fill's light stop | 4.5:1 | 4.99 | 10.10 |
| `--accent-ink` | `--accent-deep` | label on the fill's deep stop | 4.5:1 | 7.58 | 4.72 |
| `--accent-panel-ink` | `--accent-panel` | initials on the avatar panel | 4.5:1 | 8.13 | 8.66 |
| `--ok` | `--surface` | positive delta, ok pill | 4.5:1 | 6.13 | 9.43 |
| `--ok` | `--ok-tint` over `--surface` | ok pill on a card | 4.5:1 | 5.30 | 7.34 |
| `--warn` | `--surface` | warning text | 4.5:1 | 7.34 | 9.37 |
| `--warn` | `--warn-tint` over `--surface` | warning pill, nav badge | 4.5:1 | 6.30 | 7.33 |
| `--err` | `--surface` | error text, negative delta | 4.5:1 | 6.55 | 6.00 |
| `--err` | `--err-tint` over `--surface` | error pill | 4.5:1 | 5.55 | 5.10 |
| `--model` | `--surface` | model chip text | 4.5:1 | 7.68 | 6.12 |
| `--model` | `--model-tint` over `--surface` | model chip on a card | 4.5:1 | 6.54 | 5.06 |

### Non-text — minimum 3:1

WCAG 1.4.11: the parts of the chrome a user has to see in order to operate the interface.

| Colour | On | Where | Minimum | Light | Dark |
|---|---|---|---|---|---|
| `--accent` | `--surface` | active indicator, status dot | 3.0:1 | 5.65 | 9.63 |
| `--accent` | `--inset` | focus ring on a well | 3.0:1 | 5.10 | 10.63 |
| `--accent` | `--raised` | accent icon on a chip | 3.0:1 | 4.94 | 8.65 |
| `--accent-deep` | `--surface` | meter fill, switch on-track | 3.0:1 | 7.94 | 4.77 |
| `--accent-panel-ink` | `--accent-deep` | switch knob on its on-track | 3.0:1 | 7.27 | 3.14 |
| `--line-control` | `--surface` | control boundary on a card | 3.0:1 | 3.65 | 3.35 |
| `--line-control` | `--ground` | control boundary on the page | 3.0:1 | 3.43 | 3.60 |
| `--line-control` | `--inset` | input boundary | 3.0:1 | 3.30 | 3.70 |
| `--ok` | `--raised` | meter fill, ok | 3.0:1 | 5.36 | 8.47 |
| `--warn` | `--raised` | meter fill, warn | 3.0:1 | 6.42 | 8.41 |
| `--err` | `--raised` | meter fill, err | 3.0:1 | 5.73 | 5.39 |

### Decorative — no minimum

Measured and published so a change is visible in a diff, but deliberately held to no
threshold: WCAG exempts purely decorative surfaces, and these carry no information a user
has to perceive. Every one of them sits *behind* or *beside* something that does, and that
something is in one of the two tables above.

| Colour | On | Where | Minimum | Light | Dark |
|---|---|---|---|---|---|
| `--line` | `--surface` | hairline between table rows | — | 1.37 | 1.24 |
| `--line-strong` | `--raised` | chip and button hairline | — | 1.47 | 1.41 |
| `--accent-line` | `--surface` | border of an accent-filled chip | — | 1.70 | 2.33 |
| `--accent-tint` | `--surface` | fill of an accent chip | — | 1.15 | 1.29 |
| `--accent-wash` | `--surface` | row hover | — | 1.07 | 1.08 |
| `--accent-select` | `--surface` | `::selection` behind body text | — | 1.30 | 1.80 |
| `--accent-glow` | `--ground` | the glow on live things | — | 1.50 | 3.06 |
| `--ok-line` | `--surface` | border of an ok pill | — | 1.72 | 2.30 |
| `--warn-line` | `--surface` | border of a warn pill | — | 1.78 | 2.28 |
| `--err-line` | `--surface` | border of an err pill | — | 1.86 | 1.79 |
| `--model-line` | `--surface` | border of a model chip | — | 1.84 | 1.88 |
| `--grid-dot` | `--ground` | the page's dot grid | — | 1.07 | 1.08 |

Between the three tables every colour token is measured at least once, and
`verify-tokens.sh` fails if one is added to the sheet without being measured here.

## Departures from the mockup sheet

Three, all forced by the contrast tables, all in the dark palette:

1. **`--faint` → `--ink-faint`, lightened** from `#5c6b76` to `#7e9099`. The mockups use
   `--faint` for table heads, placeholders, hints and stat labels — all of them text, none
   of them large — and at `#5c6b76` it reaches 3.1:1 on a card. There is no reading of AA
   that permits it, so the step moved up until it cleared 4.5:1 on every surface it lands
   on. It is the one visible change to the committed dark identity.
2. **`--line-control` added.** The mockups draw input and switch boundaries with
   `--border-strong` (`#32404c`), which is 1.4:1 on a well — a control whose edge a
   low-vision user cannot find. Rather than lighten the token that also draws chip
   hairlines and dividers, the boundary that has to answer 1.4.11 became its own token,
   and the decorative ones kept their weight.
3. **Status tints unified** at 12% in dark and 10% in light. The mockups mix 6%, 8% and
   10% per component; one alpha per palette is a scale, several are an accident.

Everything else the mockups declare is carried over unchanged, renamed only where the new
name is clearer about the job: `--bg0/--bg1` became `--ground-deep/--ground`,
`--border/--border-strong` became `--line/--line-strong`, `--mut` became `--ink-mut`,
`--glow-soft/--glow` became `--accent-tint/--accent-glow`.

## The preview page

[`design/tokens-preview.html`](design/tokens-preview.html) renders the shell, cards, a
table, buttons, pills, fields, a switch, meters, a code block and every swatch — a page
whose own stylesheet contains **no colour literal at all**, only `var(--token)`. That is
the acceptance criterion for #16 made visible: if the sheet were missing a colour the
product needs, the preview could not be written without one.

Open it directly (`file://`) and use the **Theme** button to cycle *system → light → dark*.
The button is the preview's own three-state toggle, not the product's theme engine — #17
adds first-paint stamping and persistence.

| Render | Pixels | Palette |
|---|---|---|
| [`design/preview-light.png`](design/preview-light.png) | 1440×1660 | `data-theme="light"` |
| [`design/preview-dark.png`](design/preview-dark.png) | 1440×1660 | `data-theme="dark"` |

Both are screenshots of that page at one viewport, rebuilt by
[`scripts/render-token-preview.sh`](../scripts/render-token-preview.sh). They exist so a
palette change can be reviewed as a picture in a pull request rather than as forty hex
values, and they are committed for the same reason the brand proofs are looked at before a
merge: contrast on a real surface is a judgement no script makes.

The preview loads no webfont, so both renders fall back to the system faces in each
family's stack. Judge colour from them, not letterforms.

## Verifying and regenerating

```bash
scripts/verify-tokens.sh                        # sheet ↔ this document ↔ preview
scripts/render-token-preview.sh                 # rewrite both PNGs (needs Chrome)
awk -f scripts/lib/contrast.awk -v fg='#16232b' -v bg='#f5f8fa'   # one ratio, by hand
awk -f scripts/lib/tokens.awk -v block=dark docs/design/tokens.css # one palette, as TSV
```

`verify-tokens.sh` is dependency-free POSIX shell like the repo's other checks and runs in
well under a second. It asserts, in order: the sheet parses to exactly three palette
blocks with nothing outside them; the two dark blocks are identical; every colour token is
defined in both palettes and every theme-independent token in neither dark block; every
carried-over token the two sheets share still holds the same literal as
`mockups/assets/ouroboros.css` — the seventeen colours and the three families; the preview
links the sheet and contains no colour literal; both renders are PNGs of the same size;
the application's copy of the sheet is byte-identical to it and imported by its global
stylesheet; every token in the sheet is documented here with the value the sheet gives it,
and every token this document names exists; and every contrast row's published ratio is
the ratio recomputed from the sheet, at or above its published minimum.

The complement to that copy check runs in `ci/ui` rather than here: `ouroboros-ui`'s own
suite asserts that no stylesheet in the module except its copy of the sheet writes a
colour down. The two together are what "every colour is a `var(--token)`" means in
practice — one guards the copy against forking, the other guards the module against
going around it.

`render-token-preview.sh` drives headless Chrome and is the one piece of this tooling that
is not dependency-free — like the brand generator, it runs by hand when the palette
changes rather than on every pull request. `--check` re-renders into a temporary directory
and compares, which is how you find out that a palette edit has not been photographed yet.

## Related issues

- [#16](https://github.com/NobuData/ouroboros/issues/16) — this sheet
- [#14](https://github.com/NobuData/ouroboros/issues/14) — the brand assets the light palette is sampled from
- [#17](https://github.com/NobuData/ouroboros/issues/17) — the runtime theme engine that stamps `data-theme`
- [#40](https://github.com/NobuData/ouroboros/issues/40) — global styles: the sheet's first real consumer
- [#46](https://github.com/NobuData/ouroboros/issues/46) — the primitives built on it
