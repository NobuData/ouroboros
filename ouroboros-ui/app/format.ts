/**
 * Formatting numbers for a reader — compact counts, durations and money.
 *
 * **Framework-free and pure.** Nothing here imports React or `next/*`, so every rule below
 * is a function with an input and an output and its acceptance criteria are unit tests
 * rather than assertions about rendered text.
 *
 * ### Why these are written out rather than delegated to `Intl`
 *
 * `Intl.NumberFormat`'s compact notation would produce most of this in one line, and it is
 * the wrong tool here for two reasons. Its output depends on the ICU data the runtime was
 * built with — a small-icu Node and a browser disagree about `4.2M` versus `4,2 M`, which
 * would make a server render and its hydration differ on the same figure — and it rounds
 * `999,950` to `1M` with no way to ask for the `1.0M` the design draws. What the product
 * shows is a design decision, so it is written down here and covered by
 * `__tests__/format.test.ts` rather than inherited from a locale database.
 *
 * These are English-only, deliberately: the product is (`docs/CONVENTIONS.md`), and a
 * formatter that pretended otherwise would be an untested claim. The day it is not, this
 * module is the one place that changes.
 */

/**
 * A magnitude a compact number can be scaled to, largest first.
 *
 * Lower-case `k` and upper-case `M`/`B`/`T`, which is the convention the mockups draw
 * (`docs/mockups/02-dashboard.html` shows `4.2M`) and the one the issue's own boundary is
 * written in — *999k → 1.0M*.
 */
const UNITS: readonly (readonly [at: number, suffix: string])[] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

/** Below this, a count is drawn in full — `999`, not `1.0k`. */
const COMPACT_FROM = 1e3;

/**
 * Round to one decimal place.
 *
 * @param value The number.
 * @returns It, to one decimal — the precision every compacted figure is drawn at.
 */
function toTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A count short enough to sit under a caption — `4.2M`, `999.9k`, `27`.
 *
 * **One decimal place once it is compacted, always**, so a stat row does not shuffle
 * between `4.2M` and `4M` as a figure moves. Below {@link COMPACT_FROM} there is nothing to
 * compact and the whole number is drawn.
 *
 * **Rounding is allowed to promote a number to the next unit.** `999,950` is `1000.0k` to
 * one decimal, which is the specific wrong answer this function exists to avoid: it is
 * drawn `1.0M`. The same carry applies at every boundary, so `999,999,950` is `1.0B`.
 *
 * @param value The count. Fractions are rounded to a whole first — every figure this draws
 *   is a count of something — and a negative one keeps its sign.
 * @returns The count, at most four characters of digits plus a unit.
 */
export function compactNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const size = Math.round(Math.abs(value));

  for (const [index, [at, suffix]] of UNITS.entries()) {
    if (size < at) continue;

    const scaled = toTenth(size / at);

    // The carry: rounding took it over its own unit, and there is a larger one to move it
    // to. `index === 0` is the largest unit there is, where `1000.0T` is the honest answer.
    if (scaled >= COMPACT_FROM && index > 0) {
      const [bigger, biggerSuffix] = UNITS[index - 1]!;
      return `${sign}${toTenth(size / bigger).toFixed(1)}${biggerSuffix}`;
    }

    return `${sign}${scaled.toFixed(1)}${suffix}`;
  }

  return `${sign}${size}`;
}

/** Minutes in an hour, so the arithmetic below reads as what it is. */
const MINUTES_PER_HOUR = 60;

/**
 * A span of time in hours and minutes — `9h 40m`, `40m`, `2h`.
 *
 * **A part is dropped when it is zero rather than drawn as one**: fifty-eight minutes is
 * `58m`, not `0h 58m`, and two hours exactly is `2h`, not `2h 0m`. Zero itself is `0m`,
 * because a duration has to be *something* — a caller that means "no estimate" should say
 * that in words rather than pass a zero.
 *
 * There is no day unit. The estimates this draws are a queue's working hours, and `36h` is
 * a more useful sentence for somebody deciding what to run tonight than `1d 12h`.
 *
 * @param minutes How many minutes. Rounded to a whole; a negative is clamped to zero, since
 *   no source of a duration in this product can honestly produce one.
 * @returns The span.
 */
export function durationOfMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const rest = total % MINUTES_PER_HOUR;

  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Cents in a dollar. */
const CENTS_PER_DOLLAR = 100;

/**
 * Group a whole number of dollars in threes — `1234567` → `1,234,567`.
 *
 * @param whole The dollars, non-negative and integral.
 * @returns Them, with a comma every three digits from the right.
 */
function grouped(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * An amount of money, from the cents the contract carries — `$18.60`.
 *
 * **Cents in, two decimals out, always.** The ledger stores cost in cents so that nothing
 * rounds on the way through JSON (`ouroboros-db/migrations/V010__dashboard_usage.sql`
 * keeps four decimal places of one), and the half-cent this rounds off is the only rounding
 * that happens between the database and the page.
 *
 * **The currency is the dollar, as the mockups draw it**, and this is the one place that
 * assumption is written down. The contract carries a bare number with no currency beside
 * it; giving that a name is [#92](https://github.com/NobuData/ouroboros/issues/92)'s, along
 * with the rounding rule a finance-minded reader would want to see stated.
 *
 * @param cents The amount, in cents. May carry a fraction of one.
 * @returns The amount, grouped in threes and always to the cent — `$0.00`, `$18.60`,
 *   `$1,234.56`. A negative amount keeps its sign in front of the symbol.
 */
export function moneyOfCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.round(Math.abs(cents));
  const dollars = Math.floor(whole / CENTS_PER_DOLLAR);
  const remainder = whole % CENTS_PER_DOLLAR;

  return `${sign}$${grouped(dollars)}.${String(remainder).padStart(2, "0")}`;
}
