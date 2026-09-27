/**
 * Where an evidence system tells the gate engine something changed — the seam the four emitters
 * call and the engine fills.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)). The same shape as AP.1's
 * `GUARDRAIL_SCHEDULER`: each emitter depends on this interface and token only, never on the
 * engine, so `.dependency-cruiser.cjs`'s `no-circular` holds and an emitter's suite needs no gate
 * engine at all.
 *
 * ```
 * test run parsed    (farm/artifacts/upload.service.ts, #329)  ─┐
 * build job finished (farm/gateway/agent.connection.ts, #252)  ─┼─▶ notify(event) ─▶ affected gates only
 * guardrail evaluated (ingest/ingest.service.ts, #305)          ─┤
 * revision pushed    (pull-requests/pr-sync.service.ts, #357)  ─┘   (a sync without a push: pr_synced)
 * ```
 *
 * **Called after commit, and never failing its caller.** Every emitter notifies once its own
 * transaction has committed — the engine reads on its own connection and must see the evidence —
 * and `notify` resolves even when evaluation fails: a gate that could not be re-evaluated is a
 * logged problem, not a lost test report or build result.
 */

import type { BuiltInGateKey } from "../../db/schema";

/** A revision was recorded — every gate of the PR is re-evaluated. */
export interface RevisionPushedEvent {
  readonly kind: "revision_pushed";
  /** `pull_requests.id`. */
  readonly prId: string;
}

/**
 * A PR was synced without a new push — its definitions are re-materialized, any gate never
 * evaluated on the revision is evaluated, and its state is brought in line; nothing else moves.
 */
export interface PrSyncedEvent {
  readonly kind: "pr_synced";
  /** `pull_requests.id`. */
  readonly prId: string;
}

/** A test attempt's results were parsed. */
export interface TestRunParsedEvent {
  readonly kind: "test_run_parsed";
  /** `test_runs.id`. */
  readonly testRunId: string;
}

/** A farm job reached a terminal status. */
export interface BuildJobFinishedEvent {
  readonly kind: "build_job_finished";
  /** `build_jobs.id`. */
  readonly jobId: string;
}

/** A run's change-set was judged by the guardrails. */
export interface GuardrailEvaluatedEvent {
  readonly kind: "guardrail_evaluated";
  /** `runs.id`. */
  readonly runId: string;
}

/** Something that may change a gate's verdict. */
export type GateEvidenceEvent =
  | RevisionPushedEvent
  | PrSyncedEvent
  | TestRunParsedEvent
  | BuildJobFinishedEvent
  | GuardrailEvaluatedEvent;

/**
 * Which gates each event can move — the "affected gates only" rule. A revision push moves them
 * all, because every gate is judged per revision.
 */
export const AFFECTED_GATES: Readonly<
  Record<GateEvidenceEvent["kind"], readonly BuiltInGateKey[] | "all">
> = Object.freeze({
  revision_pushed: "all",
  pr_synced: [] as const,
  test_run_parsed: ["test_suite", "physical_hil"] as const,
  build_job_finished: ["build"] as const,
  guardrail_evaluated: ["secrets_license"] as const,
});

/** What an emitter calls. */
export interface GateEvidenceSink {
  /**
   * Re-evaluate the gates an event can move, on every open PR it concerns.
   *
   * @param organizationId - The workspace the evidence belongs to; nothing outside it is read.
   * @param event - What changed.
   * @returns When evaluation has finished. Never rejects.
   */
  notify(organizationId: string, event: GateEvidenceEvent): Promise<void>;
}

/** The injection token. Emitters take it `@Optional()`, so a context without the engine still boots. */
export const GATE_EVIDENCE = Symbol("GATE_EVIDENCE");
