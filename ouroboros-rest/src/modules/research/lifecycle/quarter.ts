/**
 * Calendar quarters — the window behind `23 this quarter` and the History view's quarter facet
 * (CM.6, [#625](https://github.com/NobuData/ouroboros/issues/625)).
 *
 * **A quarter is three calendar months in UTC**, half-open: `[from, to)`. The count on the
 * investigations card is a query over this window computed from the clock at request time, so
 * it resets when the quarter turns and is never a stored number.
 */

/** One calendar quarter. */
export interface Quarter {
  /** `2026-Q4`. */
  readonly key: string;
  /** The first instant of the quarter, inclusive. */
  readonly from: Date;
  /** The first instant of the next quarter, exclusive. */
  readonly to: Date;
}

/** What a `quarter` query value may be: `current`, or a year and quarter like `2026-Q4`. */
export const QUARTER_PATTERN = /^(?:current|(\d{4})-Q([1-4]))$/;

/** The value that names the quarter the clock is in. */
export const CURRENT_QUARTER = "current";

/**
 * The quarter of a year.
 *
 * @param year - The calendar year.
 * @param index - 1 to 4.
 * @returns The quarter.
 */
function quarter(year: number, index: number): Quarter {
  return {
    key: `${year.toString().padStart(4, "0")}-Q${index.toString()}`,
    from: new Date(Date.UTC(year, (index - 1) * 3, 1)),
    to: new Date(Date.UTC(year, index * 3, 1)),
  };
}

/**
 * The quarter an instant falls in.
 *
 * @param now - The instant.
 * @returns Its quarter, in UTC.
 */
export function quarterOf(now: Date): Quarter {
  return quarter(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) + 1);
}

/**
 * Read a `quarter` query value.
 *
 * @param value - `current` or `2026-Q4`.
 * @param now - The clock, for `current`.
 * @returns The quarter, or undefined when the value is neither form.
 */
export function parseQuarter(value: string, now: Date): Quarter | undefined {
  const match = QUARTER_PATTERN.exec(value);
  if (match === null) return undefined;
  if (match[1] === undefined || match[2] === undefined) return quarterOf(now);

  return quarter(Number(match[1]), Number(match[2]));
}
