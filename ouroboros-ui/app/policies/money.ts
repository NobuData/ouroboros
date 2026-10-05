/**
 * Money on the Autonomy policies card, in the integer cents the policy document stores
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * `spend_guard` holds `per_run_cap_cents: 250`, never `2.5`. So the card never multiplies a typed
 * amount by a hundred: `19.99 * 100` is `1998.9999999999998` in floating point, and a spend guard
 * that fires a cent early is a bug nobody finds. A typed amount is read **as text** — digits, an
 * optional point, at most two decimals — and the cents are assembled from its two halves as
 * integers. What is drawn is assembled the same way back, so an amount round-trips exactly.
 *
 * Framework-free and pure.
 */

/** The largest amount the document's `cents` definition admits — what an integer column holds. */
export const MAX_CENTS = 2_147_483_647;

/** An amount as it may be typed: whole dollars, optionally a point and one or two decimals. */
const AMOUNT = /^(\d{1,8})(?:\.(\d{1,2}))?$/;

/** What may be in the field while an amount is still being typed — a prefix of {@link AMOUNT}. */
const AMOUNT_IN_PROGRESS = /^\d{0,8}(?:\.\d{0,2})?$/;

/**
 * Whether a field's text could still become an amount — what the input accepts keystroke by
 * keystroke, so a letter or a third decimal never reaches the field at all.
 *
 * @param text The field's text.
 * @returns `true` for an amount or the beginning of one, the empty string included.
 */
export function isAmountInProgress(text: string): boolean {
  return AMOUNT_IN_PROGRESS.test(text);
}

/**
 * The cents a typed amount stands for.
 *
 * @param text The amount as typed — `2.50`, `600`, `19.9`.
 * @returns The cents (`250`, `60000`, `1990`), or `null` when the text is not an amount the
 *   document admits: not a number of this shape, zero, or more than {@link MAX_CENTS}.
 */
export function centsOfAmount(text: string): number | null {
  const match = AMOUNT.exec(text.trim());
  if (match === null) return null;

  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));

  return cents >= 1 && cents <= MAX_CENTS ? cents : null;
}

/**
 * An amount as a field shows it for editing — `2.50`, `600`.
 *
 * @param cents The cents, a positive integer.
 * @returns The dollars, with two decimals unless the amount is a whole number of dollars.
 */
export function amountOfCents(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const remainder = cents % 100;

  return remainder === 0 ? String(dollars) : `${String(dollars)}.${String(remainder).padStart(2, "0")}`;
}

/**
 * An amount as a chip states it — mockup 17's `$2.50` and `$600`.
 *
 * @param cents The cents, a positive integer.
 * @returns The amount with its symbol, grouped in threes, to the cent unless it is whole dollars.
 */
export function chipAmount(cents: number): string {
  const [whole, decimals] = amountOfCents(cents).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return decimals === undefined ? `$${grouped}` : `$${grouped}.${decimals}`;
}
