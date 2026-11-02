import type { DryRunPolicy } from "@/app/api/policies";
import type { PullRequestSummary } from "@/app/api/pull-requests";
import type { RunConsole } from "@/app/api/runs";
import type { FirstLoop } from "@/app/get-started/first-loop-view";

import { summary } from "./pull-requests";
import { runConsole, timelineStage } from "./runs";

/** The first loop's run — the picked issue's first run (BD.1, #396). */
export const FIRST_RUN_ID = "5eed0051-0000-4000-8000-000000000488";

/** When it started. */
export const FIRST_STARTED_AT = "2026-10-23T12:00:00.000Z";

/** The run's first model stage — `refs.firstRun.planStage`. */
export const PLAN_STAGE = "plan";

/**
 * An instant some seconds after the run started.
 *
 * @param seconds How long after.
 * @returns The ISO instant.
 */
export function after(seconds: number): string {
  return new Date(Date.parse(FIRST_STARTED_AT) + seconds * 1000).toISOString();
}

/** The dry-run policy, on. */
export const DRY_RUN_ON: DryRunPolicy = {
  dryRun: true,
  explicit: true,
  reason: "dry-run policy active",
  updatedAt: null,
  updatedBy: null,
};

/**
 * The run console while the plan has posted (1:04) and the loop implements.
 *
 * @param over The run's fields to replace.
 * @param stages The stages, when not the default two.
 * @returns The console.
 */
export function firstConsole(over: Partial<RunConsole["run"]> = {}, stages?: RunConsole["timeline"]["stages"]): RunConsole {
  return runConsole({
    run: { id: FIRST_RUN_ID, issueNumber: 488, status: "coding", stageLabel: "Implement", startedAt: FIRST_STARTED_AT, ...over },
    stages: stages ?? [
      timelineStage(PLAN_STAGE, "Plan", 1, {
        status: "succeeded",
        attempts: [
          { attempt: 1, status: "succeeded", startedAt: after(2), finishedAt: after(64), durationSeconds: 62, note: null },
        ],
      }),
      timelineStage("implement", "Implement", 2, {
        status: "active",
        attempts: [
          { attempt: 1, status: "active", startedAt: after(65), finishedAt: null, durationSeconds: null, note: null },
        ],
      }),
    ],
  });
}

/**
 * The run's draft PR, opened at 3:11.
 *
 * @param over What to change.
 * @returns The summary.
 */
export function firstPullRequest(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return summary({ draft: true, state: "open", createdAt: after(191), mergedAt: null, ...over });
}

/**
 * The first loop, as the poll answers it.
 *
 * @param over What to change.
 * @returns The first loop.
 */
export function firstLoop(over: Partial<FirstLoop> = {}): FirstLoop {
  return { console: firstConsole(), pullRequest: null, budget: null, dryRun: DRY_RUN_ON, ...over };
}
