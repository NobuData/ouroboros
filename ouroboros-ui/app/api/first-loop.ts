import "server-only";

import { type DryRunPolicy, dryRunPolicy } from "@/app/api/policies";
import { type PullRequestSummary, isPullRequestId, pullRequests } from "@/app/api/pull-requests";
import { readForPoll } from "@/app/api/poll-read";
import { type RunConsole, type RunControlList, runs } from "@/app/api/runs";
import { anonymousApi } from "@/app/api/server";
import { type BudgetLimit, type FirstLoop, UNREACHABLE_FIRST_LOOP } from "@/app/get-started/first-loop-view";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read answers with, through `/api/onboarding/first-loop`. */
export const FIRST_LOOP_UNAVAILABLE_CODE = "first_loop_unavailable";

/** What a request that names no run is told. */
export const FIRST_LOOP_RUN_MISSING = "Name the run: ?run=<id>.";

/** The abort details the harness facade files when a run reaches its budget (AR.1, #315). */
const BUDGET_DETAILS: Readonly<Record<string, BudgetLimit>> = {
  cost_cap_exceeded: "cost_cap",
  token_budget_exceeded: "token_budget",
};

/** The reads the first loop is composed from — each replaced in tests. */
export interface FirstLoopReads {
  readonly console: (runId: string, signal: AbortSignal) => Promise<RunConsole>;
  readonly pullRequests: (runId: string) => Promise<ReadonlyMap<string, PullRequestSummary>>;
  readonly controls: (runId: string, signal: AbortSignal) => Promise<RunControlList>;
  readonly dryRun: (signal: AbortSignal) => Promise<DryRunPolicy>;
}

/** The REST reads, under the session. */
const SESSION_READS: FirstLoopReads = {
  console: (runId, signal) => runs.console(runId, anonymousApi(), signal),
  pullRequests: (runId) => pullRequests.forRuns([runId], anonymousApi()),
  controls: (runId, signal) => runs.controls(runId, anonymousApi(), signal),
  dryRun: (signal) => dryRunPolicy.read(anonymousApi(), signal),
};

/**
 * Which limit a system abort named, when the run's budget stopped it.
 *
 * @param list The run's controls, newest first.
 * @returns The limit, or null when no budget abort was filed.
 */
export function budgetOf(list: RunControlList): BudgetLimit | null {
  for (const control of list.controls) {
    const limit = control.kind === "abort" && control.detail !== null ? BUDGET_DETAILS[control.detail] : undefined;

    if (limit !== undefined) return limit;
  }

  return null;
}

/**
 * Read the wizard's first loop for its poll (BD.1, #396): the run console's read of the run, the
 * run's pull request — looked up by run, never by number — whether its budget stopped it, and the
 * dry-run policy that says why its PR is a draft. The run is the one the session's workspace
 * names; another workspace's id answers as REST answers it (404).
 *
 * @param runId The run, from `refs.firstRun.id`, or null when the request named none.
 * @param reads The reads; REST under the session unless a test stands them in.
 * @returns The poll's answer.
 */
export async function readFirstLoop(
  runId: string | null,
  reads: FirstLoopReads = SESSION_READS,
): Promise<PollAnswer<FirstLoop>> {
  if (runId === null || !isPullRequestId(runId)) {
    return { state: "failed", reason: FIRST_LOOP_RUN_MISSING, pollAfterSeconds: null };
  }

  return readForPoll(async (signal) => {
    const [console, prs, controls, dryRun] = await Promise.all([
      reads.console(runId, signal),
      reads.pullRequests(runId),
      reads.controls(runId, signal).catch(() => ({ controls: [] })),
      reads.dryRun(signal).catch(() => null),
    ]);

    return {
      console,
      pullRequest: prs.get(runId) ?? null,
      budget: budgetOf(controls),
      dryRun,
    };
  }, UNREACHABLE_FIRST_LOOP);
}
