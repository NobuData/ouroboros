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

/** Seconds in a minute, and minutes in an hour, so the arithmetic below reads as what it is. */
const SECONDS_PER_MINUTE = 60;

/** Seconds in an hour. */
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

/**
 * Two digits, for a part that follows a larger one.
 *
 * @param value The part.
 * @returns It, padded — `05`, not `5`.
 */
function padded(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A duration measured to the second — `12m 40s`, `38m 05s`, `2h 05m 09s`.
 *
 * This is the mockups' *Elapsed* and *Cycle*, and it differs from
 * {@link durationOfMinutes} in the one way that matters: **it is drawn while it is moving.**
 * That is what fixes both of its rules —
 *
 * - **Every part but the leading one is padded to two digits.** `38m 5s` and `38m 05s` are
 *   the same duration and different widths, and a column of them that changed width every
 *   ten seconds would twitch once a second in the reader's peripheral vision. The mockup
 *   draws `38m 05s` for exactly this reason.
 * - **No part is dropped, and there is always a seconds figure.** A run at two hours exactly
 *   reads `2h 00m 00s` rather than `2h`: this is a clock, and a clock that hides the part
 *   that is moving looks stopped. An estimate drops its zero parts because it is not moving,
 *   which is why the two functions are two functions.
 *
 * There is no day unit, for {@link durationOfMinutes}'s reason: a run that has been going
 * `26h 10m 03s` is a more useful sentence to whoever has to decide about it than `1d 2h`.
 *
 * @param seconds How many seconds. Rounded down to a whole one — a duration should not
 *   report a second that has not finished — and a negative one is drawn as zero, which is
 *   what a clock in front of a run's own start time means.
 * @returns The duration.
 */
export function elapsedOfSeconds(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = total % SECONDS_PER_MINUTE;

  return hours === 0
    ? `${minutes}m ${padded(rest)}s`
    : `${hours}h ${padded(minutes)}m ${padded(rest)}s`;
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

/** Milliseconds in a tenth of a second — the precision this column is drawn at. */
const MS_PER_TENTH = 100;

/** Tenths in a second. */
const TENTHS_PER_SECOND = 10;

/** Below this many milliseconds, a duration rounds to `0.0s` and is drawn as a floor instead. */
const SUB_TENTH_MS = 50;

/** What a duration too short to draw at this precision reads as. */
const SUB_TENTH = "<0.1s";

/**
 * A measured duration in milliseconds, drawn in seconds to one decimal — `41.0s`, `0.8s`.
 *
 * This is mockup 06's **p50 latency** column, and it is a third duration formatter rather
 * than a reuse of either of the two above because it answers a third question.
 * {@link durationOfMinutes} sizes a queue in working hours; {@link elapsedOfSeconds} is a
 * clock, padded and never dropping a part because it is drawn while it moves. This is
 * neither: it is a *measurement*, held still, read down a column beside seven others.
 *
 * **One unit for the whole column, always.** A cell that switched to `840ms` below a second
 * would break the property the column is aligned for — figures read down their last digit —
 * and would make two rows of the same table incomparable at a glance. So everything is
 * seconds, and the one case that unit cannot state honestly is stated in words instead:
 * a duration under {@link SUB_TENTH_MS} would round to `0.0s`, which is a claim that a call
 * took no time, so it is drawn `<0.1s`. A measured **zero** keeps `0.0s`, because that is
 * what was measured.
 *
 * A figure nobody measured is not this function's business at all: it is `null` at the
 * contract's boundary and renders as an em-dash (roadmap decision **M7**). Passing a zero
 * here to mean *unknown* is the specific mistake the null exists to prevent.
 *
 * **The rounding happens in whole milliseconds, before the division.** `(3150 / 1000)` is a
 * binary float a hair *below* 3.15, so `toFixed(1)` gives `3.1` — the same class of surprise
 * this module's header refuses `Intl` for. Rounding to tenths as integers first makes the
 * boundary land where a reader expects it, on every runtime.
 *
 * @param ms The duration in milliseconds. Negative is drawn as zero, which is what a
 *   measurement that came back before it started means; a non-finite one is drawn the same.
 * @returns The duration in seconds to one decimal, or {@link SUB_TENTH} for a non-zero
 *   duration too short to draw at that precision.
 */
export function latencyOfMs(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, ms) : 0;

  if (total > 0 && total < SUB_TENTH_MS) return SUB_TENTH;

  const tenths = Math.round(total / MS_PER_TENTH);
  return `${(tenths / TENTHS_PER_SECOND).toFixed(1)}s`;
}
