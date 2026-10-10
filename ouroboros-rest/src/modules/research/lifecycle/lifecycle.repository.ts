/**
 * The investigation lifecycle's reads and its two small writes (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)).
 *
 * **Every statement is scoped to one workspace by its first argument** — an investigation of
 * another workspace is not found, the same answer as one that does not exist.
 *
 * **One record query.** {@link RECORD_COLUMNS} and {@link RECORD_JOINS} read an investigation
 * with everything a row derives from: its kind, who started it, the ledger's row count, spend
 * so far, the newest brief, the matrix, the loop's state, and the two cross-plane targets —
 *
 *   * **evidence** — the test run named by the first ledger record that names one
 *     (`meta.test_run_id`), in the same workspace;
 *   * **fix run** — a run still in flight whose pull request carries the ticket the brief's
 *     `fix_draft` was pushed as.
 *
 * Both counts on the card are counted here, over the whole workspace, in one statement.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder } from "kysely";

import { DatabaseService } from "../../db/db.service";
import {
  ACTIVE_RUN_STATUSES,
  SCHEMA_NAME,
  type InvestigationActualsDocument,
  type InvestigationDepth,
  type InvestigationEstimateDocument,
  type InvestigationFailureReason,
  type InvestigationOrigin,
  type InvestigationProvenanceDocument,
  type InvestigationStatus,
  type ResearchStartRole,
} from "../../db/schema";
import type { PageWindow } from "../../tenancy/pagination";
import { ACTIVE_STATUSES, type InvestigationRecord } from "./lifecycle.resources";
import type { Quarter } from "./quarter";

/** What a list may be narrowed by; every filter given must hold. */
export interface InvestigationFilter {
  /** A kind's slug. */
  readonly kind?: string;
  /** Any of these statuses. */
  readonly statuses?: readonly InvestigationStatus[];
  /** Started inside this quarter. */
  readonly quarter?: Quarter;
}

/** What a start writes. */
export interface InvestigationDraft {
  /** The kind's slug; it must exist in the workspace. */
  readonly kind: string;
  readonly question: string;
  readonly depth: InvestigationDepth;
  readonly tools: readonly string[];
  readonly estimate: InvestigationEstimateDocument;
  readonly calibrationVersion: number;
  /** Who is starting it. */
  readonly userId: string;
}

/** The storage the lifecycle service is written against; tests substitute an in-memory one. */
export interface LifecycleStore {
  /** @returns The lowest role that may start an investigation in the workspace. */
  startRole(organizationId: string): Promise<ResearchStartRole>;
  /** Store the starter role. @returns The role as stored. */
  saveStartRole(
    organizationId: string,
    role: ResearchStartRole,
    userId: string,
  ): Promise<ResearchStartRole>;
  /** Insert a queued investigation. @returns Its id, or undefined when the kind is unknown. */
  create(organizationId: string, draft: InvestigationDraft): Promise<string | undefined>;
  /** Cancel an investigation that never left `queued`. */
  discard(organizationId: string, investigationId: string): Promise<void>;
  /** @returns The investigation, or undefined. */
  find(organizationId: string, investigationId: string): Promise<InvestigationRecord | undefined>;
  /** @returns One page of investigations, newest first, and how many match. */
  list(
    organizationId: string,
    filter: InvestigationFilter,
    window: PageWindow,
  ): Promise<{ readonly records: InvestigationRecord[]; readonly total: number }>;
  /** @returns How many investigations are active, and how many started in the quarter. */
  counts(
    organizationId: string,
    quarter: Quarter,
  ): Promise<{ readonly active: number; readonly thisQuarter: number }>;
  /** @returns The ledger's row count per tool, largest first. */
  ledgerByTool(investigationId: string): Promise<{ tool: string; count: number }[]>;
}

/** One row of the record query. */
interface RecordRow {
  id: string;
  display_id: string;
  question: string;
  depth: InvestigationDepth;
  tools_enabled: string[];
  status: InvestigationStatus;
  origin: InvestigationOrigin;
  estimate: InvestigationEstimateDocument | null;
  estimate_calibration_version: number | null;
  actuals: InvestigationActualsDocument | null;
  provenance: InvestigationProvenanceDocument | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  kind_slug: string;
  kind_name: string;
  kind_tint: string;
  sources: number;
  spend_cents: number | null;
  brief_id: string | null;
  brief_version: number | null;
  brief_created_at: Date | null;
  brief_deliverables: Record<string, string> | null;
  matrix_id: string | null;
  loop_updated_at: Date | null;
  iteration: number | null;
  cancel_requested_at: Date | null;
  failure_reason: InvestigationFailureReason | null;
  failure_detail: string | null;
  evidence_test_run_id: string | null;
  evidence_run_id: string | null;
  fix_run_id: string | null;
}

const schema = sql.id(SCHEMA_NAME);

/** What the record query selects. */
const RECORD_COLUMNS = sql`
  i.id, i.display_id, i.question, i.depth, i.tools_enabled, i.status, i.origin,
  i.estimate, i.estimate_calibration_version, i.actuals, i.provenance,
  i.created_by, u."name" as created_by_name, i.created_at, i.updated_at,
  k.slug as kind_slug, k.display_name as kind_name, k.tint_key as kind_tint,
  (select count(*)::int from ${schema}.source_records s where s.investigation_id = i.id) as sources,
  ${schema}.investigation_spend_cents(i.id) as spend_cents,
  b.id as brief_id, b.version as brief_version, b.created_at as brief_created_at,
  b.deliverables as brief_deliverables,
  (select m.id from ${schema}.capability_matrices m
    where m.investigation_id = i.id
    order by m.created_at desc, m.id
    limit 1) as matrix_id,
  l.updated_at as loop_updated_at, l.cancel_requested_at, l.failure_reason, l.failure_detail,
  case when jsonb_typeof(l.checkpoint -> 'iteration') = 'number'
       then floor((l.checkpoint ->> 'iteration')::numeric)::int end as iteration,
  e.test_run_id as evidence_test_run_id, e.run_id as evidence_run_id,
  f.run_id as fix_run_id`;

/** What the record query reads from. */
const RECORD_JOINS = sql`
  from ${schema}.investigations i
  join ${schema}.investigation_kinds k on k.id = i.kind_id
  left join ${schema}."user" u on u."id" = i.created_by
  left join ${schema}.investigation_loops l on l.investigation_id = i.id
  left join lateral (
    select x.id, x.version, x.created_at, x.deliverables
      from ${schema}.briefs x
     where x.investigation_id = i.id
     order by x.version desc
     limit 1) b on true
  left join lateral (
    select tr.id as test_run_id, tr.run_id
      from ${schema}.source_records s
      join ${schema}.test_runs tr
        on tr.id::text = s.meta ->> 'test_run_id' and tr.organization_id = i.organization_id
     where s.investigation_id = i.id
     order by s.cite_no, s.id
     limit 1) e on true
  left join lateral (
    select r.id as run_id
      from ${schema}.ticket_drafts d
      join ${schema}.pull_requests p
        on p.ticket_id = d.pushed_ticket_id and p.organization_id = i.organization_id
      join ${schema}.runs r on r.id = p.run_id and r.organization_id = i.organization_id
     where d.id::text = b.deliverables ->> 'fix_draft'
       and r.status in (${sql.join(ACTIVE_RUN_STATUSES)})
     order by r.started_at desc, r.id
     limit 1) f on true`;

@Injectable()
export class LifecycleRepository implements LifecycleStore {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async startRole(organizationId: string): Promise<ResearchStartRole> {
    const row = await this.database.db
      .selectFrom("workspace_settings_effective")
      .select("research_start_role")
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    // No row is unreachable behind the tenant guard; the column's own default answers anyway.
    return row?.research_start_role ?? "member";
  }

  /** @inheritdoc */
  async saveStartRole(
    organizationId: string,
    role: ResearchStartRole,
    userId: string,
  ): Promise<ResearchStartRole> {
    const row = await this.database.db
      .insertInto("workspace_settings")
      .values({ organization_id: organizationId, research_start_role: role, updated_by: userId })
      .onConflict((conflict) =>
        conflict
          .column("organization_id")
          .doUpdateSet({ research_start_role: role, updated_by: userId }),
      )
      .returning("research_start_role")
      .executeTakeFirstOrThrow();

    return row.research_start_role;
  }

  /** @inheritdoc */
  async create(organizationId: string, draft: InvestigationDraft): Promise<string | undefined> {
    const { rows } = await sql<{ id: string }>`
      insert into ${schema}.investigations
        (organization_id, kind_id, question, depth, tools_enabled, status, estimate,
         estimate_calibration_version, origin, created_by)
      select ${organizationId}, k.id, ${draft.question}, ${draft.depth},
             ${JSON.stringify(draft.tools)}::jsonb, 'queued',
             ${JSON.stringify(draft.estimate)}::jsonb, ${draft.calibrationVersion}, 'user',
             ${draft.userId}
        from ${schema}.investigation_kinds k
       where k.organization_id = ${organizationId} and k.slug = ${draft.kind}
      returning id
    `.execute(this.database.db);

    return rows[0]?.id;
  }

  /** @inheritdoc */
  async discard(organizationId: string, investigationId: string): Promise<void> {
    await this.database.db
      .updateTable("investigations")
      .set({ status: "cancelled" })
      .where("organization_id", "=", organizationId)
      .where("id", "=", investigationId)
      .where("status", "=", "queued")
      .execute();
  }

  /** @inheritdoc */
  async find(
    organizationId: string,
    investigationId: string,
  ): Promise<InvestigationRecord | undefined> {
    const { rows } = await sql<RecordRow>`
      select ${RECORD_COLUMNS}
      ${RECORD_JOINS}
       where i.organization_id = ${organizationId} and i.id = ${investigationId}::uuid
    `.execute(this.database.db);

    return rows[0] === undefined ? undefined : recordOf(rows[0]);
  }

  /** @inheritdoc */
  async list(
    organizationId: string,
    filter: InvestigationFilter,
    window: PageWindow,
  ): Promise<{ readonly records: InvestigationRecord[]; readonly total: number }> {
    const matching = where(organizationId, filter);

    const [page, count] = await Promise.all([
      sql<RecordRow>`
        select ${RECORD_COLUMNS}
        ${RECORD_JOINS}
         where ${matching}
         order by i.seq desc
         limit ${window.limit} offset ${window.offset}
      `.execute(this.database.db),
      sql<{ total: number }>`
        select count(*)::int as total
          from ${schema}.investigations i
          join ${schema}.investigation_kinds k on k.id = i.kind_id
         where ${matching}
      `.execute(this.database.db),
    ]);

    return { records: page.rows.map(recordOf), total: count.rows[0]?.total ?? 0 };
  }

  /** @inheritdoc */
  async counts(
    organizationId: string,
    quarter: Quarter,
  ): Promise<{ readonly active: number; readonly thisQuarter: number }> {
    const { rows } = await sql<{ active: number; this_quarter: number }>`
      select count(*) filter (where i.status in (${sql.join(ACTIVE_STATUSES)}))::int as active,
             count(*) filter (where i.created_at >= ${quarter.from}
                                and i.created_at < ${quarter.to})::int as this_quarter
        from ${schema}.investigations i
       where i.organization_id = ${organizationId}
    `.execute(this.database.db);

    return { active: rows[0]?.active ?? 0, thisQuarter: rows[0]?.this_quarter ?? 0 };
  }

  /** @inheritdoc */
  async ledgerByTool(investigationId: string): Promise<{ tool: string; count: number }[]> {
    const { rows } = await sql<{ tool: string; count: number }>`
      select s.tool_slug as tool, count(*)::int as count
        from ${schema}.source_records s
       where s.investigation_id = ${investigationId}::uuid
       group by s.tool_slug
       order by count(*) desc, s.tool_slug
    `.execute(this.database.db);

    return rows.map((row) => ({ tool: row.tool, count: row.count }));
  }
}

/**
 * The condition a list's rows meet.
 *
 * @param organizationId - The workspace.
 * @param filter - What to narrow by.
 * @returns The workspace condition and every filter given, joined by `and`.
 */
function where(organizationId: string, filter: InvestigationFilter): RawBuilder<unknown> {
  const conditions: RawBuilder<unknown>[] = [sql`i.organization_id = ${organizationId}`];

  if (filter.kind !== undefined) conditions.push(sql`k.slug = ${filter.kind}`);
  if (filter.statuses !== undefined) {
    conditions.push(
      filter.statuses.length === 0
        ? sql`false`
        : sql`i.status in (${sql.join([...filter.statuses])})`,
    );
  }
  if (filter.quarter !== undefined) {
    conditions.push(
      sql`i.created_at >= ${filter.quarter.from} and i.created_at < ${filter.quarter.to}`,
    );
  }

  return sql.join(conditions, sql` and `);
}

/**
 * A row of the record query, as a record.
 *
 * @param row - The row.
 * @returns The record.
 */
export function recordOf(row: RecordRow): InvestigationRecord {
  return {
    id: row.id,
    displayId: row.display_id,
    kind: { slug: row.kind_slug, name: row.kind_name, tint: row.kind_tint },
    question: row.question,
    depth: row.depth,
    tools: row.tools_enabled,
    status: row.status,
    origin: row.origin,
    startedBy:
      row.created_by === null ? null : { id: row.created_by, name: row.created_by_name ?? "" },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    estimate: row.estimate,
    estimateCalibrationVersion: row.estimate_calibration_version,
    actuals: row.actuals,
    provenance: row.provenance,
    sources: row.sources,
    spendCents: row.spend_cents,
    brief:
      row.brief_id === null || row.brief_version === null || row.brief_created_at === null
        ? null
        : {
            id: row.brief_id,
            version: row.brief_version,
            createdAt: row.brief_created_at,
            deliverables: row.brief_deliverables ?? {},
          },
    matrixId: row.matrix_id,
    loop:
      row.loop_updated_at === null
        ? null
        : {
            iteration: row.iteration,
            cancelRequestedAt: row.cancel_requested_at,
            failureReason: row.failure_reason,
            failureDetail: row.failure_detail,
            updatedAt: row.loop_updated_at,
          },
    evidence:
      row.evidence_test_run_id === null || row.evidence_run_id === null
        ? null
        : { testRunId: row.evidence_test_run_id, runId: row.evidence_run_id },
    fixRunId: row.fix_run_id,
  };
}
