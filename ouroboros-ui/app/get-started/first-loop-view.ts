/**
 * The wizard's first loop, live (BD.1, [#396](https://github.com/NobuData/ouroboros/issues/396)) —
 * what the timeline's live-upgrade slot takes, which state the loop is in, and the words the card
 * says. Pure: the card, the timeline and their tests read the same functions.
 *
 * ```
 * GET /api/onboarding/first-loop?run=<id>      this origin → REST, under the session
 *   console      GET /api/v1/runs/{id}           the run console's data plane (#303/#304)
 *   pullRequest  GET /api/v1/pull-requests?runId= the run's PR, looked up by run, never by number
 *   budget       GET /api/v1/runs/{id}/controls  a system abort for cost_cap / token_budget
 *   dryRun       GET /api/v1/policies/dry-run    why the PR is a draft
 * ```
 *
 * **The timeline** (decided on the ticket): *loop starts* at the run's start; *plan posted* when
 * the first model stage's first attempt finishes, succeeded; *draft PR opens* when the run's PR was
 * opened; *you review* when the guided review is acknowledged; *merge* when the PR merged. Each
 * time is elapsed from the run's start, and a measured row loses its `projected` label.
 *
 * **Honest states.** A run that failed, was cancelled, was stopped by its budget, waits on a
 * person, or has not moved for {@link STALL_MINUTES} minutes says so, with the run console's link —
 * never a spinner.
 */

import type { DryRunPolicy } from "@/app/api/policies";
import type { PullRequestSummary } from "@/app/api/pull-requests";
import type { RunConsole } from "@/app/api/runs";
import { INBOX_PATH, POLICIES_PATH, prPath, runPath } from "@/app/paths";

import type { LiveTimelineRow } from "./defaults-view";

/** Which limit stopped the run, when its budget did (AR.1, #315). */
export type BudgetLimit = "cost_cap" | "token_budget";

/** What the first-loop poll answers. */
export interface FirstLoop {
  /** The run console's read of the run. */
  readonly console: RunConsole;
  /** The run's pull request, or null while it has none. */
  readonly pullRequest: PullRequestSummary | null;
  /** The limit a system abort named, when the run's budget stopped it; otherwise null. */
  readonly budget: BudgetLimit | null;
  /** The workspace's dry-run policy, or null when it could not be read. */
  readonly dryRun: DryRunPolicy | null;
}

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const FIRST_LOOP_ENDPOINT = "/api/onboarding/first-loop";

/** How long an active run may go without a stage transition before the card calls it stalled. */
export const STALL_MINUTES = 15;

/** The card's title, and what it says while it cannot hear. */
export const FIRST_LOOP_TITLE = "Your first loop";
export const FIRST_LOOP_PENDING = "Reading the first loop…";
export const UNREACHABLE_FIRST_LOOP = "The first loop could not be read — the service did not answer.";
export const UNREADABLE_FIRST_LOOP = "The first loop could not be read — the answer was not one this page reads.";

/** The run console link every state carries. */
export const CONSOLE_LINK = "Open the run console →";

/** The guided review. */
export const REVIEW_TITLE = "Review your first pull request";
export const REVIEW_LINK = "Open the diff and checks →";
export const REVIEW_DRAFT_BECAUSE =
  "It is a draft because dry-run is on: Ouroboros opened it as a draft and will not merge it.";
export const REVIEW_DRAFT_OTHER = "It is a draft: nothing merges until a person says so.";
export const REVIEW_NOT_DRAFT =
  "Dry-run is off for this workspace, so this pull request opened ready for review.";
export const REVIEW_DECISION =
  "Read it as you would a colleague's: the diff is the loop's whole change, and the checks are what it ran.";
export const REVIEW_POLICY_LINK = "the dry-run policy";
export const REVIEW_ACK = "I've reviewed it";

/** The first-merge guidance — only after the review was acknowledged. */
export const MERGE_GUIDANCE_TITLE = "When you trust the loop to merge";
export const MERGE_GUIDANCE =
  "An owner or admin can turn dry-run off. From then on, pull requests open ready for review, and a workflow whose last step merges will merge without a person. Turn it back on at any time.";
export const MERGE_GUIDANCE_LINK = "Settings → Policies →";

/** Every state the card draws. */
export type FirstLoopState =
  | { readonly kind: "running"; readonly stage: string }
  | { readonly kind: "waiting" }
  | { readonly kind: "stalled"; readonly minutes: number }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "canceled" }
  | { readonly kind: "budget"; readonly limit: BudgetLimit }
  | { readonly kind: "review"; readonly pullRequest: PullRequestSummary }
  | { readonly kind: "merged"; readonly pullRequest: PullRequestSummary }
  | { readonly kind: "closed"; readonly pullRequest: PullRequestSummary };

/** The words each state leads with. */
export const STATE_LINES = {
  running: (stage: string) => `The loop is running — now at ${stage}.`,
  waiting: "The loop is waiting on you: a decision is in Needs you.",
  stalled: (minutes: number) =>
    `The loop has not moved for ${String(minutes)} minutes. Open the run console to see where it stopped.`,
  failed: (reason: string) => `The loop failed: ${reason}`,
  canceled: "The loop was cancelled before it opened a pull request.",
  budget: {
    cost_cap: "The loop stopped: it reached its cost cap for one run.",
    token_budget: "The loop stopped: a stage reached its token budget.",
  } satisfies Record<BudgetLimit, string>,
  review: "Your first draft pull request is open.",
  merged: "Your first loop's pull request merged.",
  closed: "Your first loop's pull request was closed without merging.",
} as const;

/** Where the waiting state sends a person. */
export const WAITING_LINK = { label: "Open Needs you →", href: INBOX_PATH } as const;

/**
 * Seconds between two instants, as the timeline prints them: `0:00`, `1:04`, `1:02:09`.
 *
 * @param from The earlier instant (ISO).
 * @param to The later instant (ISO).
 * @returns The elapsed time; `0:00` when `to` is not after `from`.
 */
export function elapsed(from: string, to: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");

  return hours > 0 ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${rest}` : `${String(minutes)}:${rest}`;
}

/**
 * When the first model stage's first attempt finished, succeeded — *plan posted*.
 *
 * @param console The run console's read.
 * @param planStage The stage key of the first model stage, or null when the pin names none.
 * @returns The instant, or null while it has not.
 */
export function planPostedAt(console: RunConsole, planStage: string | null): string | null {
  if (planStage === null) return null;

  const stage = console.timeline.stages.find((one) => one.stageKey === planStage);
  const first = stage?.attempts.find((attempt) => attempt.attempt === 1);

  return first !== undefined && first.status === "succeeded" ? first.finishedAt : null;
}

/**
 * The measured rows — what the timeline's live-upgrade slot takes (BD.1).
 *
 * @param loop The first loop.
 * @param planStage The first model stage's key, from `refs.firstRun.planStage`.
 * @param reviewedAt When the guided review was acknowledged here, or null.
 * @returns The rows the run has reached, each with its elapsed time.
 */
export function liveTimelineRows(
  loop: Pick<FirstLoop, "console" | "pullRequest">,
  planStage: string | null,
  reviewedAt: string | null,
): LiveTimelineRow[] {
  const start = loop.console.run.startedAt;
  const rows: LiveTimelineRow[] = [{ key: "loop_starts", at: elapsed(start, start) }];
  const plan = planPostedAt(loop.console, planStage);
  const pr = loop.pullRequest;

  if (plan !== null) rows.push({ key: "plan_posted", at: elapsed(start, plan) });
  if (pr !== null) {
    rows.push({ key: "draft_pr_opens", at: elapsed(start, pr.createdAt) });
    if (reviewedAt !== null) rows.push({ key: "you_review", at: elapsed(start, reviewedAt) });
    if (pr.mergedAt !== null) rows.push({ key: "merge", at: elapsed(start, pr.mergedAt) });
  }

  return rows;
}

/**
 * The run's last stage transition — an attempt starting or finishing, or the run's own start.
 *
 * @param console The run console's read.
 * @returns Epoch milliseconds.
 */
export function lastTransition(console: RunConsole): number {
  const instants = console.timeline.stages.flatMap((stage) =>
    stage.attempts.flatMap((attempt) => [attempt.startedAt, attempt.finishedAt]),
  );

  return Math.max(
    Date.parse(console.run.startedAt),
    ...instants.filter((at): at is string => at !== null).map((at) => Date.parse(at)),
  );
}

/**
 * Why a failed run failed — the latest failed attempt's own note, else the stage it failed in.
 *
 * @param console The run console's read.
 * @returns A sentence.
 */
export function failureReason(console: RunConsole): string {
  for (const stage of [...console.timeline.stages].reverse()) {
    const latest = stage.attempts.at(-1);

    if (latest?.status === "failed") {
      return latest.note ?? `${stage.label} failed.`;
    }
  }

  return `${console.run.stageLabel} failed.`;
}

/**
 * Which state the first loop is in.
 *
 * @param loop The first loop.
 * @param now Epoch milliseconds — the stall clock.
 * @returns The state.
 */
export function firstLoopState(loop: Pick<FirstLoop, "console" | "pullRequest" | "budget">, now: number): FirstLoopState {
  const { run } = loop.console;
  const pr = loop.pullRequest;

  if (pr !== null && pr.state === "merged") return { kind: "merged", pullRequest: pr };
  if (pr !== null && pr.state === "closed") return { kind: "closed", pullRequest: pr };
  if (run.status === "failed") return { kind: "failed", reason: failureReason(loop.console) };
  if (run.status === "canceled") {
    return loop.budget === null ? { kind: "canceled" } : { kind: "budget", limit: loop.budget };
  }
  if (pr !== null) return { kind: "review", pullRequest: pr };
  if (run.status === "needs_human") return { kind: "waiting" };

  const idle = Math.floor((now - lastTransition(loop.console)) / 60_000);

  return run.finishedAt === null && idle >= STALL_MINUTES
    ? { kind: "stalled", minutes: idle }
    : { kind: "running", stage: run.stageLabel };
}

/**
 * Why the PR is a draft, in the card's words — the dry-run policy named as the reason only when
 * it is the reason.
 *
 * @param pullRequest The PR.
 * @param dryRun The policy, or null when it could not be read.
 * @returns The sentence.
 */
export function draftLine(pullRequest: Pick<PullRequestSummary, "draft">, dryRun: Pick<DryRunPolicy, "dryRun"> | null): string {
  if (!pullRequest.draft) return REVIEW_NOT_DRAFT;

  return dryRun?.dryRun === true ? REVIEW_DRAFT_BECAUSE : REVIEW_DRAFT_OTHER;
}

/**
 * The links a state carries — the run console always, and the PR page or Needs you where they
 * are what to open next.
 *
 * @param runId The run.
 * @param state The state.
 * @returns Product paths.
 */
export function stateLinks(runId: string, state: FirstLoopState): { readonly console: string; readonly review: string | null; readonly waiting: string | null } {
  return {
    console: runPath(runId),
    review:
      state.kind === "review" || state.kind === "merged" || state.kind === "closed"
        ? prPath(state.pullRequest.id)
        : null,
    waiting: state.kind === "waiting" ? WAITING_LINK.href : null,
  };
}

/** Where the merge guidance and the draft reason point. */
export const POLICY_HREF = POLICIES_PATH;

/**
 * The first-loop address for a run.
 *
 * @param runId The run.
 * @returns `/api/onboarding/first-loop?run=<id>`.
 */
export function firstLoopEndpoint(runId: string): string {
  return `${FIRST_LOOP_ENDPOINT}?run=${encodeURIComponent(runId)}`;
}

/**
 * Whether a payload is shaped like the first loop — enough to draw the card.
 *
 * @param value What arrived.
 * @returns True for the first loop.
 */
export function isFirstLoop(value: unknown): value is FirstLoop {
  if (typeof value !== "object" || value === null) return false;

  const { console, pullRequest, budget } = value as Record<string, unknown>;

  if (typeof console !== "object" || console === null) return false;

  const { run, timeline } = console as Record<string, unknown>;

  return (
    typeof run === "object" &&
    run !== null &&
    typeof (run as { startedAt?: unknown }).startedAt === "string" &&
    typeof timeline === "object" &&
    timeline !== null &&
    Array.isArray((timeline as { stages?: unknown }).stages) &&
    (pullRequest === null || (typeof pullRequest === "object" && pullRequest !== undefined)) &&
    (budget === null || budget === "cost_cap" || budget === "token_budget")
  );
}
