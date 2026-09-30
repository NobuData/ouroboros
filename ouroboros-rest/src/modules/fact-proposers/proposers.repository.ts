/**
 * The proposers' statements (BF.3, [#412](https://github.com/NobuData/ouroboros/issues/412)).
 *
 * Reads a source by id — a classification, a waiver, a steer — with the run, repository and PR
 * around it; lists a run's sources for the backfill; reads the facts a candidate dedupes against;
 * and appends V074's `fact_suppressions`. The fact itself is written by `FactsService.propose`,
 * the lifecycle's own entry point, so a proposed fact is born by exactly the statement a
 * hand-written one is.
 *
 * **Every read is keyed by the workspace.** A classification, waiver or steer of another
 * workspace reads as absent — the service answers `source_not_found`, never another tenant's text.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { FactStatus, FactSuppression, PrGateKey } from "../db/schema";
import type { FactProvenanceRef } from "../facts/facts.resources";
import { normalizeFactText } from "../facts/facts.text";
import type {
  CorrectionNoteSource,
  SourceRun,
  SteerSource,
  WaiverSource,
} from "./proposers.registry";
import type { FactCandidate, LoadableProposerKind } from "./proposers.types";

/** The gates a case waiver counts toward — the two providers that read waived case keys. */
export const CASE_WAIVER_GATE_KEYS: readonly PrGateKey[] = ["test_suite", "physical_hil"];

/** An existing fact a candidate may match. */
export interface ExistingFact {
  readonly id: string;
  readonly status: FactStatus;
}

/** A source of one run, for the backfill. */
export interface RunSourceRef {
  readonly kind: LoadableProposerKind;
  readonly id: string;
}

/** A suppression to record. */
export interface NewSuppression {
  readonly candidate: FactCandidate;
  readonly normalizedText: string;
  readonly matchedFactId: string;
  readonly sourceKey: string;
}

/** What `FactProposersService` reads and writes through — a seam its suite fakes. */
export interface ProposerStore {
  correctionNote(organizationId: string, id: string): Promise<CorrectionNoteSource | undefined>;
  waiver(organizationId: string, id: string): Promise<WaiverSource | undefined>;
  steer(organizationId: string, id: string): Promise<SteerSource | undefined>;
  runExists(organizationId: string, runId: string): Promise<boolean>;
  runSources(organizationId: string, runId: string): Promise<RunSourceRef[]>;
  factsByText(organizationId: string, repoRef: string | null): Promise<Map<string, ExistingFact>>;
  factCiting(organizationId: string, ref: FactProvenanceRef): Promise<string | undefined>;
  insertSuppression(organizationId: string, suppression: NewSuppression): Promise<string>;
  suppressions(organizationId: string, limit: number): Promise<FactSuppression[]>;
}

@Injectable()
export class ProposerRepository implements ProposerStore {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A classification, with its run.
   *
   * @param organizationId - The workspace.
   * @param id - `failure_classifications.id`.
   * @returns The source, or undefined when absent or another workspace's.
   */
  async correctionNote(
    organizationId: string,
    id: string,
  ): Promise<CorrectionNoteSource | undefined> {
    const row = await this.database.db
      .selectFrom("failure_classifications as fc")
      .innerJoin("test_cases as tc", "tc.id", "fc.test_case_id")
      .innerJoin("test_suites as ts", "ts.id", "tc.test_suite_id")
      .innerJoin("test_runs as tr", "tr.id", "ts.test_run_id")
      .select(["fc.id", "fc.note", "fc.actor", "tr.run_id as runId"])
      .where("fc.id", "=", id)
      .where("fc.organization_id", "=", organizationId)
      .executeTakeFirst();

    if (row === undefined) return undefined;

    const run = await this.sourceRun(organizationId, row.runId);

    return run === undefined
      ? undefined
      : { classificationId: row.id, note: row.note, actor: row.actor, run };
  }

  /**
   * A waiver, with its run and the PR gates its cases count toward.
   *
   * @param organizationId - The workspace.
   * @param id - `pr_waivers.id`.
   * @returns The source, or undefined when absent or another workspace's.
   */
  async waiver(organizationId: string, id: string): Promise<WaiverSource | undefined> {
    const row = await this.database.db
      .selectFrom("pr_waivers")
      .select(["id", "reason", "run_id as runId", "case_keys as caseKeys"])
      .where("id", "=", id)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    if (row === undefined) return undefined;

    const run = await this.sourceRun(organizationId, row.runId);

    if (run === undefined) return undefined;

    // A criterion waiver (no cases) waives a criterion, not a gate.
    const gates =
      run.pullRequest === null || row.caseKeys.length === 0
        ? []
        : await this.database.db
            .selectFrom("pr_gate_definitions")
            .select("id")
            .where("pr_id", "=", run.pullRequest.id)
            .where("gate_key", "in", CASE_WAIVER_GATE_KEYS)
            .orderBy("sort_order")
            .orderBy("gate_key")
            .execute();

    return { waiverId: row.id, reason: row.reason, gateIds: gates.map((g) => g.id), run };
  }

  /**
   * A steer, with its run, the stage it was asked in, and who asked while still a member.
   *
   * @param organizationId - The workspace.
   * @param id - `run_controls.id` of kind `steer`.
   * @returns The source, or undefined when absent, not a steer, or another workspace's.
   */
  async steer(organizationId: string, id: string): Promise<SteerSource | undefined> {
    const row = await this.database.db
      .selectFrom("run_controls as rc")
      .innerJoin("runs as r", "r.id", "rc.run_id")
      .select([
        "rc.id",
        "rc.payload",
        "rc.remember",
        "rc.requested_by as requestedBy",
        "rc.requested_at as requestedAt",
        "rc.run_id as runId",
      ])
      .where("rc.id", "=", id)
      .where("rc.kind", "=", "steer")
      .where("r.organization_id", "=", organizationId)
      .executeTakeFirst();

    if (row === undefined) return undefined;

    const [run, stage, member] = await Promise.all([
      this.sourceRun(organizationId, row.runId),
      this.database.db
        .selectFrom("run_stages")
        .select(["id", "stage_label as label"])
        .where("run_id", "=", row.runId)
        .where("started_at", "<=", row.requestedAt)
        .orderBy("started_at", "desc")
        .orderBy("position", "desc")
        .limit(1)
        .executeTakeFirst(),
      row.requestedBy === null
        ? undefined
        : this.database.db
            .selectFrom("member")
            .select("userId")
            .where("organizationId", "=", organizationId)
            .where("userId", "=", row.requestedBy)
            .executeTakeFirst(),
    ]);

    return run === undefined
      ? undefined
      : {
          controlId: row.id,
          payload: row.payload,
          remember: row.remember,
          stage: stage ?? null,
          actorId: member?.userId ?? null,
          run,
        };
  }

  /**
   * @param organizationId - The workspace.
   * @param runId - A run id.
   * @returns Whether it is a run of this workspace.
   */
  async runExists(organizationId: string, runId: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("runs")
      .select("id")
      .where("id", "=", runId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Every source of one run a proposer reads: its classifications carrying notes, its waivers,
   * and its steers flagged *remember this* — oldest first, so a backfill proposes in the order
   * the loop learned.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The sources, by kind and id.
   */
  async runSources(organizationId: string, runId: string): Promise<RunSourceRef[]> {
    const [classifications, waivers, steers] = await Promise.all([
      this.database.db
        .selectFrom("failure_classifications as fc")
        .innerJoin("test_cases as tc", "tc.id", "fc.test_case_id")
        .innerJoin("test_suites as ts", "ts.id", "tc.test_suite_id")
        .innerJoin("test_runs as tr", "tr.id", "ts.test_run_id")
        .select(["fc.id", "fc.created_at as at"])
        .where("tr.run_id", "=", runId)
        .where("fc.organization_id", "=", organizationId)
        .where("fc.note", "is not", null)
        .execute(),
      this.database.db
        .selectFrom("pr_waivers")
        .select(["id", "created_at as at"])
        .where("run_id", "=", runId)
        .where("organization_id", "=", organizationId)
        .execute(),
      this.database.db
        .selectFrom("run_controls as rc")
        .innerJoin("runs as r", "r.id", "rc.run_id")
        .select(["rc.id", "rc.requested_at as at"])
        .where("rc.run_id", "=", runId)
        .where("r.organization_id", "=", organizationId)
        .where("rc.kind", "=", "steer")
        .where("rc.remember", "=", true)
        .execute(),
    ]);

    return [
      ...classifications.map((row) => ({ kind: "correction_note" as const, ...row })),
      ...waivers.map((row) => ({ kind: "waiver" as const, ...row })),
      ...steers.map((row) => ({ kind: "steer" as const, ...row })),
    ]
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))
      .map(({ kind, id }) => ({ kind, id }));
  }

  /**
   * The facts a candidate dedupes against, keyed by normalized text — **every status**, rejected
   * and expired included, so a fact somebody turned down is not proposed again. The repository's
   * facts and the workspace-wide ones; a workspace-wide candidate is compared with them all.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The candidate's repository, or null for the whole workspace.
   * @returns The oldest fact per normalized text.
   */
  async factsByText(
    organizationId: string,
    repoRef: string | null,
  ): Promise<Map<string, ExistingFact>> {
    let query = this.database.db
      .selectFrom("facts")
      .select(["id", "text", "status"])
      .where("organization_id", "=", organizationId);

    if (repoRef !== null) {
      query = query.where((eb) =>
        eb.or([eb("repo_ref", "=", repoRef), eb("repo_ref", "is", null)]),
      );
    }

    const rows = await query.orderBy("created_at").orderBy("id").execute();
    const byText = new Map<string, ExistingFact>();

    for (const row of rows) {
      const key = normalizeFactText(row.text);

      if (!byText.has(key)) byText.set(key, { id: row.id, status: row.status });
    }

    return byText;
  }

  /**
   * A fact already citing a source — so a second pass over it proposes nothing.
   *
   * @param organizationId - The workspace.
   * @param ref - The source's provenance ref.
   * @returns The fact's id, or undefined.
   */
  async factCiting(organizationId: string, ref: FactProvenanceRef): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("facts")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where(sql<boolean>`provenance -> 'refs' @> ${JSON.stringify([ref])}::jsonb`)
      .orderBy("created_at")
      .limit(1)
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * Record a suppression — once per source and matched fact (`fact_suppressions_source_fact_key`).
   *
   * @param organizationId - The workspace.
   * @param suppression - The candidate, its key, the fact it matched and its source.
   * @returns The suppression's id — the existing one on a repeat.
   */
  async insertSuppression(organizationId: string, suppression: NewSuppression): Promise<string> {
    const { candidate } = suppression;
    const inserted = await this.database.db
      .insertInto("fact_suppressions")
      .values({
        organization_id: organizationId,
        repo_ref: candidate.repoRef,
        proposer: candidate.proposer,
        proposer_version: candidate.proposerVersion,
        text: candidate.text,
        normalized_text: suppression.normalizedText,
        matched_fact_id: suppression.matchedFactId,
        provenance: JSON.stringify(candidate.provenance),
        source_key: suppression.sourceKey,
      })
      .onConflict((oc) =>
        oc.columns(["organization_id", "source_key", "matched_fact_id"]).doNothing(),
      )
      .returning("id")
      .executeTakeFirst();

    if (inserted !== undefined) return inserted.id;

    const existing = await this.database.db
      .selectFrom("fact_suppressions")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("source_key", "=", suppression.sourceKey)
      .where("matched_fact_id", "=", suppression.matchedFactId)
      .executeTakeFirstOrThrow();

    return existing.id;
  }

  /**
   * The workspace's suppressions, newest first.
   *
   * @param organizationId - The workspace.
   * @param limit - At most this many.
   * @returns The rows.
   */
  suppressions(organizationId: string, limit: number): Promise<FactSuppression[]> {
    return this.database.db
      .selectFrom("fact_suppressions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .execute();
  }

  /**
   * The run around a source: its loop number, repository and PR.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The run, or undefined when it is not this workspace's.
   */
  private async sourceRun(organizationId: string, runId: string): Promise<SourceRun | undefined> {
    const [run, pr] = await Promise.all([
      this.database.db
        .selectFrom("runs")
        .innerJoin("github_repos", "github_repos.id", "runs.github_repo_id")
        .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
        .select([
          "runs.id",
          "runs.loop_seq as loopSeq",
          sql<string>`lower(${sql.ref("github_orgs.login")} || '/' || ${sql.ref("github_repos.name")})`.as(
            "repoRef",
          ),
        ])
        .where("runs.id", "=", runId)
        .where("runs.organization_id", "=", organizationId)
        .executeTakeFirst(),
      this.database.db
        .selectFrom("pull_requests")
        .select(["id", "external_number as number"])
        .where("run_id", "=", runId)
        .where("organization_id", "=", organizationId)
        .orderBy("created_at", "desc")
        .orderBy("id")
        .limit(1)
        .executeTakeFirst(),
    ]);

    return run === undefined ? undefined : { ...run, pullRequest: pr ?? null };
  }
}
