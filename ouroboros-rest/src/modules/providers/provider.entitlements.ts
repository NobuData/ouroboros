/**
 * How an entitlement is spelled inside a validation `detail` — the one place that writes a
 * seat count and the one place that reads one back.
 *
 * AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)), roadmap decision **P8**.
 *
 * ```
 * readSeatCount(body.seat_breakdown.total) ─▶ 4 | null    the API said, or it did not
 * withSeats("200", 4)                      ─▶ "200 · 4 seats"
 * withSeats("200", null)                   ─▶ "200"       no suffix, not "· unknown seats"
 * seatsIn("200 · 4 seats")                 ─▶ 4           what AE.6's cap line reads
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why a module rather than four lines inside the Copilot adapter.**
 *
 * `ProviderCapabilities.entitlements` is, in AC.1's words, *"no member of its own — it is a
 * promise about `detail`"*. So a seat count travels from `validate` to a card as part of a
 * string, and mockup 07's cap line — `$76.00 of $95 cap · 4 seats` — is AE.6's
 * ([#232](https://github.com/NobuData/ouroboros/issues/232)) to render from it.
 *
 * AE.6 cannot import the adapter that wrote it: `.dependency-cruiser.cjs`'s
 * `core-imports-the-spi-only` rule fails the build for exactly that, and rightly — a card that
 * imported `copilot.adapter.ts` to read a number is decision **P1** undone. Without a shared
 * spelling the alternative is a regular expression over prose invented at the reading end,
 * which is the failure `provider.errors.ts` exists to prevent one layer down: *the UI ends up
 * pattern-matching on prose, which works until an adapter author rewords a message.*
 *
 * So the writer and the reader are the same six lines, they sit beside the taxonomy rather
 * than behind the adapter boundary, and `provider.entitlements.spec.ts` round-trips them.
 * `provider.address.ts` was extracted for the same reason at the same seam.
 *
 * ---------------------------------------------------------------------------
 * **`null` and `0` are different answers, and that is decision P8 in one sentence.**
 *
 * `null` is *the API did not tell us* — the token cannot see the org's billing, no
 * organization is configured, the endpoint answered with a shape this does not recognise.
 * `0` is *the API said zero*, which is a real state: an organization that has Copilot billing
 * enabled and has assigned nobody. A reader can act on the second and must not be shown a
 * guess in place of the first, which is why {@link withSeats} appends nothing at all rather
 * than a hedged phrase — *"· seats unknown"* is a sentence a person has to learn to distrust,
 * and one untrustworthy suffix makes every other suffix on the card unreadable too.
 *
 * The floor is therefore `0` rather than `1`, unlike `NormalizedModel.contextLength`'s. The
 * difference is who produced the number: a context length of zero is what an unchecked parse
 * looks like, and a seat count of zero is what an organization looks like.
 */

import { CARD_SEPARATOR } from "./provider.errors";

/**
 * The word after the count, singular and plural.
 *
 * Mockup 07 writes `4 seats`. One seat is a real state — an organization with a single
 * Copilot licence — and `1 seats` on a card is the kind of thing that makes a reader wonder
 * what else was not looked at.
 */
export const SEAT_NOUN = { one: "seat", many: "seats" } as const;

/** The shape {@link seatsIn} reads back — the count, and nothing else on the line. */
const SEAT_PATTERN = new RegExp(`(?:^|${CARD_SEPARATOR})(\\d{1,9}) ${SEAT_NOUN.one}s?$`);

/**
 * A seat count a provider published, or null.
 *
 * The **only** gate through which a number becomes a seat count, so *rendered from real
 * entitlement data or omitted* (decision **P8**) is one function rather than a rule each
 * adapter re-implements. Everything a provider can plausibly answer that is not a count — a
 * missing field, a string, a float, a negative, a `NaN` from a parse nobody checked — is
 * `null`, which renders as no suffix at all.
 *
 * @param value - Whatever was at the field, `unknown` because a provider is not a source of
 *   types.
 * @returns The count when it is a whole number of at least zero, null otherwise. See this
 *   file's header on why zero is a fact and not a failed parse.
 */
export function readSeatCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * A seat count, as the words a card prints.
 *
 * @param seats - The count. Must be a whole number of at least zero — {@link readSeatCount} is
 *   what produces one.
 * @returns `4 seats`, `1 seat`.
 */
export function describeSeats(seats: number): string {
  return `${seats.toString()} ${seats === 1 ? SEAT_NOUN.one : SEAT_NOUN.many}`;
}

/**
 * A validation detail with its entitlement appended, when there is one.
 *
 * @param detail - What the check itself found — `200`. Unchanged when there is no entitlement,
 *   which is what keeps a provider with no seat data reading exactly like the other four
 *   adapters.
 * @param seats - The count, or null for *the API did not say*.
 * @returns The detail, with `· 4 seats` appended for a real count and nothing appended
 *   otherwise.
 */
export function withSeats(detail: string, seats: number | null): string {
  return seats === null ? detail : `${detail}${CARD_SEPARATOR}${describeSeats(seats)}`;
}

/**
 * The seat count inside a validation detail, if it carries one.
 *
 * The reader half — AE.2's ([#228](https://github.com/NobuData/ouroboros/issues/228))
 * capability line and AE.6's ([#232](https://github.com/NobuData/ouroboros/issues/232)) cap
 * line. A consumer calls this instead of writing a regular expression, which is the whole
 * point of the module.
 *
 * @param detail - A `ProviderValidationOk.detail`, from any adapter. A detail written by an
 *   adapter that reports no entitlements simply has none in it, so this is safe to call
 *   unconditionally rather than behind a `capabilities().entitlements` check.
 * @returns The count, or null when the detail carries no entitlement.
 */
export function seatsIn(detail: string): number | null {
  const match = SEAT_PATTERN.exec(detail);

  return match === null ? null : Number.parseInt(match[1], 10);
}
