/**
 * A decision card's receipt — what an answer actually executed, in words, with where to see it
 * (BO.2, [#467](https://github.com/NobuData/ouroboros/issues/467)) — pure.
 *
 * ```
 * guardrail.allow_once   exception granted · resume sent to loop #1844        → Run console
 * pr.approve_and_merge   approval recorded · PR merged at 3f9c2ab              → PR verification
 *                        approval recorded · merge armed — it lands once its checks are green
 * pr.waive_criterion     claim waived · PR annotated publicly                  → PR verification
 * ```
 *
 * **Keyed by `handler_binding`, never by kind.** A receipt describes the operation a plane ran, so
 * two kinds that bind the same operation read the same, and a kind added later needs nothing here.
 * A binding this table does not know still gets an honest line — the action in the past tense
 * (`inbox.compose.ts`'s `outcomeWords`) and the item's run or PR to look at.
 *
 * **It says what happened, not what was hoped.** A control the loop has not acknowledged yet reads
 * *sent to*, not *resumed*; a merge waiting on its gates reads *armed*; a waiver whose host comment
 * failed says so. The card prints these lines verbatim, which is why they are composed where the
 * plane's own answer is in hand.
 */

import type { DecisionRef, DecisionRefType } from "../decisions/decision.types";
import { outcomeWords } from "../decisions/inbox.compose";
import { UI_ROUTES, type LinkContext } from "../decisions/inbox.links";

/** One place a receipt points at. */
export interface ReceiptLink {
  /** What the link says — `Run console`. */
  readonly label: string;
  /** An origin-relative UI path. */
  readonly href: string;
}

/** What an answer did. */
export interface ActionReceipt {
  /** Each thing that executed, in order — the card joins them with `·`. Never empty. */
  readonly effects: readonly string[];
  /** Where to see it. May be empty. */
  readonly links: readonly ReceiptLink[];
}

/** What a receipt is composed from. */
export interface ReceiptContext extends LinkContext {
  /** The action that answered, for a binding with no entry here. */
  readonly actionId: string;
}

/** A plane's outcome, as stored. */
type Outcome = Readonly<Record<string, unknown>>;

/** How many characters of a commit sha a receipt prints. */
const SHORT_SHA = 7;

/** The link labels. */
const RUN_CONSOLE = "Run console";
const PR_VERIFICATION = "PR verification";
const PLANNING = "Planning";
const KNOWLEDGE = "Knowledge";

/**
 * The first ref of a type.
 *
 * @param refs - The item's refs.
 * @param type - The type.
 * @returns The ref, or `undefined`.
 */
function refOf(refs: readonly DecisionRef[], type: DecisionRefType): DecisionRef | undefined {
  return refs.find((ref) => ref.type === type);
}

/**
 * A text value of an outcome.
 *
 * @param value - The stored value.
 * @returns The string, or `undefined` for anything else (or an empty one).
 */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The item's run, as a receipt names it.
 *
 * @param refs - The item's refs.
 * @returns `loop #1844`, or `the loop` for an item with no run ref.
 */
function loopName(refs: readonly DecisionRef[]): string {
  return refOf(refs, "run")?.label ?? "the loop";
}

/**
 * Whether the loop has acknowledged the control an answer queued (AP.4's `acked`).
 *
 * @param outcome - The plane's outcome.
 * @returns `true` once it has.
 */
function acknowledged(outcome: Outcome): boolean {
  return outcome.control_state === "acked";
}

/**
 * The link to the item's run console.
 *
 * @param context - The item's refs; the outcome's `run_id` is preferred when present.
 * @param outcome - The plane's outcome.
 * @returns One link, or none without a run.
 */
function runLinks(context: ReceiptContext, outcome: Outcome): ReceiptLink[] {
  const runId = text(outcome.run_id) ?? refOf(context.refs, "run")?.id;

  return runId === undefined ? [] : [{ label: RUN_CONSOLE, href: UI_ROUTES.run(runId) }];
}

/**
 * The link to the item's PR.
 *
 * @param context - The item's refs; the outcome's `pr_id` is preferred when present.
 * @param outcome - The plane's outcome.
 * @param route - Which part of the PR page.
 * @returns One link, or none without a PR.
 */
function prLinks(
  context: ReceiptContext,
  outcome: Outcome,
  route: (prId: string) => string = UI_ROUTES.pr,
): ReceiptLink[] {
  const prId = text(outcome.pr_id) ?? refOf(context.refs, "pr")?.id;

  return prId === undefined ? [] : [{ label: PR_VERIFICATION, href: route(prId) }];
}

/**
 * The link to a planning batch.
 *
 * @param outcome - The plane's outcome.
 * @returns One link, or none without a batch.
 */
function batchLinks(outcome: Outcome): ReceiptLink[] {
  const batchId = text(outcome.draft_batch_id);

  return batchId === undefined ? [] : [{ label: PLANNING, href: UI_ROUTES.planningBatch(batchId) }];
}

/** Each bound operation's receipt. */
const RECEIPTS: Readonly<
  Record<string, (outcome: Outcome, context: ReceiptContext) => ActionReceipt>
> = {
  "pr.approve_and_merge": (outcome, context) => {
    const sha = text(outcome.merge_sha);
    const merged =
      outcome.merge === "merged"
        ? sha === undefined
          ? "PR merged"
          : `PR merged at ${sha.slice(0, SHORT_SHA)}`
        : "merge armed — it lands once its checks are green";

    return { effects: ["approval recorded", merged], links: prLinks(context, outcome) };
  },

  "pr.waive_criterion": (outcome, context) => {
    const annotation =
      outcome.annotation === "annotated"
        ? "PR annotated publicly"
        : outcome.annotation === "failed"
          ? "the PR annotation failed — retry it from the PR page"
          : "PR annotation queued";

    return {
      effects: ["claim waived", annotation],
      links: prLinks(context, outcome, UI_ROUTES.prCriteria),
    };
  },

  "guardrail.allow_once": (outcome, context) => ({
    effects: [
      "exception granted",
      acknowledged(outcome)
        ? `${loopName(context.refs)} resumed`
        : `resume sent to ${loopName(context.refs)}`,
    ],
    links: runLinks(context, outcome),
  }),

  "run.deny_protected_path": (outcome, context) => ({
    effects: [
      "path stays protected",
      acknowledged(outcome)
        ? `${loopName(context.refs)} returned with your decision`
        : `decision sent to ${loopName(context.refs)}`,
    ],
    links: runLinks(context, outcome),
  }),

  "run.return_with_note": (outcome, context) => noteDelivered(outcome, context),
  "run.retry_with_note": (outcome, context) => noteDelivered(outcome, context),

  "run.cancel": (outcome, context) => ({
    effects: [
      acknowledged(outcome)
        ? `${loopName(context.refs)} cancelled`
        : `cancel sent to ${loopName(context.refs)}`,
    ],
    links: runLinks(context, outcome),
  }),

  "planning.push_batch": (outcome) => {
    const pushed = typeof outcome.pushed === "number" ? outcome.pushed : 0;
    const tickets = `${String(pushed)} ${pushed === 1 ? "ticket" : "tickets"} pushed`;
    const rest =
      outcome.push === "pushed"
        ? []
        : [
            outcome.push === "throttled"
              ? "the tracker is rate limiting — resume from Planning"
              : "some drafts failed — resume from Planning",
          ];

    return { effects: ["split approved", tickets, ...rest], links: batchLinks(outcome) };
  },

  "planning.require_bench_upgrade": (outcome) => ({
    effects: ["bench-gap ticket drafted", "claim left unverified"],
    links: batchLinks(outcome),
  }),

  "facts.confirm": () => ({
    effects: ["fact confirmed"],
    links: [{ label: KNOWLEDGE, href: UI_ROUTES.knowledgeFacts }],
  }),

  "facts.retire": (outcome) => ({
    effects: [outcome.status === "expired" ? "fact expired" : "fact rejected"],
    links: [{ label: KNOWLEDGE, href: UI_ROUTES.knowledgeFacts }],
  }),
};

/**
 * A correction round's receipt — *Return to loop with note*, *Retry with note*.
 *
 * @param outcome - AP.4's control.
 * @param context - The item's refs.
 * @returns The receipt.
 */
function noteDelivered(outcome: Outcome, context: ReceiptContext): ActionReceipt {
  return {
    effects: [
      acknowledged(outcome)
        ? `${loopName(context.refs)} returned with your note`
        : `note sent to ${loopName(context.refs)}`,
    ],
    links: runLinks(context, outcome),
  };
}

/**
 * The receipt for one answer.
 *
 * @param binding - The answering action's `handler_binding`, or `undefined` when the pinned kind
 *   no longer names the action.
 * @param outcome - What the owning plane answered with.
 * @param context - The item's refs and source ref, and the action's id.
 * @returns What executed and where to see it. An unknown binding reads as the action in the past
 *   tense, linked to the item's run and PR.
 */
export function actionReceipt(
  binding: string | undefined,
  outcome: Outcome,
  context: ReceiptContext,
): ActionReceipt {
  const compose = binding === undefined ? undefined : RECEIPTS[binding];

  if (compose !== undefined) {
    return compose(outcome, context);
  }

  return {
    effects: [outcomeWords({ resolver: "human", policy: null, actionId: context.actionId })],
    links: [...runLinks(context, outcome), ...prLinks(context, outcome)],
  };
}
