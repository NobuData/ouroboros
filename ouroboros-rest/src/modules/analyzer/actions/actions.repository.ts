/**
 * The suggestion actions' statements (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514))
 * — **only the analyzer's own tables**: `analysis_suggestions` (V081), `suggestion_measurements`
 * (V085) and `analysis_suggestion_applications` (V088). Every other plane is changed through its
 * service; `actions.boundary.spec.ts` holds this module to that.
 *
 * The suggestion tables are not in `db/schema.ts`, so this is `sql`, as the composer's is.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { ActionBinding, Impact, SuggestionKind } from "../composer/composer.types";

/** One suggestion, as the actions read it. */
export interface SuggestionRow {
  id: string;
  repo_ref: string;
  kind: SuggestionKind;
  title: string;
  evidence_line: string;
  confidence: number;
  impact: Impact | null;
  needs_spike: boolean;
  action_binding: ActionBinding;
  status: "open" | "applied" | "dismissed" | "drafted";
  last_run_id: string | null;
  /** Every evidence reference the cited findings carry, de-duplicated — `{kind, id}`. */
  evidence_refs: { kind: string; id: string }[];
}

/** What a successful apply records, in one transaction. */
export interface AppliedRecord {
  organizationId: string;
  suggestionId: string;
  repoRef: string;
  actorId: string;
  appliedAt: Date;
  eventId: string;
  plane: string;
  change: unknown;
  preview: string;
  target: { kind: string; id: string } & Record<string, unknown>;
  reversal: { action: string; target: Record<string, unknown> };
  measurement: {
    targetMetric: string;
    baseline: unknown;
    predicted: unknown;
  };
}

/** The measurement row an apply wrote. */
export interface MeasurementRow {
  id: string;
  target_metric: string;
  window_days: number;
  baseline: unknown;
  predicted: unknown;
}

@Injectable()
export class ActionsRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One suggestion of the workspace, with its cited findings' evidence references.
   *
   * @param organizationId - The workspace.
   * @param id - The suggestion.
   * @returns The suggestion, or `undefined`.
   */
  async suggestion(organizationId: string, id: string): Promise<SuggestionRow | undefined> {
    const { rows } = await sql<SuggestionRow>`
      select s.id::text as id, s.repo_ref, s.kind, s.title, s.evidence_line, s.confidence,
             s.impact, s.needs_spike, s.action_binding, s.status, s.last_run_id::text as last_run_id,
             coalesce((select jsonb_agg(distinct r)
                         from ouroboros.analysis_suggestion_findings l
                         join ouroboros.analysis_findings f on f.id = l.finding_id
                         cross join lateral jsonb_array_elements(f.evidence_refs) r
                        where l.suggestion_id = s.id), '[]'::jsonb) as evidence_refs
        from ouroboros.analysis_suggestions s
       where s.organization_id = ${organizationId} and s.id = ${id}::uuid`.execute(
      this.database.db,
    );

    return rows[0];
  }

  /**
   * The workspace's measurement window — `analyzer_measurement_policy()` (V085), 14 by default.
   *
   * @param organizationId - The workspace.
   * @returns The window's length in days.
   */
  async windowDays(organizationId: string): Promise<number> {
    const { rows } = await sql<{ window_days: number }>`
      select window_days from ouroboros.analyzer_measurement_policy(${organizationId})`.execute(
      this.database.db,
    );

    return rows[0]?.window_days ?? 14;
  }

  /**
   * Dismiss an open suggestion — against its stable identity, so it stays dismissed across
   * re-analysis (`record_analysis_suggestion` keeps a resolved row's status, V081/V087).
   *
   * @param organizationId - The workspace.
   * @param id - The suggestion.
   * @param actorId - Who dismissed it.
   * @param reason - Why.
   * @param at - When.
   * @returns Whether an open suggestion was dismissed.
   */
  async dismiss(
    organizationId: string,
    id: string,
    actorId: string,
    reason: string,
    at: Date,
  ): Promise<boolean> {
    const { numAffectedRows } = await sql`
      update ouroboros.analysis_suggestions
         set status = 'dismissed', resolved_by = ${actorId}, resolved_at = ${at},
             resolution_reason = ${reason}
       where organization_id = ${organizationId} and id = ${id}::uuid and status = 'open'`.execute(
      this.database.db,
    );

    return (numAffectedRows ?? 0n) > 0n;
  }

  /**
   * Mark suggestions drafted into a planning batch.
   *
   * @param organizationId - The workspace.
   * @param ids - The suggestions.
   * @param batchId - The batch (#272).
   * @param actorId - Who drafted them.
   * @param at - When.
   * @returns The ids that moved — an id that was no longer open is absent.
   */
  async markDrafted(
    organizationId: string,
    ids: readonly string[],
    batchId: string,
    actorId: string,
    at: Date,
  ): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      update ouroboros.analysis_suggestions
         set status = 'drafted', draft_batch_id = ${batchId}::uuid, resolved_by = ${actorId},
             resolved_at = ${at}
       where organization_id = ${organizationId} and id = any(${ids}::uuid[]) and status = 'open'
       returning id::text as id`.execute(this.database.db);

    return rows.map((row) => row.id);
  }

  /**
   * Record an apply: the suggestion becomes `applied` naming its audit event, the application row
   * keeps the payload, preview, landing and reversal, and the measurement row freezes the baseline
   * and prediction — all or nothing.
   *
   * @param record - What was applied.
   * @returns The measurement row, or `undefined` when the suggestion was no longer open.
   */
  async recordApply(record: AppliedRecord): Promise<MeasurementRow | undefined> {
    return this.database.transaction(async (trx) => {
      const moved = await sql`
        update ouroboros.analysis_suggestions
           set status = 'applied', resolved_by = ${record.actorId}, resolved_at = ${record.appliedAt},
               applied_event_id = ${record.eventId}::uuid
         where organization_id = ${record.organizationId} and id = ${record.suggestionId}::uuid
           and status = 'open'`.execute(trx);

      if ((moved.numAffectedRows ?? 0n) === 0n) {
        return undefined;
      }

      await sql`
        insert into ouroboros.analysis_suggestion_applications
          (suggestion_id, organization_id, repo_ref, plane, change, preview, target, reversal,
           applied_event_id, applied_by, applied_at)
        values (${record.suggestionId}::uuid, ${record.organizationId}, ${record.repoRef},
                ${record.plane}, ${JSON.stringify(record.change)}::jsonb, ${record.preview},
                ${JSON.stringify(record.target)}::jsonb, ${JSON.stringify(record.reversal)}::jsonb,
                ${record.eventId}::uuid, ${record.actorId}, ${record.appliedAt})`.execute(trx);

      const { rows } = await sql<MeasurementRow>`
        insert into ouroboros.suggestion_measurements
          (suggestion_id, organization_id, repo_ref, applied_at, applied_by, target_metric,
           baseline, predicted)
        values (${record.suggestionId}::uuid, ${record.organizationId}, ${record.repoRef},
                ${record.appliedAt}, ${record.actorId}, ${record.measurement.targetMetric},
                ${JSON.stringify(record.measurement.baseline)}::jsonb,
                ${JSON.stringify(record.measurement.predicted)}::jsonb)
        returning id::text as id, target_metric, window_days, baseline, predicted`.execute(trx);

      return rows[0];
    });
  }
}
