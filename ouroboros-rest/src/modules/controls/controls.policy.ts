/**
 * The rules of the control queue that do not need a database — AP.4
 * ([#306](https://github.com/NobuData/ouroboros/issues/306)), decision **R6**.
 *
 * Pure functions, each with its own suite, so each rule is stated once and read by the service
 * rather than being an unexplained branch inside it:
 *
 *   * **Who may press what.** The blast radii differ: steering nudges, aborting destroys work
 *     in progress. So a `member` may steer and only an administrator may pause, resume or
 *     abort. Checked by the server whatever the console chose to show.
 *   * **The typed confirmation.** Mockup 10's abort dialog asks the person to type the loop
 *     number (*"Type 1847 to confirm"*). The server re-checks what was typed against the run's
 *     own `loop_seq`, so the dialog is not a client claim.
 *   * **What collapses into one control.** A double-click on *Pause loop* or *Abort run* is one
 *     control. A second steer is a second nudge, and is kept.
 *   * **How long each kind is worth delivering**, and the sentence an ack defaults to.
 */

import type { OrganizationRole, RunControlKind, RunStatus } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS } from "../tenancy/roles.guard";

/**
 * The roles that may request each kind of control.
 *
 * An exhaustive record, so a fifth kind added to `RunControlKind` fails the compile here
 * rather than being open to nobody, or to everybody.
 */
export const CONTROL_ROLES: Readonly<Record<RunControlKind, readonly OrganizationRole[]>> = {
  steer: CONTRIBUTORS,
  pause: ADMINISTRATORS,
  resume: ADMINISTRATORS,
  abort: ADMINISTRATORS,
};

/**
 * The kinds a repeated submission collapses into — `pause` and `abort`.
 *
 * Pressing either twice asks for the same thing twice, and two queued aborts would be two
 * acks, two audit rows and a second chip saying the same thing. `resume` is left out: it is
 * the toggle's other half, and a resume that followed a pause which already expired is a real
 * request. `steer` is left out because every steer is its own nudge.
 */
export const DEDUPLICATED_KINDS: readonly RunControlKind[] = ["pause", "abort"];

/** The two TTLs the service is configured with, in seconds. */
export interface ControlTtls {
  /** For `pause`, `resume` and `abort` — `OURO_RUN_CONTROL_TTL_SECONDS`. */
  readonly control: number;
  /** For `steer` — `OURO_RUN_STEER_TTL_SECONDS`. */
  readonly steer: number;
}

/**
 * May somebody holding these roles request this kind?
 *
 * @param kind - What they asked for.
 * @param roles - What their membership carries. Any one sufficing role is enough, as the roles
 *   guard reads a membership.
 * @returns Whether the request is allowed.
 */
export function mayRequest(kind: RunControlKind, roles: readonly OrganizationRole[]): boolean {
  return roles.some((held) => CONTROL_ROLES[kind].includes(held));
}

/**
 * Does a repeated submission of this kind collapse into the one already outstanding?
 *
 * @param kind - The kind.
 * @returns `true` for `pause` and `abort`.
 */
export function isDeduplicated(kind: RunControlKind): boolean {
  return DEDUPLICATED_KINDS.includes(kind);
}

/**
 * Does what was typed into the abort dialog match the run?
 *
 * The dialog asks for the loop number, the `1847` of *Loop #1847*. Surrounding whitespace is
 * forgiven, and so is a leading `#`, because a person copying the page head's number brings it
 * along. Anything else is a mismatch.
 *
 * @param loopSeq - The run's `loop_seq`, read from the locked row.
 * @param confirmation - What the request carried. Absent is a mismatch.
 * @returns Whether the confirmation names this run.
 */
export function confirmationMatches(loopSeq: number, confirmation: string | undefined): boolean {
  if (confirmation === undefined) {
    return false;
  }

  const typed = confirmation.trim().replace(/^#/, "");

  return typed === String(loopSeq);
}

/**
 * How long a control of this kind is worth delivering.
 *
 * @param kind - The kind.
 * @param ttls - The configured TTLs.
 * @returns Seconds.
 */
export function ttlSeconds(kind: RunControlKind, ttls: ControlTtls): number {
  return kind === "steer" ? ttls.steer : ttls.control;
}

/**
 * The sentence an ack records when the executor sent none of its own.
 *
 * A steer's is the one the console reads out, *"steering applied to attempt 2"*, so the person
 * who typed it knows which attempt it landed on. That needs the attempt, which only the
 * executor knows; without one the sentence says less rather than guessing.
 *
 * @param kind - The kind being acknowledged.
 * @param attempt - The attempt the executor applied a steer to, when it said.
 * @returns The ack detail.
 */
export function defaultAckDetail(kind: RunControlKind, attempt?: number): string {
  switch (kind) {
    case "steer":
      return attempt === undefined
        ? "steering applied"
        : `steering applied to attempt ${String(attempt)}`;
    case "pause":
      return "paused";
    case "resume":
      return "resumed";
    case "abort":
      return "aborted — branch preserved";
  }
}

/**
 * Why a control against a finished run was refused, in the words the console displays.
 *
 * @param status - The run's terminal status.
 * @returns The rejection's detail.
 */
export function finishedRunRejection(status: RunStatus): string {
  return `The run is ${status.replace("_", " ")} and has already finished, so there is nothing left to control.`;
}
