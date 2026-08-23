/**
 * WCAG contrast, computed over what the browser actually painted
 * ([#650](https://github.com/NobuData/ouroboros/issues/650)).
 *
 * The design system's house rule is *AA in both themes at every font scale* (§ 3.4), and
 * the largest scale is where it is most at risk: at 150% more of the page's tinted small
 * text crosses into the size band where 3:1 is enough, and a token that was borderline at
 * one size is not obviously safe at another. So the readability audit spot-checks the
 * ratio on the rendered page rather than trusting the sheet.
 *
 * ### Why this is not `scripts/lib/contrast.awk`
 *
 * The repository already computes this ratio, in awk, for
 * [`scripts/verify-tokens.sh`](../../../scripts/verify-tokens.sh). That program's subject
 * is `docs/design/tokens.css` — *pairs the token sheet declares*, read out of a file. This
 * one's subject is a **rendered element**: a colour that came out of the cascade, over a
 * background that may be three translucent layers and an ancestor away, at a size the
 * reader's font-scale preference chose. Neither can answer the other's question, and
 * neither can run where the other runs — awk cannot see a computed style, and this suite
 * may not shell out mid-test. The arithmetic below is deliberately the same arithmetic, and
 * that the two agree is checked rather than asserted: `specs/readability.spec.ts` § *the
 * contrast arithmetic agrees with the token sheet* runs four of the pairs
 * `docs/DESIGN_TOKENS.md` publishes through this module and requires the same two
 * decimals the awk program produced.
 *
 * ### The split with the browser
 *
 * The DOM half — which elements carry text, what their computed colours are, what the
 * chain of backgrounds behind them is — happens in the page, because only the page can
 * answer it. Everything after that is arithmetic over numbers, and arithmetic is easier to
 * read, and to be sure of, outside an `evaluate` callback. So the page returns
 * {@link ColourSample}s and this module turns them into ratios.
 */

/** A colour with straight (non-premultiplied) alpha, channels 0–255, alpha 0–1. */
export interface Rgba {
  /** Red, 0–255. */
  readonly r: number;
  /** Green, 0–255. */
  readonly g: number;
  /** Blue, 0–255. */
  readonly b: number;
  /** Alpha, 0–1. */
  readonly a: number;
}

/**
 * One text element, as the page measured it.
 *
 * The backgrounds are a *chain* rather than a colour because that is what the browser
 * paints: an element's own background may be translucent or absent, and what shows through
 * is its parent's, and so on up to the one opaque surface underneath. Resolving that in the
 * page would mean writing the compositing twice.
 */
export interface ColourSample {
  /** What the element is, for a failure message — a selector-ish description. */
  readonly what: string;
  /** The computed `color`, as the browser spells it. */
  readonly colour: string;
  /**
   * The computed `background-color` of the element and each ancestor, nearest first,
   * stopping at the first opaque one. Empty when nothing opaque was found.
   */
  readonly backgrounds: readonly string[];
  /** The computed `font-size`, in CSS pixels. */
  readonly fontSizePx: number;
  /** The computed `font-weight`, as a number. */
  readonly fontWeight: number;
}

/**
 * The point at or above which text is *large* for WCAG 1.4.3, in CSS pixels — 18pt.
 *
 * Compared against the **computed** size, which is the size on the glass: the font-scale
 * preference multiplies the root, so the same rem-sized label is ordinary text at 100% and
 * large text at 150%. That is the criterion's own meaning — it is about how big the glyphs
 * are — and it is how the accessibility tooling this product's rules come from reads it.
 */
export const LARGE_TEXT_PX = 24;

/** The point at or above which **bold** text is large — 14pt. */
export const LARGE_BOLD_TEXT_PX = 18.66;

/** The weight at which the lower large-text threshold applies. */
export const BOLD_WEIGHT = 700;

/** AA for ordinary text. */
export const AA_NORMAL = 4.5;

/** AA for large text. */
export const AA_LARGE = 3;

/**
 * The ratio AA asks of one sample.
 *
 * @param sample - The measured element.
 * @returns {@link AA_LARGE} for large text, {@link AA_NORMAL} otherwise.
 */
export function requiredRatio(sample: ColourSample): number {
  const large =
    sample.fontSizePx >= LARGE_TEXT_PX ||
    (sample.fontWeight >= BOLD_WEIGHT && sample.fontSizePx >= LARGE_BOLD_TEXT_PX);

  return large ? AA_LARGE : AA_NORMAL;
}

/** How a channel is written: `255`, `100%`, or a fraction for alpha. */
const NUMBER = String.raw`[-+]?(?:\d*\.\d+|\d+)%?`;

/** `rgb()` / `rgba()` with either separator, which is how Chromium reports every colour. */
const RGB_FUNCTION = new RegExp(
  String.raw`^rgba?\(\s*(${NUMBER})[\s,/]+(${NUMBER})[\s,/]+(${NUMBER})` +
    String.raw`(?:[\s,/]+(${NUMBER}))?\s*\)$`,
  "i",
);

/**
 * Read one channel, accepting both spellings.
 *
 * @param text - The channel as written.
 * @param full - What 100% means — `255` for a colour channel, `1` for alpha.
 * @returns The channel's value in the caller's units.
 */
function channel(text: string, full: number): number {
  return text.endsWith("%") ? (Number.parseFloat(text) / 100) * full : Number.parseFloat(text);
}

/**
 * Parse a computed colour.
 *
 * Only the spellings a computed style can actually hold: `getComputedStyle` serialises
 * every colour as `rgb()` or `rgba()`, and reports an absent background as the keyword
 * `transparent` in some engines and as `rgba(0, 0, 0, 0)` in others. Author syntax — hex,
 * `hsl()`, named colours — never reaches here, so accepting it would be untested code.
 *
 * @param css - The computed value.
 * @returns The colour, or `null` when it is a spelling this suite has never seen — a
 *   wide-gamut `color()` from a future token sheet, say. A caller treats `null` as *this
 *   sample cannot be judged* rather than as a failure, because guessing black would invent
 *   a ratio.
 */
export function parseColour(css: string): Rgba | null {
  const text = css.trim();

  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const match = RGB_FUNCTION.exec(text);
  if (match === null) return null;

  return {
    r: channel(match[1] ?? "0", 255),
    g: channel(match[2] ?? "0", 255),
    b: channel(match[3] ?? "0", 255),
    a: match[4] === undefined ? 1 : channel(match[4], 1),
  };
}

/**
 * Paint `top` over `bottom` — the *source over* compositing a browser does.
 *
 * @param top - The translucent colour in front.
 * @param bottom - What is behind it. Assumed opaque; a caller composites from the back
 *   forward so that it always is.
 * @returns The opaque result.
 */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const mix = (front: number, back: number) => front * top.a + back * (1 - top.a);

  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/**
 * WCAG relative luminance: linearise each channel, then weight.
 *
 * @param colour - An opaque colour.
 * @returns Its luminance, 0 for black and 1 for white.
 */
export function luminance(colour: Rgba): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

/**
 * The contrast ratio between two opaque colours.
 *
 * @param one - Either colour; the formula is symmetric.
 * @param other - The other.
 * @returns The ratio, 1 for two identical colours and 21 for black on white.
 */
export function ratio(one: Rgba, other: Rgba): number {
  const a = luminance(one);
  const b = luminance(other);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Flatten a sample's background chain into the one opaque colour behind its text.
 *
 * The chain arrives nearest-first, so it is composited back to front: the last entry is
 * the opaque surface the page stands on, and each earlier one is painted over what is
 * already there.
 *
 * @param backgrounds - The chain, nearest first.
 * @returns The colour behind the text, or `null` when the chain is empty or contains a
 *   spelling {@link parseColour} does not know — either way, a sample that cannot be
 *   judged rather than one that failed.
 */
export function flattenBackground(backgrounds: readonly string[]): Rgba | null {
  const layers: Rgba[] = [];

  for (const background of backgrounds) {
    const colour = parseColour(background);
    if (colour === null) return null;
    layers.push(colour);
  }

  const base = layers.at(-1);
  if (base === undefined || base.a < 1) return null;

  let result = base;
  for (let index = layers.length - 2; index >= 0; index -= 1) {
    // Non-null: the index came from the array's own length.
    result = composite(layers[index], result);
  }

  return result;
}

/** What {@link measure} concluded about one sample. */
export interface Measurement {
  /** The sample it is about. */
  readonly sample: ColourSample;
  /** The ratio, or `null` when the sample could not be judged. */
  readonly ratio: number | null;
  /** What AA asks of it. */
  readonly required: number;
}

/**
 * Turn one sample into a ratio.
 *
 * @param sample - The measured element.
 * @returns The measurement. `ratio` is `null` when a colour in the sample could not be
 *   parsed or nothing opaque was found behind the text — the honest answer for an element
 *   painted over an image or a gradient, which is not a pair of colours at all.
 */
export function measure(sample: ColourSample): Measurement {
  const required = requiredRatio(sample);
  const foreground = parseColour(sample.colour);
  const background = flattenBackground(sample.backgrounds);

  if (foreground === null || background === null) {
    return { sample, ratio: null, required };
  }

  // Translucent ink is painted over its own resolved background, exactly as the browser
  // does it — the `--ink-mut` family is opaque, but a disabled or dimmed surface need not
  // be, and treating alpha as 1 would flatter it.
  const ink = foreground.a < 1 ? composite(foreground, background) : foreground;

  return { sample, ratio: ratio(ink, background), required };
}

/**
 * Describe a failing measurement in one line.
 *
 * @param measurement - A measurement whose ratio is below what AA asks.
 * @returns The line, naming the element, both colours, the size band and both numbers —
 *   everything needed to fix it without re-running the suite.
 */
export function describe(measurement: Measurement): string {
  const { sample, ratio: value, required } = measurement;
  const got = value === null ? "unmeasurable" : value.toFixed(2);
  const background = sample.backgrounds[sample.backgrounds.length - 1] ?? "none";

  return (
    `${sample.what}: ${got}:1 against a required ${required.toFixed(1)}:1 — ` +
    `${sample.colour} on ${background}, ${sample.fontSizePx}px/${sample.fontWeight}`
  );
}
