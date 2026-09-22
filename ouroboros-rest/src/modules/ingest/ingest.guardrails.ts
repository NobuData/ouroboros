/**
 * Where a reported change-set becomes four guardrail verdicts — the seam AP.3 fills.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)) has this acceptance
 * criterion:
 *
 * > A file report triggers guardrail evaluation; a run with no file changes triggers none.
 *
 * and AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)) is what *answers* the
 * four checks: allowed paths against the pinned stage's scope, CI-config detection, the
 * embedded secrets ruleset (option **3-A**), and review-required from workflow policy and
 * routing votes. That service lives in `guardrails/` and is bound to
 * {@link GUARDRAIL_SCHEDULER} by `GuardrailsModule`; this file keeps only the contract between
 * the two, so the ingestion service depends on an interface and never on the evaluator.
 *
 * AP.1 shipped a scheduler that wrote the four rows as `pending` — V048's word for *"a check
 * that has been scheduled and has not answered"*. AP.3 replaced it, and nothing in the ingestion
 * service moved: the trigger point, the transaction it runs in, the `change_set_seq` it is
 * given and the *"no files, no evaluation"* rule are all still AP.1's.
 *
 * **It runs inside the report's transaction**, and that is deliberate rather than incidental.
 * A change-set and the verdicts about it are one fact: a report that committed without its
 * checks would leave the card showing the *previous* report's verdicts beside the new files,
 * which is precisely the drift `change_set_seq` exists to make visible. AP.3 measured the
 * evaluation against its ≤ 50 ms budget and kept it here.
 */

import { Inject } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";

import type { Database, GuardrailCheck } from "../db/schema";

/**
 * The connection a scheduler writes through.
 *
 * A `Transaction` in practice and typed as either, so the contract is *"use the handle you
 * are given"* rather than *"take your own connection"* — the one mistake that would put the
 * verdicts outside the report's transaction.
 */
export type GuardrailWriter = Kysely<Database> | Transaction<Database>;

/** What a scheduler is told about the report it is judging. */
export interface GuardrailRequest {
  /** The run whose change-set this is. */
  readonly runId: string;
  /**
   * Which report — `runs.change_set_seq` after the write, from 1.
   *
   * Carried onto every row written, which is what makes re-evaluation history read as a
   * sequence rather than as a pile.
   */
  readonly changeSetSeq: number;
  /** How many files the change-set holds. Never zero: the caller does not schedule for none. */
  readonly files: number;
  /**
   * The reported change-set itself — every path, and the diff hunks the report carried.
   *
   * The hunks are what the secrets check scans, and they exist **only here**: the report writes
   * paths and counts to `run_files` and nothing else, so a credential in a hunk is read in
   * memory and dropped with the request.
   */
  readonly changeSet: readonly GuardrailFile[];
}

/** One line of a reported hunk — the transcript's three kinds (V046, decision R3). */
export interface GuardrailHunkLine {
  /** `ctx` was there before, `del` is leaving, `add` is new. */
  readonly kind: "ctx" | "del" | "add";
  /** The text, without its diff marker. */
  readonly text: string;
}

/** One reported hunk. */
export interface GuardrailHunk {
  /** The new-file line the hunk's first line sits at, from 1. */
  readonly newStart: number;
  /** Its lines, in order. */
  readonly lines: readonly GuardrailHunkLine[];
}

/** One file of the reported change-set, as the evaluator reads it. */
export interface GuardrailFile {
  /** Repository-relative, held to V047's grammar by the DTO. */
  readonly path: string;
  /** The file's hunks, when the report carried them. */
  readonly hunks?: readonly GuardrailHunk[];
}

/** What judging a change-set produced, as the ingestion service reports it. */
export interface GuardrailOutcome {
  /** How many checks were written — returned to the caller as `guardrailChecks`. */
  readonly checks: number;
  /**
   * The checks that failed, in the card's order.
   *
   * Non-empty is the `needs_human` flag: the change-set answer carries it so the executor (and,
   * with AR.1, the enforcement that stops a stage) can act on it. Evaluation does not move
   * `runs.status` itself — see `guardrails.checks.ts`.
   */
  readonly failures: readonly GuardrailCheck[];
}

/**
 * What a change-set report triggers.
 *
 * An interface with an injection token rather than a concrete class, so the ingestion service
 * depends on the contract and a test of *"a report with no files evaluates nothing"* can watch
 * a double rather than count rows.
 */
export interface GuardrailScheduler {
  /**
   * Judge the four checks for one report.
   *
   * @param writer - The report's own transaction. Every statement must go through it.
   * @param request - Which run, which report, and the change-set itself.
   * @returns How many checks were written and which of them failed.
   */
  evaluate(writer: GuardrailWriter, request: GuardrailRequest): Promise<GuardrailOutcome>;
}

/**
 * The injection token.
 *
 * A symbol-free string constant, matching how the rest of this service names tokens, and
 * namespaced so it cannot collide with a token a library registers.
 */
export const GUARDRAIL_SCHEDULER = "ouroboros:ingest:guardrail-scheduler";

/** Inject the scheduler. */
export const InjectGuardrailScheduler = (): ParameterDecorator => Inject(GUARDRAIL_SCHEDULER);
