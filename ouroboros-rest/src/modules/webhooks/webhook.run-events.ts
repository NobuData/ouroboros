/**
 * The `run.*` and `pr.merged` events, written by the run plane in the transaction that moves the
 * run (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * POST /internal/runs              ingest.service      run.opened
 * console abort acknowledged       controls.repository run.canceled
 * merge executor finalizes         merge.repository    run.merged + pr.merged
 * ```
 *
 * Each caller already holds the transaction its `update`/`insert` runs in and passes it here, so
 * the event exists exactly when the transition does. Like {@link enqueueWebhookEvents}, this file
 * imports only the schema's types, so any repository can call it.
 */

import type { Run } from "../db/schema";
import { enqueueWebhookEvents, type OutboxExecutor } from "./webhook.outbox";
import {
  PR_MERGED_EVENT,
  RUN_CANCELED_EVENT,
  RUN_MERGED_EVENT,
  RUN_OPENED_EVENT,
} from "./webhook.registry";

/** The run columns an event carries. */
export type RunEventRow = Pick<
  Run,
  | "id"
  | "organization_id"
  | "loop_seq"
  | "github_repo_id"
  | "issue_number"
  | "status"
  | "pr_number"
  | "started_at"
  | "finished_at"
>;

/** The columns to `returning` so a write can hand its row straight here. */
export const RUN_EVENT_COLUMNS = [
  "id",
  "organization_id",
  "loop_seq",
  "github_repo_id",
  "issue_number",
  "status",
  "pr_number",
  "started_at",
  "finished_at",
] as const;

/** Which transition happened. */
export type RunTransition = "opened" | "canceled" | "merged";

/** The types each transition is published as. */
const TYPES: Readonly<Record<RunTransition, readonly string[]>> = {
  opened: [RUN_OPENED_EVENT],
  canceled: [RUN_CANCELED_EVENT],
  merged: [RUN_MERGED_EVENT, PR_MERGED_EVENT],
};

/**
 * What a run event's `data` says — facts of the run, no transcript, no spend.
 *
 * @param run - The run as written.
 * @returns The data.
 */
export function runEventData(run: RunEventRow): Record<string, unknown> {
  return {
    runId: run.id,
    loopSeq: run.loop_seq,
    repositoryId: run.github_repo_id,
    issueNumber: run.issue_number,
    status: run.status,
    prNumber: run.pr_number,
    startedAt: run.started_at.toISOString(),
    finishedAt: run.finished_at?.toISOString() ?? null,
  };
}

/**
 * Queue a run transition's events, inside the transaction that made it.
 *
 * @param executor - That transaction.
 * @param transition - Which transition.
 * @param run - The run as the write returned it.
 * @param at - When it happened; the run's own timestamp by default.
 */
export async function enqueueRunEvent(
  executor: OutboxExecutor,
  transition: RunTransition,
  run: RunEventRow,
  at: Date = run.finished_at ?? run.started_at,
): Promise<void> {
  await enqueueWebhookEvents(executor, {
    organizationId: run.organization_id,
    types: TYPES[transition],
    data: runEventData(run),
    occurredAt: at,
  });
}
