/**
 * The app-wide paused banner's copy and decisions, as values
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * *Pausing has to be visible everywhere or it looks like an outage.* Somebody pauses on the
 * settings page, forgets, and opens the dashboard tomorrow to find nothing running — so while a
 * workspace is `paused` the shell says so on every signed-in screen, in one line, with the way
 * back beside it. This module is what that line says and when it is drawn;
 * `app/lifecycle/lifecycle-banner.tsx` draws it.
 *
 * Framework-free and pure.
 */

import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";

/** The pause glyph. Decoration — the words beside it carry the meaning. */
export const PAUSED_GLYPH = "⏸";

/** The banner's line — the issue's own, verbatim. */
export const PAUSED_HEADLINE = "all loops paused — stages finishing";

/** The banner's accessible name. */
export const PAUSED_LABEL = "All loops paused";

/** The inline resume action. */
export const RESUME_LABEL = "Resume";

/** The same button while the resume is on its way. */
export const RESUMING_LABEL = "Resuming…";

/** What a reader who may not resume is offered instead: the way to where it says who can. */
export const WHO_CAN_RESUME = "Who can resume?";

/** What is said when a resume was refused and the service gave no sentence. */
export const RESUME_FAILED = "The workspace could not be resumed. Try again.";

/** What the poll reports when the lifecycle could not be reached. */
export const UNREACHABLE_LIFECYCLE = "The workspace's state could not be reached.";

/** What the poll reports when the answer was not a lifecycle. */
export const UNREADABLE_LIFECYCLE = "The workspace's state could not be read.";

/** The states a lifecycle may be in — what an answer's `state` is checked against. */
const STATES: readonly string[] = ["active", "paused", "pending_delete"];

/**
 * Whether a value is a lifecycle — what the poll accepts from the wire.
 *
 * Checked as far as this module depends on it: the state, and that a banner, when there is one,
 * carries the sentence and the path the bar prints.
 *
 * @param value Anything parsed from a response body.
 * @returns `true` for a lifecycle, narrowing the type.
 */
export function isLifecycle(value: unknown): value is WorkspaceLifecycle {
  if (typeof value !== "object" || value === null) return false;

  const { state, banner } = value as { state?: unknown; banner?: unknown };

  if (typeof state !== "string" || !STATES.includes(state)) return false;
  if (banner === null || banner === undefined) return true;
  if (typeof banner !== "object") return false;

  const { message, actionPath } = banner as { message?: unknown; actionPath?: unknown };

  return typeof message === "string" && typeof actionPath === "string";
}

/** What the paused banner draws. */
export interface PausedBanner {
  /** The fuller sentence — the service's own, with a fallback when it sent none. */
  readonly message: string;
  /** Where the lifecycle is changed — the Danger zone — for a reader who may not resume here. */
  readonly actionPath: string;
}

/** The sentence used when a paused lifecycle arrived without a banner of its own. */
export const PAUSED_MESSAGE =
  "All loops are paused. Running loops finish their stage; queued issues stay queued.";

/** Where the lifecycle is changed, when the service did not say. */
export const DANGER_ZONE_PATH = "/settings#danger";

/**
 * What the shell's banner draws for a lifecycle.
 *
 * @param lifecycle The last lifecycle read, or `null` before the first answer.
 * @returns The banner's content while the workspace is `paused`; `null` otherwise — an active
 *   workspace has nothing to say, an unread one nothing to claim, and a workspace pending
 *   deletion is the recovery screen's.
 */
export function pausedBanner(lifecycle: WorkspaceLifecycle | null): PausedBanner | null {
  if (lifecycle === null || lifecycle.state !== "paused") return null;

  return {
    message: lifecycle.banner?.message || PAUSED_MESSAGE,
    actionPath: lifecycle.banner?.actionPath || DANGER_ZONE_PATH,
  };
}

/**
 * Whether a role may resume the workspace: `owner` or `admin`, the service's own rule.
 *
 * Presentation only — the service enforces it — and it errs low: a role not yet known, or one
 * this build does not recognise, is offered the link rather than a button that would be refused.
 *
 * @param role The reader's role in the acting workspace as the organization plugin reports it —
 *   possibly several, comma-separated — or `null` while it is not known.
 * @returns `true` when the banner should offer **Resume**.
 */
export function mayResume(role: string | null): boolean {
  if (role === null) return false;

  return role
    .split(",")
    .map((one) => one.trim())
    .some((one) => one === "owner" || one === "admin");
}
