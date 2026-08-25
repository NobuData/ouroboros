/**
 * Every sentence and every decision of the key management flows
 * ([#229](https://github.com/NobuData/ouroboros/issues/229)) — **Reveal**, **Rotate** (and
 * the empty optional key's **Save**), the address row's save, the overflow menu's delete, and
 * the switch's confirmation — as pure values and functions.
 *
 * `app/providers/cards.ts` decides what a card *is*; this module decides what its controls
 * *say*, in every state each can be in. Framework-free for the reason that file gives, and
 * kept apart from `key-actions.ts` for the reason `card-actions.ts` gives: a `"use server"`
 * module may export nothing but async functions, so the outcome types, the copy and the
 * refusal-to-sentence mappings live here, where a unit test can reach them without a mock.
 *
 * ---------------------------------------------------------------------------
 * ### The rails are stated, not implied (decision **P4**)
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)) built the safety rails —
 * step-up before a reveal, verify-then-retire on a rotation, a foreign key under a delete —
 * and rails a reader cannot see do not build trust. So the copy here says each one out loud:
 *
 * - A revealed value says **when it will be masked again** and **that the reveal was
 *   recorded**; the copy button makes **no claim about the clipboard**, because a page
 *   cannot keep one.
 * - A refused rotation says, in so many words, that **the existing key is still active** —
 *   {@link OLD_KEY_ACTIVE} — rendered as the dialog's failed state and never as a toast,
 *   because the reader's rational response to a bare error is to retry or to re-enter the
 *   old key, and both are worse than doing nothing.
 * - A refused address edit says **the working address is unchanged**
 *   ({@link ADDRESS_KEPT}), for the same reason.
 * - A refused delete **names the routes** the service named, and links to where they are
 *   repointed.
 *
 * ### A wrong password is an absent one
 *
 * The service answers a wrong password exactly as it answers no password — the same
 * `401 step_up_required` — so that a stolen session cannot be turned into a password
 * oracle. {@link STEP_UP_FAILED} therefore says *that did not confirm it* and nothing more
 * specific, which is the honest sentence rather than a vague one.
 */

import type { ApiError } from "@/app/api/errors";
import type { Reading } from "@/app/api/reading";

/* ------------------------------------------------------------------------- the outcomes */

/** How a reveal may step up — the two methods BetterAuth gives this build, and no third. */
export type StepUpMethod = "session" | "password";

/** The service's own spellings, in the order a reader should prefer them. */
export const STEP_UP_METHODS: readonly StepUpMethod[] = ["session", "password"];

/** How long a re-authentication counts for when the service did not say — its own default. */
export const STEP_UP_DEFAULT_WINDOW_SECONDS = 5 * 60;

/** What one reveal produced. */
export type RevealOutcome =
  /** The credential, the connection it belongs to, and the instant to forget it at. */
  | {
      readonly ok: true;
      readonly connectionId: string;
      readonly value: string;
      readonly expiresAt: string;
    }
  /** The challenge: confirm it is you, one of these ways, and ask again. */
  | {
      readonly ok: false;
      readonly kind: "step-up";
      readonly methods: readonly StepUpMethod[];
      readonly maxAgeSeconds: number;
    }
  /** A refusal — a sentence already written for a reader. */
  | { readonly ok: false; readonly kind: "refused"; readonly reason: string };

/** What one rotation (or first save) produced. */
export type RotateOutcome =
  /** Swapped — the connection's mask, recomputed by the service from the new key. */
  | { readonly ok: true; readonly mask: string | null }
  /** Refused — and the old key is still live, which the dialog says beside this reason. */
  | { readonly ok: false; readonly reason: string };

/** What one delete produced. */
export type RemoveOutcome =
  /** Gone. The card leaves with the next read. */
  | { readonly ok: true }
  /** Refused because these aliases still resolve through it — the service's own list. */
  | { readonly ok: false; readonly kind: "in-use"; readonly aliases: readonly string[] }
  /** Refused for some other reason, written for a reader. */
  | { readonly ok: false; readonly kind: "refused"; readonly reason: string };

/** What one address save produced. */
export type AddressOutcome =
  /** Stored, and the provider answered there — the address as the service now holds it. */
  | { readonly ok: true; readonly value: string | null }
  /** Refused — and the working address is unchanged, which the row says beside this reason. */
  | { readonly ok: false; readonly reason: string };

/* -------------------------------------------------------------- reading the envelope */

/** The service's codes this module turns into sentences. */
const CODES = {
  forbidden: "forbidden",
  notFound: "provider_connection_not_found",
  stepUp: "step_up_required",
  rateLimited: "provider_reveal_rate_limited",
  credentialAbsent: "provider_credential_absent",
  validationFailed: "provider_validation_failed",
  configInvalid: "provider_config_invalid",
  changed: "provider_connection_changed",
  inUse: "provider_connection_in_use",
} as const;

/**
 * The strings in a detail that should be a list of them.
 *
 * @param value A `details` field.
 * @returns Its strings, in order; anything that is not a string is dropped rather than
 *   rendered as `[object Object]`, and anything that is not a list is no strings.
 */
export function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
}

/**
 * A detail that should be a whole number.
 *
 * @param value A `details` field.
 * @param fallback What to use when it is not one.
 * @returns The integer, or the fallback.
 */
export function wholeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * A detail that should be a sentence fragment.
 *
 * @param value A `details` field.
 * @returns The string, or null for anything else — including an empty one, which is no
 *   detail rather than a detail that says nothing.
 */
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * The step-up methods a challenge named, in the service's own order.
 *
 * @param value `details.methods`.
 * @returns The methods this module knows how to offer. A spelling it does not know is
 *   dropped rather than drawn as a control with nothing behind it.
 */
export function stepUpMethods(value: unknown): readonly StepUpMethod[] {
  const named = new Set(stringList(value));

  return STEP_UP_METHODS.filter((method) => named.has(method));
}

/* --------------------------------------------------------------------- the reveal */

/** The Reveal button while the service is being asked. */
export const REVEALING = "Revealing…";

/** The revealed row's second action — mask it before the countdown does. */
export const MASK_NOW = "Mask";

/** The revealed row's first action. */
export const COPY = "Copy";

/**
 * What the row says once the copy has landed. Nothing about how long the clipboard keeps
 * it, because the page does not know and cannot make it so.
 */
export const COPIED = "Copied.";

/** What the row says when the clipboard refused — a state, not an alert; the value is right there. */
export const COPY_FAILED = "The clipboard could not be written — select the value and copy it instead.";

/** The audited-notice line, visible for as long as the value is. */
export const REVEAL_RECORDED = "This reveal was recorded in the audit log.";

/**
 * The countdown, as the row prints it beside the value.
 *
 * @param seconds Whole seconds left.
 * @returns `Masks in 41s`.
 */
export function masksIn(seconds: number): string {
  return `Masks in ${seconds}s`;
}

/**
 * When a revealed value expires, as the clock the row watches counts.
 *
 * @param expiresAt The service's `expiresAt`, ISO 8601.
 * @returns Whole seconds since the epoch; an unparseable instant is `0`, which is already
 *   past — a value the page cannot say when to forget is forgotten at once.
 */
export function expiryOf(expiresAt: string): number {
  const instant = Date.parse(expiresAt);

  return Number.isNaN(instant) ? 0 : Math.floor(instant / 1000);
}

/**
 * How long a revealed value has left.
 *
 * @param expiresAt Its expiry, in whole seconds since the epoch.
 * @param now The current second.
 * @returns Whole seconds, never negative.
 */
export function remainingSeconds(expiresAt: number, now: number): number {
  return Math.max(0, expiresAt - now);
}

/** The step-up dialog's title. */
export const STEP_UP_TITLE = "Confirm it's you";

/**
 * The step-up dialog's one sentence about why.
 *
 * @param displayName The card's heading.
 * @param maxAgeSeconds The service's window.
 * @returns *Revealing Anthropic Claude's key needs a sign-in from the last 5 minutes.*
 */
export function stepUpNote(displayName: string, maxAgeSeconds: number): string {
  const minutes = Math.max(1, Math.round(maxAgeSeconds / 60));

  return `Revealing ${displayName}'s key needs a sign-in from the last ${minutes} minute${
    minutes === 1 ? "" : "s"
  }.`;
}

/** The password field. */
export const STEP_UP_PASSWORD = "Your password";

/** The password form's submit. */
export const STEP_UP_CONFIRM = "Confirm and reveal";

/** …while it is being checked. */
export const STEP_UP_CHECKING = "Checking…";

/** The other method: a fresh session. */
export const STEP_UP_SIGN_IN = "Sign out and sign in again";

/** What that costs, said before it is pressed. */
export const STEP_UP_SIGN_IN_NOTE =
  "A fresh sign-in counts as confirmation. You will be signed out and brought back to this page.";

/**
 * What the dialog says after a password did not confirm it. Deliberately no more specific
 * than this — see the header.
 */
export const STEP_UP_FAILED =
  "That did not confirm it. Check the password and try again, or sign in again.";

/** What the dialog says when the challenge named no method this page can offer. */
export const STEP_UP_NO_METHOD =
  "The service asked for a confirmation this page cannot offer. Sign in again and retry.";

/** The empty password field, pressed. */
export const PASSWORD_REQUIRED = "Enter your password first.";

/** A reveal's refusals. */
export const REVEAL_ABSENT = "This connection stores no key to reveal.";
export const REVEAL_READ_ONLY = "Revealing a key is for workspace owners and admins.";
export const REVEAL_FAILED =
  "The key could not be revealed just now. Nothing was changed — try again in a moment.";

/** What every flow says for a connection this workspace no longer has. */
export const PROVIDER_GONE = "This provider has been removed. Reload the page.";

/**
 * The rate limit, with the service's own figure.
 *
 * @param retryAfterSeconds `details.retryAfterSeconds`.
 * @returns *Too many reveal attempts. Try again in 240s.*
 */
export function revealRateLimited(retryAfterSeconds: number): string {
  return `Too many reveal attempts. Try again in ${retryAfterSeconds}s.`;
}

/**
 * Turn the service's refusal of a reveal into what the row does next.
 *
 * @param error What the service answered.
 * @returns The challenge, or the sentence.
 */
export function revealRefusal(error: ApiError): RevealOutcome {
  const { code, details } = error;

  if (code === CODES.stepUp) {
    return {
      ok: false,
      kind: "step-up",
      methods: stepUpMethods(details.methods),
      maxAgeSeconds: wholeNumber(details.maxAgeSeconds, STEP_UP_DEFAULT_WINDOW_SECONDS),
    };
  }

  return { ok: false, kind: "refused", reason: revealReason(error) };
}

/**
 * The sentence for a reveal the service refused outright.
 *
 * @param error What the service answered.
 * @returns The sentence.
 */
function revealReason({ code, details }: ApiError): string {
  if (code === CODES.rateLimited) {
    return revealRateLimited(wholeNumber(details.retryAfterSeconds, 0));
  }
  if (code === CODES.credentialAbsent) return REVEAL_ABSENT;
  if (code === CODES.forbidden) return REVEAL_READ_ONLY;
  if (code === CODES.notFound) return PROVIDER_GONE;

  return REVEAL_FAILED;
}

/* --------------------------------------------------------------------- the rotation */

/** Which of the two jobs the one dialog is doing. */
export type SecretMode = "rotate" | "save";

/**
 * The dialog's title.
 *
 * @param mode Rotate a stored key, or save a first one.
 * @param displayName The card's heading.
 * @returns *Rotate Anthropic Claude's key* / *Save a key for Local vLLM*.
 */
export function secretTitle(mode: SecretMode, displayName: string): string {
  return mode === "rotate" ? `Rotate ${displayName}'s key` : `Save a key for ${displayName}`;
}

/**
 * The dialog's sentence about the rail, said before the field.
 *
 * @param mode Rotate or save.
 * @returns What happens to the existing key while the new one is checked.
 */
export function secretNote(mode: SecretMode): string {
  return mode === "rotate"
    ? "The new key is checked with the provider first. The existing key stays in use until the new one is accepted."
    : "The key is checked with the provider before it is stored.";
}

/**
 * The field's label.
 *
 * @param mode Rotate or save.
 * @returns *New key* / *Key*.
 */
export function secretLabel(mode: SecretMode): string {
  return mode === "rotate" ? "New key" : "Key";
}

/**
 * The submit.
 *
 * @param mode Rotate or save.
 * @returns *Check and swap* / *Check and save*.
 */
export function secretSubmit(mode: SecretMode): string {
  return mode === "rotate" ? "Check and swap" : "Check and save";
}

/** The validating state, as the dialog announces it. */
export const SECRET_VALIDATING = "Checking the new key with the provider…";

/**
 * The succeeded state.
 *
 * @param mode Rotate or save.
 * @param mask The connection's new mask, or null if the service somehow stored nothing.
 * @returns *Swapped. The key now ends in ••••7Kd2.*
 */
export function secretSwapped(mode: SecretMode, mask: string | null): string {
  const verb = mode === "rotate" ? "Swapped" : "Saved";

  return mask === null ? `${verb}.` : `${verb}. The key now ends in ${mask}.`;
}

/**
 * The failed state's standing line — the one sentence this ticket exists for.
 *
 * @param mode Rotate or save.
 * @returns What is still true after a refusal.
 */
export function secretKept(mode: SecretMode): string {
  return mode === "rotate" ? OLD_KEY_ACTIVE : NO_KEY_STORED;
}

/** Stated plainly, not implied. */
export const OLD_KEY_ACTIVE = "Your existing key is still active — nothing was changed.";

/** The save-mode equivalent. */
export const NO_KEY_STORED = "No key was stored — the connection is as it was.";

/** The failed state's way back to the field. */
export const TRY_AGAIN = "Try again";

/** Every dialog's way out without acting. */
export const CANCEL_LABEL = "Cancel";

/** The succeeded state's way out — the write already happened. */
export const DONE_LABEL = "Done";

/** The empty field, submitted. */
export const SECRET_REQUIRED = "Enter the key first.";

/** A rotation's refusals. */
export const ROTATE_CHANGED =
  "This connection changed while the key was being checked. Reload the page and try again.";
export const ROTATE_ABSENT = "This provider takes no key.";
export const ROTATE_READ_ONLY = "Changing a key is for workspace owners and admins.";
export const ROTATE_FAILED = "The key could not be checked just now.";

/**
 * The provider's own refusal, with its short note when it gave one.
 *
 * @param detail `details.detail` — never the credential; the service guarantees that.
 * @returns *The provider refused the new key — key rejected (401).*
 */
export function providerRefused(detail: string | null): string {
  return detail === null
    ? "The provider refused the new key."
    : `The provider refused the new key — ${detail}.`;
}

/**
 * Turn the service's refusal of a rotation into the failed state's reason.
 *
 * @param error What the service answered.
 * @returns The sentence. Whatever it is, the standing line beside it is
 *   {@link secretKept}'s, because nothing was written before the check passed.
 */
export function rotateRefusal({ code, details }: ApiError): RotateOutcome {
  if (code === CODES.validationFailed) {
    return { ok: false, reason: providerRefused(text(details.detail)) };
  }
  if (code === CODES.changed) return { ok: false, reason: ROTATE_CHANGED };
  if (code === CODES.credentialAbsent) return { ok: false, reason: ROTATE_ABSENT };
  if (code === CODES.forbidden) return { ok: false, reason: ROTATE_READ_ONLY };
  if (code === CODES.notFound) return { ok: false, reason: PROVIDER_GONE };

  return { ok: false, reason: ROTATE_FAILED };
}

/* ---------------------------------------------------------------------- the address */

/** The address row's action. */
export const SAVE_ADDRESS = "Save";

/**
 * The action's accessible name, since two cards' Saves would otherwise be one name.
 *
 * @param label The field's label — *Base URL*, *Host*.
 * @returns *Save Base URL*.
 */
export function saveAddressLabel(label: string): string {
  return `Save ${label}`;
}

/** Why the action is inert until the field differs from what is stored. */
export const ADDRESS_UNCHANGED = "Edit the address to save a new one.";

/** The saving state. */
export const ADDRESS_SAVING = "Checking the address with the provider…";

/** The saved state. */
export const ADDRESS_SAVED = "Saved — the provider answered at the new address.";

/** The failed state's standing line. */
export const ADDRESS_KEPT = "The working address is unchanged.";

/** The empty field, submitted. */
export const ADDRESS_REQUIRED = "Enter an address first.";

/** An address save's refusals. */
export const ADDRESS_READ_ONLY = "Editing the address is for workspace owners and admins.";
export const ADDRESS_INVALID = "That address is not usable.";
export const ADDRESS_FAILED = "The address could not be saved just now.";

/**
 * The provider could not be reached at the new address.
 *
 * @param detail `details.detail`, when the adapter gave one.
 * @returns *The provider could not be reached there — connect ECONNREFUSED.*
 */
export function addressUnreachable(detail: string | null): string {
  return detail === null
    ? "The provider could not be reached at that address."
    : `The provider could not be reached at that address — ${detail}.`;
}

/**
 * Turn the service's refusal of an address into the row's reason.
 *
 * @param error What the service answered.
 * @param field The contract's name for the address field, whose messages a schema refusal
 *   is keyed by.
 * @returns The sentence.
 */
export function addressRefusal({ code, details }: ApiError, field: string): AddressOutcome {
  if (code === CODES.configInvalid) {
    const fields = details.fields;
    const messages =
      typeof fields === "object" && fields !== null
        ? stringList((fields as Record<string, unknown>)[field])
        : [];

    return { ok: false, reason: messages.length === 0 ? ADDRESS_INVALID : messages.join(" ") };
  }
  if (code === CODES.validationFailed) {
    return { ok: false, reason: addressUnreachable(text(details.detail)) };
  }
  if (code === CODES.forbidden) return { ok: false, reason: ADDRESS_READ_ONLY };
  if (code === CODES.notFound) return { ok: false, reason: PROVIDER_GONE };

  return { ok: false, reason: ADDRESS_FAILED };
}

/* --------------------------------------------------------------- the menu and delete */

/**
 * The overflow trigger's accessible name.
 *
 * @param displayName The card's heading.
 * @returns *More actions for Anthropic Claude*.
 */
export function menuLabel(displayName: string): string {
  return `More actions for ${displayName}`;
}

/** What the trigger draws — three dots, hidden from the name it already has. */
export const MENU_GLYPH = "⋯";

/** The menu's one item. The ellipsis says a dialog follows. */
export const DELETE_ITEM = "Delete provider…";

/**
 * The confirmation's title.
 *
 * @param displayName The card's heading.
 * @returns *Delete Anthropic Claude?*
 */
export function deleteTitle(displayName: string): string {
  return `Delete ${displayName}?`;
}

/**
 * The confirmation's note — which says what the switch is for, because a reader who wanted
 * to pause a provider and reached for delete should be told the difference first.
 */
export const DELETE_NOTE =
  "Deleting removes the connection and its key. Routes that resolve through it will fail " +
  "until they are repointed. To pause it and keep the key, switch it off instead.";

/** The confirmation's destructive control. */
export const DELETE_CONFIRM = "Delete provider";

/** …while it runs. */
export const DELETING = "Deleting…";

/**
 * The blocked state's title — the service's `409`, as a heading.
 *
 * @param displayName The card's heading.
 * @returns *Anthropic Claude is still in use*
 */
export function inUseTitle(displayName: string): string {
  return `${displayName} is still in use`;
}

/** The blocked state's note. */
export const IN_USE_NOTE =
  "These routes resolve through it. Repoint or remove them in routing first — nothing was deleted.";

/** The list of them, named for a screen reader. */
export const DEPENDENT_ROUTES = "Routes that resolve through this provider";

/** The blocked state's link. */
export const OPEN_ROUTING = "Open routing";

/** Every blocked and failed dialog's way out. */
export const CLOSE = "Close";

/** A delete's refusals. */
export const DELETE_READ_ONLY = "Deleting a provider is for workspace owners and admins.";
export const DELETE_FAILED = "The provider could not be deleted just now. Nothing was changed.";

/**
 * Turn the service's refusal of a delete into the dialog's next state.
 *
 * @param error What the service answered.
 * @returns The blocked state with the service's own alias names, or a sentence.
 */
export function removeRefusal({ code, details }: ApiError): RemoveOutcome {
  if (code === CODES.inUse) {
    return { ok: false, kind: "in-use", aliases: stringList(details.aliases) };
  }
  if (code === CODES.forbidden) return { ok: false, kind: "refused", reason: DELETE_READ_ONLY };
  if (code === CODES.notFound) return { ok: false, kind: "refused", reason: PROVIDER_GONE };

  return { ok: false, kind: "refused", reason: DELETE_FAILED };
}

/* ------------------------------------------------------------------ the switch-off */

/**
 * Whether switching a connection off should ask first.
 *
 * It asks when routes resolve through the connection — switching off has the same effect on
 * a running loop that deleting has — and it asks when it *could not find out*, because a
 * read that failed is not a workspace with no routes.
 *
 * @param dependents The card's dependents, as read.
 * @returns Whether to confirm before the press takes.
 */
export function needsConfirmation(dependents: Reading<readonly string[]>): boolean {
  return !dependents.ok || dependents.value.length > 0;
}

/**
 * The confirmation's title.
 *
 * @param displayName The card's heading.
 * @returns *Switch off Anthropic Claude?*
 */
export function switchOffTitle(displayName: string): string {
  return `Switch off ${displayName}?`;
}

/** The confirmation's note when the routes are known. */
export const SWITCH_OFF_NOTE =
  "Routing skips a switched-off provider. These routes resolve through it and will fail " +
  "until it is switched on again or they are repointed:";

/**
 * The confirmation's note when they are not.
 *
 * @param reason Why the aliases could not be read.
 * @returns The note, with the reason.
 */
export function switchOffUnchecked(reason: string): string {
  return (
    "Routing skips a switched-off provider, and which routes resolve through it could not " +
    `be checked just now: ${reason}`
  );
}

/** The confirmation's control. */
export const SWITCH_OFF_CONFIRM = "Switch off";
