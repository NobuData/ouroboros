/**
 * What the ingestion contract answers with — six shapes, and one property that binds them
 * all.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)): *"duplicate keys are
 * no-ops returning the original result"*. The original result is stored in
 * `run_ingest_receipts.response` as `jsonb` and handed back on a replay — so every type here
 * must be **exactly** what survives a round trip through PostgreSQL's `jsonb`:
 *
 *   * strings, numbers, booleans, `null`, and objects of those;
 *   * **no `Date`** — every instant is an ISO 8601 string, as in every contract this service
 *     publishes, and a `Date` would come back from `jsonb` as a string anyway, so a replay
 *     and a first answer would differ in type;
 *   * **no `undefined`** — an absent fact is an omitted key, which `jsonb` and
 *     `JSON.stringify` agree about, where `undefined` is a value only one of them has.
 *
 * That constraint is why these are plain interfaces with a mapper each rather than the row
 * types: a row carries `Date`s, `numeric` columns as strings, and columns no caller should be
 * shown. `ingest.resources.spec.ts` asserts the round trip on each shape, because *"it looked
 * right in the response"* and *"it survives being stored and returned"* are different claims
 * and only the second one is the contract.
 *
 * ---------------------------------------------------------------------------
 * **Counts rather than echoes.** An event batch answers with how many entries were stored and
 * the sequence numbers they got, not with the entries. A change-set report answers with the
 * totals, not with the files. The caller sent those; repeating them doubles the largest
 * responses on the surface and tells nobody anything. What it *cannot* know — the dense `seq`
 * V046 allocated, the change-set number V049 allocated, whether a cap elided anything — is
 * what comes back.
 */

import type { RunMergeStrategy, RunStageReturnKind, RunStageStatus } from "../db/schema";

/** `POST /internal/runs` — the run that was opened. */
export interface RunOpenedResource {
  /** `runs.id`, which every later report is addressed to. */
  readonly id: string;
  /**
   * The *Loop #1847* counter — `runs.loop_seq`, allocated by the database.
   *
   * Returned because it is the number a person reads and the executor cannot compute: it is
   * per workspace, allocated under a lock, and not derivable from anything the caller sent.
   */
  readonly loopSeq: number;
  /**
   * The workspace the run belongs to.
   *
   * Published for the reason the lease publishes it: the caller has to attribute what it does
   * next to the same workspace, and deriving it a second way would be two answers to one
   * question. It is a fact the caller is entitled to — it named the ticket this was resolved
   * from — and it names nothing inside the workspace.
   */
  readonly organizationId: string;
  /** `runs.issue_number` — the ticket's own number, as the console renders it. */
  readonly issueNumber: number;
  /** `runs.issue_title`, frozen at the moment the run opened. */
  readonly issueTitle: string;
  /** `runs.workflow_tag` — the `standard-fix` of `standard-fix v14`. */
  readonly workflowTag: string;
  /** `runs.workflow_version_pin` — the `v14`. */
  readonly workflowVersionPin: number;
  /** `runs.branch_name`, or `null` until the run has one. */
  readonly branchName: string | null;
  /** `runs.merge_strategy`, or `null` when the pinned terminal opens no pull request. */
  readonly mergeStrategy: RunMergeStrategy | null;
  /** `runs.model`. */
  readonly model: string;
  /**
   * Whether this run carries decision R4's watermark.
   *
   * Echoed **because the caller did not send it**. It follows the principal, so this is the
   * service telling a simulator that its run is marked as one — and telling an executor that
   * its run is not. A driver asserting this in its own tests is asserting the rule.
   */
  readonly simulated: boolean;
  /** `runs.status` at creation — `coding`, the first of V008's six. */
  readonly status: string;
  /** `runs.started_at`, ISO 8601. */
  readonly startedAt: string;
}

/** `POST /internal/runs/:id/stage-transitions` — where the stage stands afterwards. */
export interface StageTransitionResource {
  /** `run_stages.id` of the row this transition wrote. */
  readonly runStageId: string;
  /** The DSL node id. */
  readonly stageKey: string;
  /** The node's title as the pin had it — the snapshot, not a live read. */
  readonly stageLabel: string;
  /** Where it sits in the pinned document, from 1. */
  readonly position: number;
  /** Which attempt — the `2` of *attempt 2/3*. */
  readonly attempt: number;
  /** What the pin allows — the `3` — or `null` for a stage type carrying no limits. */
  readonly maxAttempts: number | null;
  /** The stage's token budget at pin time, or `null`. */
  readonly tokenBudget: number | null;
  /** Where the attempt now stands. */
  readonly status: RunStageStatus;
  /**
   * The stepper's warn note — *"attempt 1 failed tests — loop returned from gate ↺"*.
   *
   * Read back from the generated column rather than composed here, which is the point of the
   * criterion: *"the gate return produces a second `Implement` attempt with a **composed**
   * note"*. The caller can see what the database wrote, and nothing on this side of the
   * boundary ever writes a sentence.
   */
  readonly note: string | null;
  /** When the attempt began, ISO 8601, or `null` while it has not. */
  readonly startedAt: string | null;
  /** When it ended, or `null`. */
  readonly finishedAt: string | null;
  /** The loop edge it came back through, or `null`. */
  readonly returnedFrom: StageReturnResource | null;
}

/** The transition a note was composed from. */
export interface StageReturnResource {
  /** The node the loop edge left from. */
  readonly stageKey: string;
  /** What kind of node that was. */
  readonly kind: RunStageReturnKind;
  /** How the previous attempt ended. */
  readonly reason: string;
}

/** `POST /internal/runs/:id/events` — what the transcript did with the batch. */
export interface EventsAppendedResource {
  /** How many entries the batch carried. */
  readonly submitted: number;
  /**
   * How many were stored.
   *
   * Lower than `submitted` when a cap refused some — V046 refuses an entry *whole*, so this
   * is a count of entries and never of bytes. Equal to it in the ordinary case, and the
   * difference is the honest way to tell a caller that its transcript is being elided without
   * making it read the marker.
   */
  readonly stored: number;
  /**
   * The first sequence number allocated, or `null` when nothing was stored.
   *
   * The server's number, not the caller's hint — this is the half of the contract the
   * executor cannot compute, and what AP.2's `?after=` pages by.
   */
  readonly firstSeq: number | null;
  /** The last sequence number allocated, or `null` when nothing was stored. */
  readonly lastSeq: number | null;
  /** The ordering hint this run now stands at — `runs.event_hint`. */
  readonly hint: number;
  /**
   * Whether this run's transcript has been elided.
   *
   * `runs.events_elided_at` being set, which is terminal: once a cap has refused an entry it
   * refuses every later one, so a caller seeing `true` knows that continuing to post is
   * pointless rather than merely lossy.
   */
  readonly elided: boolean;
}

/** `PUT /internal/runs/:id/files` — the change-set as it now stands. */
export interface ChangeSetResource {
  /**
   * Which report this was — `runs.change_set_seq` after the write, from 1.
   *
   * The number the guardrail verdicts of this report carry, so a caller can match a later
   * read of `guardrail_evaluations` to the report that produced it.
   */
  readonly changeSetSeq: number;
  /** How many files the change-set holds now. */
  readonly files: number;
  /** Their additions, summed. */
  readonly additions: number;
  /** Their deletions, summed. */
  readonly deletions: number;
  /**
   * How many guardrail checks this report scheduled.
   *
   * `0` for a report with no files, which is the acceptance criterion *"a run with no file
   * changes triggers none"* stated in the answer rather than only in the table. A caller that
   * wants the verdicts reads them; what it gets here is confirmation that judging happened.
   */
  readonly guardrailChecks: number;
}

/** `POST /internal/runs/:id/commits` — what the commit list did with the report. */
export interface CommitsAppendedResource {
  /** How many commits the report carried. */
  readonly submitted: number;
  /** How many were new. */
  readonly appended: number;
  /**
   * How many were already recorded.
   *
   * `run_commits_run_sha_key` is what makes a re-reported commit a no-op *whatever request it
   * arrives in* — which is a different guarantee from the idempotency key's, and the reason
   * this number is worth returning: a caller re-sending an overlapping range sees exactly how
   * much of it was already known.
   */
  readonly duplicates: number;
  /** The highest `run_commits.seq` this run holds, or `null` when it holds none. */
  readonly lastSeq: number | null;
}

/** `POST /internal/runs/:id/resources` — what the run has spent and what it holds. */
export interface ResourcesReportedResource {
  /** Prompt tokens attributed to this run, in total, after the report. */
  readonly tokensIn: number;
  /** Completion tokens, in total. */
  readonly tokensOut: number;
  /**
   * What it has cost, in cents, as a decimal string — or `null` when nothing is priced.
   *
   * A string for the reason the request field is one: `numeric(14,4)` does not round-trip
   * through a double. `null` rather than `"0"` when every attributed row is unpriced, which is
   * decisions **M7** and **N10**'s *count-only* case — a zero would say *"this run cost
   * nothing"* about a run whose model simply has no price in the catalog.
   */
  readonly costCents: string | null;
  /** How many attributed rows carry no price — what makes the `null` above legible. */
  readonly unpricedEvents: number;
  /** The build job this run holds, or `null`. */
  readonly reservedBuildJobId: string | null;
}
