/**
 * The statements two writers share: numbering a job, counting its attempts, and creating the
 * automatic retry of an infrastructure failure.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). Dispatch is not the only
 * writer that ends an attempt. The gateway's `job.finish` does too (`gateway.repository.ts`), and
 * an `errored` finish has to become `retried` **and** create its successor in the transaction
 * that records the frame — record, then answer: a receipt written for a retry that was never
 * created would be a build nobody runs. So the retry is a function over a transaction rather than
 * a method of either repository, and both call it.
 *
 * This file imports nothing from the gateway, which is what lets the gateway import it.
 *
 * ---------------------------------------------------------------------------
 * **A job's number is allocated under a per-workspace advisory lock**, not by retrying on a
 * unique violation as `queue.repository.ts` does for a position. The difference is where the
 * insert happens: a retry is created inside the terminal-frame ledger's transaction, and a
 * collision there would roll the ledger row back with it — the finish would have to be re-sent to
 * be recorded at all. The lock is `pg_advisory_xact_lock`, so it is released with the transaction
 * and never outlives a crash, and it is keyed by workspace, so one workspace's burst of
 * submissions never waits on another's.
 */

import { sql, type Kysely, type Transaction } from "kysely";

import type { BuildJob, Database } from "../../db/schema";
import { AUTOMATIC_RETRIES } from "./dispatch.policy";

/** The advisory-lock namespace a workspace's job numbering is serialised under. */
const NUMBER_LOCK = "ouroboros.build_jobs.number";

/** A retry chain longer than this is not one dispatch built — the walk stops rather than spin. */
const MAX_CHAIN = 64;

/**
 * The next job number in a workspace — mockup 08's `#483` after `#482`.
 *
 * @param trx - The transaction the job will be inserted in. The lock is held until it ends.
 * @param organizationId - The workspace.
 * @returns `max(number) + 1`, or `1` for a workspace's first build.
 */
export async function allocateNumber(
  trx: Transaction<Database>,
  organizationId: string,
): Promise<number> {
  await sql`select pg_advisory_xact_lock(hashtext(${NUMBER_LOCK}), hashtext(${organizationId}))`.execute(
    trx,
  );

  const row = await trx
    .selectFrom("build_jobs")
    .select(({ fn }) => fn.max<number>("number").as("last"))
    .where("organization_id", "=", organizationId)
    .executeTakeFirst();

  return (row?.last ?? 0) + 1;
}

/**
 * Which attempt of its build a job is: 1, or one more than the job it retries.
 *
 * @param trx - A transaction, or the database.
 * @param organizationId - The workspace.
 * @param jobId - The job.
 * @returns The length of its `retry_of` chain, counting itself.
 */
export async function attemptOf(
  trx: Kysely<Database>,
  organizationId: string,
  jobId: string,
): Promise<number> {
  const { rows } = await sql<{ attempt: number | null }>`
    with recursive chain (id, retry_of, depth) as (
      select id, retry_of, 1
        from ouroboros.build_jobs
       where id = ${jobId} and organization_id = ${organizationId}
      union all
      select parent.id, parent.retry_of, chain.depth + 1
        from ouroboros.build_jobs parent
        join chain on parent.id = chain.retry_of
       where parent.organization_id = ${organizationId} and chain.depth < ${MAX_CHAIN}
    )
    select max(depth)::integer as attempt from chain`.execute(trx);

  return rows[0]?.attempt ?? 1;
}

/**
 * What an infrastructure-classed failure does to an attempt — the retry policy.
 *
 * @param attempt - The attempt that failed, from {@link attemptOf}.
 * @returns `retried` while the automatic retries are not used up, `failed` once they are.
 */
export function infrastructureOutcome(attempt: number): "retried" | "failed" {
  return attempt <= AUTOMATIC_RETRIES ? "retried" : "failed";
}

/**
 * Create the attempt that replaces one whose infrastructure failed: a new job, waiting in the
 * same pool, carrying the same snapshot — what was built, under which executor, image and
 * command — and `retry_of` naming its predecessor.
 *
 * The predecessor keeps its `retried` status, which is what mockup 08's `3 retried` counts; this
 * row is an ordinary attempt and joins `19 clean` if it works.
 *
 * @param trx - The transaction that marked the predecessor `retried`.
 * @param failed - The predecessor, as it was read.
 * @param at - When it was retried; the new attempt's `queued_at`.
 * @returns The new attempt.
 */
export async function insertRetryAttempt(
  trx: Transaction<Database>,
  failed: BuildJob,
  at: Date,
): Promise<BuildJob> {
  const number = await allocateNumber(trx, failed.organization_id);

  return trx
    .insertInto("build_jobs")
    .values({
      organization_id: failed.organization_id,
      number,
      pool_id: failed.pool_id,
      run_id: failed.run_id,
      github_repo_id: failed.github_repo_id,
      git_ref: failed.git_ref,
      commit_sha: failed.commit_sha,
      label: failed.label,
      title: failed.title,
      executor: failed.executor,
      image: failed.image,
      command: failed.command,
      env: failed.env ?? {},
      status: "queued",
      queued_at: at,
      retry_of: failed.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
