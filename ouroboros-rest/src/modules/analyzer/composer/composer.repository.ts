/**
 * The suggestion composer's reads and its one write (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)).
 *
 *   * the run's findings (`analysis_findings`, V081);
 *   * the repository's calibration factors (`analyzer_calibration`, V085) — no row means 1;
 *   * runner-pool and runner names, so a binding names what a person recognises;
 *   * `record_analysis_suggestion()` (V081, V087) — the upsert on the derived identity that makes
 *     re-analysis update rather than duplicate, and keeps a dismissed suggestion dismissed.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { ComposedSuggestion, ComposerFinding, FindingConfidenceBasis } from "./composer.types";

/** One calibration factor, keyed `analyzer/impact_class`. */
export type CalibrationFactors = ReadonlyMap<string, number>;

/**
 * The key a calibration factor is held under.
 *
 * @param analyzer - The analyzer.
 * @param impactClass - The impact class.
 * @returns `analyzer/impact_class`.
 */
export function calibrationKey(analyzer: string, impactClass: string): string {
  return `${analyzer}/${impactClass}`;
}

@Injectable()
export class ComposerRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every finding a run wrote.
   *
   * @param runId - The run.
   * @returns Its findings, in subject order.
   */
  async findingsOf(runId: string): Promise<ComposerFinding[]> {
    const rows = await this.database.db
      .selectFrom("analysis_findings")
      .select([
        "id",
        "analyzer",
        "analyzer_version",
        "finding_type",
        "subject_key",
        "identity_key",
        "data",
        "confidence",
        "confidence_basis",
      ])
      .where("run_id", "=", runId)
      .orderBy("analyzer")
      .orderBy("subject_key")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      analyzer: row.analyzer,
      analyzerVersion: row.analyzer_version,
      findingType: row.finding_type,
      subjectKey: row.subject_key,
      identityKey: row.identity_key,
      data: (row.data ?? {}) as Record<string, unknown>,
      confidence: row.confidence,
      confidenceBasis: row.confidence_basis as FindingConfidenceBasis,
    }));
  }

  /**
   * A repository's calibration factors.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns Factors by `analyzer/impact_class`; a pair with no row is absent (factor 1).
   */
  async calibration(organizationId: string, repoRef: string): Promise<CalibrationFactors> {
    const { rows } = await sql<{ analyzer: string; impact_class: string; factor: string }>`
      select analyzer, impact_class, factor::text as factor
        from ouroboros.analyzer_calibration
       where organization_id = ${organizationId} and repo_ref = ${repoRef}`.execute(
      this.database.db,
    );

    return new Map(
      rows.map((row) => [calibrationKey(row.analyzer, row.impact_class), Number(row.factor)]),
    );
  }

  /**
   * The workspace's runner-pool and runner names, by id.
   *
   * @param organizationId - The workspace.
   * @returns Pool and runner names.
   */
  async names(
    organizationId: string,
  ): Promise<{ pools: ReadonlyMap<string, string>; runners: ReadonlyMap<string, string> }> {
    const pools = await sql<{ id: string; name: string }>`
      select id::text as id, name from ouroboros.runner_pools
       where organization_id = ${organizationId}`.execute(this.database.db);
    const runners = await sql<{ id: string; name: string }>`
      select id::text as id, name from ouroboros.runners
       where organization_id = ${organizationId}`.execute(this.database.db);

    return {
      pools: new Map(pools.rows.map((row) => [row.id, row.name])),
      runners: new Map(runners.rows.map((row) => [row.id, row.name])),
    };
  }

  /**
   * Record one composed suggestion — insert, or update the one with the same identity.
   *
   * @param runId - The run that composed it.
   * @param composed - The suggestion.
   * @returns The suggestion's id.
   * @throws Whatever the database refused (`analysis_suggestions_*`); the caller logs it.
   */
  async record(runId: string, composed: ComposedSuggestion): Promise<string> {
    const { rows } = await sql<{ id: string }>`
      select ouroboros.record_analysis_suggestion(
        ${runId}::uuid, ${composed.kind}, ${composed.findingIds}::uuid[], ${composed.title},
        ${composed.evidenceLine}, ${composed.confidence}::integer,
        ${composed.impact === null ? null : JSON.stringify(composed.impact)}::jsonb,
        ${JSON.stringify(composed.actionBinding)}::jsonb, ${composed.needsSpike},
        ${JSON.stringify(composed.confidenceBasis)}::jsonb) as id`.execute(this.database.db);

    return rows[0].id;
  }
}
