/**
 * Every decision the card foot's **Monthly cap** field makes, as functions with inputs and
 * outputs (AE.6, [#232](https://github.com/NobuData/ouroboros/issues/232)).
 *
 * The field (`app/providers/cap-field.tsx`) draws and writes; this module decides what a
 * typed value means, what a refusal reads as, and the one sentence that keeps the whole
 * feature honest. **Framework-free and pure**, the way `app/providers/keys.ts` and
 * `app/providers/live.ts` are, so each acceptance criterion that is a judgement — *an empty
 * cap stores null, distinct from a cap of zero* — is a unit test on a small value.
 *
 * ---------------------------------------------------------------------------
 * ### Decision P7: a cap is a warning, and it says so
 *
 * Caps are stored, they meter, and they warn — and nothing stops spend until the invocation
 * gateway exists (AF.2, [#235](https://github.com/NobuData/ouroboros/issues/235)) and
 * enforcement lands (AF.4, [#237](https://github.com/NobuData/ouroboros/issues/237)). A cap
 * field that silently does nothing is a trap for exactly the person who cared enough to set
 * one, so the meter and the field both carry {@link CAP_WARNING_ONLY} until the day it stops
 * being true. **AF.4 removes that constant and every use of it**; it is spelled once, here, so
 * that removal is one deletion and a failed typecheck for anything that still names it.
 *
 * ### Null is not zero
 *
 * The contract is explicit: `monthlyCapCents` is `null` for *no cap* and `0` is a real
 * instruction meaning *spend nothing*. So the parser answers `null` for an empty field and
 * the em-dash, `0` for `$0`, and never confuses the two — and the field draws `null` as an
 * empty box with an em-dash placeholder rather than as `$0`, which would be a cap.
 */

import type { ApiError } from "@/app/api/errors";
import { moneyOfCents } from "@/app/format";

import { capFigure } from "./cards";
import { PROVIDER_GONE } from "./keys";

/* ---------------------------------------------------------------------------- parsing */

/** What one typed value came to. */
export type CapParse =
  /** A cap in whole cents, or `null` for no cap. */
  | { readonly ok: true; readonly cents: number | null }
  /** Why the text is not a cap — a sentence written for the field's error line. */
  | { readonly ok: false; readonly reason: string };

/**
 * The glyph an uncapped connection prints, and what the parser reads as *clear the cap* —
 * the same em-dash `cards.ts`'s `capValue` draws for `null`.
 */
export const NO_CAP = "—";

/**
 * The largest cap the service stores — the contract's `maximum` on
 * `ProviderConnectionPatch.monthlyCapCents`, a signed 32-bit integer of cents.
 *
 * Mirrored here so the field refuses a cap the service would refuse *before* the round trip,
 * with a sentence naming the ceiling, rather than after it with the service's own.
 */
export const CAP_MAX_CENTS = 2_147_483_647;

/** What the field says when the text is not an amount. */
export const CAP_INVALID =
  "Enter a dollar amount — $95, or 1250.50 — or clear the field for no cap.";

/** What the field says when the amount is more than the service can store. */
export const CAP_TOO_LARGE = `A cap can be at most ${moneyOfCents(CAP_MAX_CENTS)}.`;

/**
 * What one typed value means, in integer cents.
 *
 * Generous about spelling and strict about meaning: `$95`, `95`, `1,250.50` and `1250.5`
 * are all caps, and spaces, the symbol and the thousands separators are ignored on the way
 * in. Cents are computed in integers rather than by multiplying a float — `1250.5 * 100` is
 * not `125050` on every runtime — so what is stored is what was typed.
 *
 * @param text What the field holds, exactly as typed.
 * @returns `null` cents for an empty field or the em-dash (no cap); the amount in cents for
 *   a dollar figure with up to two decimals; or the reason it is neither. A negative amount,
 *   a third decimal and a word are all {@link CAP_INVALID}; an amount past
 *   {@link CAP_MAX_CENTS} is {@link CAP_TOO_LARGE}.
 */
export function parseCap(text: string): CapParse {
  const trimmed = text.trim();

  // Only nothing, or a dash, clears a cap. A lone `$` is somebody who stopped typing, and
  // reading it as *clear* would remove a cap they never asked to remove.
  if (trimmed === "" || trimmed === NO_CAP || trimmed === "-" || trimmed === "–") {
    return { ok: true, cents: null };
  }

  const bare = trimmed.replace(/[\s$,]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(bare);

  if (match === null) return { ok: false, reason: CAP_INVALID };

  const dollars = Number.parseInt(match[1], 10);
  const cents = dollars * 100 + Number.parseInt((match[2] ?? "").padEnd(2, "0"), 10);

  if (!Number.isSafeInteger(cents) || cents > CAP_MAX_CENTS) {
    return { ok: false, reason: CAP_TOO_LARGE };
  }

  return { ok: true, cents };
}

/**
 * What the editable field holds for a stored cap.
 *
 * `$600` for a cap — the same figure the read-only field and the meter's note print — and
 * **an empty string for none**, so the field's placeholder can show the em-dash while the
 * text a reader edits starts empty; typing into a box that already holds `—` would mean
 * deleting a glyph first.
 *
 * @param cents The stored cap, or `null`.
 * @returns The text.
 */
export function capText(cents: number | null): string {
  return cents === null ? "" : capFigure(cents);
}

/* ----------------------------------------------------------------------------- the copy */

/**
 * The sentence decision P7 owes every cap: the meter's tooltip, and the field's description.
 *
 * **Removed by AF.4 ([#237](https://github.com/NobuData/ouroboros/issues/237))**, when the
 * spend gate makes it false. Until then it is the difference between a feature that warns
 * and a feature that pretends to enforce.
 */
export const CAP_WARNING_ONLY = "Warning only — enforcement arrives with invocation.";

/** What the field says to a role that may not change it. */
export const CAP_READ_ONLY = "Changing the cap is for workspace owners and admins.";

/** The saving state — the field is busy, and says so. */
export const CAP_SAVING = "Saving the cap…";

/** The saved state. */
export const CAP_SAVED = "Cap saved.";

/** What a save says when it did not take, for any reason but the two named. */
export const CAP_FAILED = "The cap could not be saved. Nothing was changed — try again in a moment.";

/* ---------------------------------------------------------------------------- the save */

/** What one save produced. */
export type CapOutcome =
  /** The cap the service now holds — what the meter and the field draw. */
  | { readonly ok: true; readonly cents: number | null }
  /** Why not — a sentence already written for a reader. */
  | { readonly ok: false; readonly reason: string };

/** The service's code for a role that may read the card and not write to it. */
const FORBIDDEN_CODE = "forbidden";

/** The service's code for a connection this workspace no longer has. */
const NOT_FOUND_CODE = "provider_connection_not_found";

/**
 * What a refused save reads as.
 *
 * @param error What the service answered.
 * @returns The read-only sentence for a `403`, the gone sentence for a `404`, and
 *   {@link CAP_FAILED} for anything else — the service's message is never printed here,
 *   because a cap save has no provider-side detail worth quoting.
 */
export function capRefusal(error: Pick<ApiError, "code">): CapOutcome {
  if (error.code === FORBIDDEN_CODE) return { ok: false, reason: CAP_READ_ONLY };
  if (error.code === NOT_FOUND_CODE) return { ok: false, reason: PROVIDER_GONE };

  return { ok: false, reason: CAP_FAILED };
}
