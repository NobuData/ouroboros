/**
 * Who a merge is made as, and what one did
 * ([#369](https://github.com/NobuData/ouroboros/issues/369), decision **V3**).
 *
 * **Identity is permanent.** Mockup 12's footer promises *Merges as `ouroboros-app[bot]`*. Until
 * the GitHub App lands (#374) every merge is made with the workspace's configured token, which
 * belongs to a real person, and that attribution lives in a git history forever. The service
 * learns whose token it is only from the host's answer to the merge, so:
 *
 * ```
 * before a merge   the footer names the token          {@link IDENTITY_LINE}
 * after a merge    the receipt names the host's login  merged_result.identity_used
 * ever             neither claims a [bot]              {@link honestIdentity}
 * ```
 *
 * **Nothing is said to be co-authored.** The executor sends the message as written and appends
 * no trailer, so the footer says who armed the plan instead.
 *
 * **The receipt lists what ran, and what was switched on and did not.** A ticket the host left
 * open is the second kind, with the reason while the merge's own answer is still held.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { PrMergeAction, PrMergeOutcome, PrMergePlan } from "@/app/api/pull-requests";
import { clockOf } from "@/app/test-results/timeline";

import { shortSha } from "./strip";

/** What is recorded, and said, when the host named nobody — the service's `TOKEN_IDENTITY`. */
export const TOKEN_IDENTITY = "configured token";

/** The footer: who a merge is made as, today. Never a `[bot]`. */
export const IDENTITY_LINE =
  "Merges as the workspace's configured token — bot identity arrives with the GitHub App (#374).";

// --- identity ------------------------------------------------------------------------------

/**
 * Whether an identity claims to be a bot — the service's `claimsBot`, and V058's CHECK.
 *
 * @param identity A host login.
 * @returns `true` for any `[bot]`, in any case.
 */
export function claimsBot(identity: string): boolean {
  return identity.toLowerCase().includes("[bot]");
}

/**
 * The identity a merge is drawn as.
 *
 * @param identity What `mergedResult.identityUsed` states.
 * @returns It — or {@link TOKEN_IDENTITY} when it is blank or claims a `[bot]`, which the schema
 *   refuses while merges are token-based; the page does not repeat a claim the schema forbids.
 */
export function honestIdentity(identity: string): string {
  const login = identity.trim();

  return login === "" || claimsBot(login) ? TOKEN_IDENTITY : login;
}

/**
 * The footer.
 *
 * @param plan The plan.
 * @returns {@link IDENTITY_LINE}, and who armed the plan while it is armed and they are known.
 */
export function identityFooter(plan: PrMergePlan): string {
  const person = plan.armed ? (plan.armedByPerson ?? null) : null;

  return person === null ? IDENTITY_LINE : `${IDENTITY_LINE} Armed by ${person.name}.`;
}

// --- the receipt ---------------------------------------------------------------------------

/** What a direct merge answered beyond the plan — kept, because no read carries it again. */
export interface MergeAnswer {
  /** The merge commit it belongs to. */
  readonly sha: string;
  /** Why each switched-on action did not run. */
  readonly failedActions: PrMergeOutcome["failedActions"];
}

/** An action the plan had switched on and the merge did not run. */
export interface SkippedAction {
  readonly action: PrMergeAction;
  /** `close issue #482`. */
  readonly label: string;
  /** Why, when the merge's answer is still held; `null` after a reload. */
  readonly detail: string | null;
}

/** What a merge did. */
export interface ReceiptView {
  /** `b7e41d0`. */
  readonly sha: string;
  /** Who the host recorded — never a `[bot]`. */
  readonly identity: string;
  /** `14:45:02`, or `null` for a moment that is not a date. */
  readonly time: string | null;
  /** The moment, as recorded. */
  readonly at: string;
  /** What ran, in the plan's order — `closed issue #482`. */
  readonly ran: readonly string[];
  /** What was switched on and did not run. */
  readonly skipped: readonly SkippedAction[];
}

/** Every action, in the order the card draws them. */
const ACTIONS: readonly PrMergeAction[] = [
  "close_ticket",
  "comment_evidence",
  "back_annotate_epic",
  "delete_branch",
];

/**
 * An action, said as something done or as something intended.
 *
 * @param action The action.
 * @param ticketKey The ticket's key, or `null`.
 * @param done Whether it ran.
 * @returns `closed issue #482`, or `close issue #482`.
 */
export function actionLabel(
  action: PrMergeAction,
  ticketKey: string | null,
  done: boolean,
): string {
  const ticket = ticketKey === null ? "the ticket" : `issue ${ticketKey}`;

  switch (action) {
    case "close_ticket":
      return `${done ? "closed" : "close"} ${ticket}`;
    case "comment_evidence":
      return `${done ? "commented" : "comment"} the evidence summary`;
    case "back_annotate_epic":
      return `${done ? "back-annotated" : "back-annotate"} the roadmap`;
    case "delete_branch":
      return `${done ? "deleted" : "delete"} the branch`;
  }
}

/**
 * The actions a plan has switched on.
 *
 * @param plan The plan.
 * @param hasTicket Whether the PR has a ticket — closing none is not an action that can fail.
 * @returns The actions, in the card's order.
 */
export function configuredActions(
  plan: PrMergePlan,
  hasTicket: boolean,
): readonly PrMergeAction[] {
  const on: Readonly<Record<PrMergeAction, boolean>> = {
    close_ticket: plan.closeTicket && hasTicket,
    comment_evidence: plan.commentEvidence,
    back_annotate_epic: plan.backAnnotateEpic,
    delete_branch: plan.deleteBranch,
  };

  return ACTIONS.filter((action) => on[action]);
}

/**
 * The receipt of a merged plan.
 *
 * @param plan The plan.
 * @param ticketKey The ticket's key, or `null`.
 * @param answer What the merge answered, when this page made it — for why an action did not run.
 * @returns What ran and what did not, or `null` for a plan that has not merged.
 */
export function receipt(
  plan: PrMergePlan,
  ticketKey: string | null,
  answer: MergeAnswer | null,
): ReceiptView | null {
  const result = plan.mergedResult;
  if (result === null) return null;

  const executed = new Set(result.actionsExecuted);
  const failures = answer !== null && answer.sha === result.sha ? answer.failedActions : [];

  return {
    sha: shortSha(result.sha),
    identity: honestIdentity(result.identityUsed),
    time: clockOf(result.mergedAt),
    at: result.mergedAt,
    ran: ACTIONS.filter((action) => executed.has(action)).map((action) =>
      actionLabel(action, ticketKey, true),
    ),
    skipped: configuredActions(plan, ticketKey !== null)
      .filter((action) => !executed.has(action))
      .map((action) => ({
        action,
        label: actionLabel(action, ticketKey, false),
        detail: failures.find((failure) => failure.action === action)?.detail ?? null,
      })),
  };
}
