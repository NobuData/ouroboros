/**
 * The post-merge actions' pure rules — whether the ticket really closed, the epic note's line, and
 * which configured actions `merged_result` may say ran.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)), decision **V3**:
 *
 * ```
 * merged ─▶ close_ticket        the canonical ticket's closure, read back by the host   verified, not assumed
 *        ─▶ comment_evidence    the evidence summary, edited under one key               idempotent
 *        ─▶ back_annotate_epic  one pr_merged note on the plan's epic                    idempotent
 *        ─▶ delete_branch       the host's own report                                    verified
 * ```
 *
 * **Keyword closing is detected, never assumed.** `Closes #482.` closes the issue only when the
 * host decides it should — on a merge into the default branch, in a repository the merge can see.
 * The SPI's `mergePR` reads every referenced issue back after the merge; {@link ticketClosure}
 * finds the canonical ticket among them. A ticket the host did not close — or one no keyword could
 * close, like a Jira key — is reported `closed: false` with the reason, and `close_ticket` is left
 * out of `actions_executed`. The SPI has no member that closes a ticket outright, so reporting is
 * as far as the executor goes.
 *
 * Pure.
 */

import type { PrMergeAction } from "../../db/schema";
import type { IssueClosure } from "../../ticket-sources/ticket-source.pr";

/** What happened to the PR's canonical ticket. */
export interface TicketClosure {
  /** The ticket's key — `#482`, `PROJ-142`. */
  readonly key: string;
  /** Whether it is closed now. */
  readonly closed: boolean;
  /** Why it is not, or null when it is. */
  readonly detail: string | null;
}

/**
 * The canonical ticket's closure, among the host's.
 *
 * @param ticketKey - The canonical ticket's `external_key`, or null for a PR without one.
 * @param closures - What `mergePR` read back for every keyword reference.
 * @returns The closure, or null when the PR has no ticket. A ticket no keyword referenced — the
 *   message lost its trailer, or the key is not the host's (`PROJ-142`) — is `closed: false`.
 */
export function ticketClosure(
  ticketKey: string | null,
  closures: readonly IssueClosure[],
): TicketClosure | null {
  if (ticketKey === null) {
    return null;
  }

  const found = closures.find(
    (closure) => closure.reference.toLowerCase() === ticketKey.toLowerCase(),
  );

  if (found === undefined) {
    return {
      key: ticketKey,
      closed: false,
      detail: `${ticketKey} is not closed by a keyword on this host — close it in its tracker`,
    };
  }

  return {
    key: ticketKey,
    closed: found.closed,
    detail: found.closed ? null : (found.detail ?? `${ticketKey} is still open after the merge`),
  };
}

/** The longest epic note V064 stores. */
export const MAX_EPIC_NOTE = 2048;

/**
 * The epic's note — the line the roadmap shows.
 *
 * @param pr - The PR's number and title.
 * @param ticketKey - The canonical ticket's key, or null.
 * @param sha - The merge commit.
 * @returns `merged PR #514 — <title> · closes #482 · 9a1f0c2`, bounded, on one line.
 */
export function epicNoteBody(
  pr: { readonly number: number; readonly title: string },
  ticketKey: string | null,
  sha: string,
): string {
  const parts = [
    `merged PR #${String(pr.number)} — ${pr.title.replace(/\s+/g, " ").trim()}`,
    ...(ticketKey === null ? [] : [`closes ${ticketKey}`]),
    sha.slice(0, 7),
  ];

  return parts.join(" · ").slice(0, MAX_EPIC_NOTE);
}

/** What each action did — `true` when it ran. */
export interface ActionOutcomes {
  readonly close_ticket: boolean;
  readonly comment_evidence: boolean;
  readonly back_annotate_epic: boolean;
  readonly delete_branch: boolean;
}

/** The plan's switches, as `merged_result`'s CHECK compares them. */
export type ActionSwitches = ActionOutcomes;

/** The actions in the order `merged_result` lists them. */
const ACTION_ORDER: readonly PrMergeAction[] = [
  "close_ticket",
  "comment_evidence",
  "back_annotate_epic",
  "delete_branch",
];

/**
 * The actions `merged_result.actions_executed` lists — each one that ran **and** was switched on,
 * which is V058's `pr_merge_result_valid` rule: a ticket closed by keyword while `close_ticket` was
 * off happened, but was not an action this plan executed.
 *
 * @param switches - The plan's toggles.
 * @param outcomes - What ran.
 * @returns The executed actions, in a fixed order, each once.
 */
export function actionsExecuted(
  switches: ActionSwitches,
  outcomes: ActionOutcomes,
): PrMergeAction[] {
  return ACTION_ORDER.filter((action) => switches[action] && outcomes[action]);
}
