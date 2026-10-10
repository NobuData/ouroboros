/**
 * What the roadmap pipeline and the gaps hand-off read and write (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)): V113's documents, versions and
 * suggestions, V125's targets and policy, and the few rows of other planes they need — an
 * investigation's head, its roadmap input, the tracker's mirror and the estimates on it.
 *
 * {@link PipelineStore} is the seam the services are written against; {@link PipelineRepository}
 * is PostgreSQL. Every read is scoped by workspace: a document of another workspace is not found.
 *
 * **A version is written with what caused it, or not at all.** {@link PipelineStore.addVersion}
 * inserts the next version and, for an applied suggestion, settles the suggestion in the same
 * transaction — so a suggestion is never `applied` to a version that does not exist, and a
 * version a suggestion produced always says so. Two writers racing for the same version meet at
 * V113's `roadmap_doc_versions_version_next`; the loser is {@link VersionRaceError}.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import { SCHEMA_NAME, type InvestigationStatus, type TicketSourceKind } from "../../db/schema";
import type { SyncSource } from "../../ticket-sources/ticket-sources.repository";
import type { RoadmapEffort, RoadmapStructure, TrackerTicket } from "./roadmap.structure";

/** Where a version's file stands in the repository (V113's `repo_projection`). */
export type ProjectionState = "pending" | "pr_open" | "committed" | "drift_detected";

/** `roadmap_doc_versions.repo_projection`, as stored. */
export interface RepoProjection {
  state: ProjectionState;
  /** `docs/ROADMAP.md`. Fixed once written. */
  path: string;
  /** `#88` while a PR is open; kept afterwards as where a commit came from. */
  pr_ref: string | null;
  /** The commit holding this version, from `committed` on. */
  committed_sha: string | null;
  /** The repository commit a drift was seen at; only in `drift_detected`. */
  observed_sha: string | null;
}

/** An investigation, as the pipeline needs it. */
export interface PipelineInvestigation {
  readonly id: string;
  /** `RS-124`. */
  readonly displayId: string;
  readonly question: string;
  readonly status: InvestigationStatus;
}

/** A roadmap document. */
export interface DocRow {
  readonly id: string;
  readonly organizationId: string;
  readonly investigationId: string | null;
  readonly title: string;
  /** Null only before the first version — never for a document a service created. */
  readonly currentVersion: number | null;
  readonly targetSourceId: string | null;
  readonly batchId: string | null;
  readonly createdAt: Date;
}

/** One version of a document. */
export interface VersionRow {
  readonly docId: string;
  readonly version: number;
  readonly structure: RoadmapStructure;
  readonly markdown: string;
  readonly generatedBy: string;
  readonly projection: RepoProjection;
  readonly createdAt: Date;
}

/** A suggested change. */
export interface SuggestionRow {
  readonly id: string;
  readonly docId: string;
  readonly authorKind: "user" | "ai";
  readonly authorUserId: string | null;
  /** The person's name, when a person wrote it and still exists. */
  readonly authorName: string | null;
  readonly authorAgent: string | null;
  readonly text: string;
  readonly hint: Record<string, unknown> | null;
  readonly status: "open" | "applied" | "dismissed";
  readonly appliedVersion: number | null;
  readonly appliedAt: Date | null;
  readonly dismissedAt: Date | null;
  readonly createdAt: Date;
}

/** A suggestion to store. */
export interface NewSuggestion {
  readonly authorKind: "user" | "ai";
  readonly userId: string | null;
  readonly agent: string | null;
  readonly text: string;
  readonly hint: Record<string, unknown> | null;
}

/** A version to store. */
export interface NewVersion {
  readonly structure: RoadmapStructure;
  readonly markdown: string;
  readonly generatedBy: string;
  /** The file's path — the document's own, kept from its first version. */
  readonly path: string;
}

/** A document to store, with its first version. */
export interface NewDoc {
  readonly organizationId: string;
  readonly investigationId: string;
  readonly title: string;
  readonly targetSourceId: string;
  readonly version: NewVersion;
}

/** A ticket source a document could be projected to. */
export interface PipelineSource {
  readonly id: string;
  readonly kind: TicketSourceKind;
  readonly displayName: string;
}

/** A filed item's ticket, with the estimator's answer for it. */
export interface IssueRow extends TrackerTicket {
  readonly url: string;
  /** The estimate in force, or null while unsized. */
  readonly estimate: {
    readonly effort: RoadmapEffort;
    /** `low | medium | high` — the row's `cx:` chip. */
    readonly risk: string | null;
    /** The loop time, in minutes. */
    readonly estMinutes: number | null;
  } | null;
}

/** The workspace's pipeline policy. */
export interface PipelineSettings {
  /** Whether a projection is committed to the default branch without a pull request. */
  readonly directCommit: boolean;
}

/** A document the scheduler's pass looks at. */
export interface WatchedDoc {
  readonly organizationId: string;
  readonly investigationId: string;
}

/** Two writers raced for the same version; this one lost. */
export class VersionRaceError extends Error {
  /** @param docId - The document. */
  constructor(readonly docId: string) {
    super(`roadmap ${docId} gained a version while this one was being written`);
  }
}

/** The seam the pipeline's services are written against. */
export interface PipelineStore {
  /**
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns Its head, or undefined when the workspace has none such.
   */
  investigation(
    organizationId: string,
    investigationId: string,
  ): Promise<PipelineInvestigation | undefined>;
  /**
   * @param investigationId - The investigation.
   * @returns The `roadmap_doc` deliverable input of its latest brief, or null when it produced none.
   */
  roadmapInput(investigationId: string): Promise<Record<string, unknown> | null>;
  /**
   * @param organizationId - The workspace.
   * @returns Its ticket sources, oldest first.
   */
  sources(organizationId: string): Promise<PipelineSource[]>;
  /**
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns The source as a provider is handed it, or undefined.
   */
  source(organizationId: string, sourceId: string): Promise<SyncSource | undefined>;
  /**
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The document generated from it, or undefined.
   */
  doc(organizationId: string, investigationId: string): Promise<DocRow | undefined>;
  /**
   * @param docId - The document.
   * @param version - The version.
   * @returns It, or undefined.
   */
  version(docId: string, version: number): Promise<VersionRow | undefined>;
  /**
   * Store a document and its first version — one transaction.
   *
   * @param input - The document and version 1.
   * @returns The document's id.
   */
  createDoc(input: NewDoc): Promise<string>;
  /**
   * Store the next version, settling the suggestion that caused it in the same transaction.
   *
   * @param doc - The document; `currentVersion` is the version this one follows.
   * @param title - The document's title from now on.
   * @param version - The version.
   * @param applied - The suggestion this version applies and who applied it, or null.
   * @returns The new version's number.
   * @throws {VersionRaceError} When another writer stored that version first.
   */
  addVersion(
    doc: DocRow,
    title: string,
    version: NewVersion,
    applied: { readonly suggestionId: string; readonly userId: string } | null,
  ): Promise<number>;
  /**
   * Move a version's repository state.
   *
   * @param docId - The document.
   * @param version - The version.
   * @param projection - The new state — an edge V113 allows.
   */
  setProjection(docId: string, version: number, projection: RepoProjection): Promise<void>;
  /**
   * Record the batch `create-issues` composed.
   *
   * @param docId - The document.
   * @param batchId - The batch.
   */
  setBatch(docId: string, batchId: string): Promise<void>;
  /**
   * @param docId - The document.
   * @returns Its suggestions, oldest first.
   */
  suggestions(docId: string): Promise<SuggestionRow[]>;
  /**
   * @param docId - The document.
   * @param suggestion - What to store.
   * @returns The stored suggestion.
   */
  addSuggestion(docId: string, suggestion: NewSuggestion): Promise<SuggestionRow>;
  /**
   * Dismiss an open suggestion.
   *
   * @param docId - The document.
   * @param suggestionId - The suggestion.
   * @param userId - Who dismissed it.
   * @returns False when it was not open any more.
   */
  dismissSuggestion(docId: string, suggestionId: string, userId: string): Promise<boolean>;
  /**
   * @param organizationId - The workspace.
   * @param ticketIds - Canonical tickets.
   * @returns Those the workspace holds, each with its estimate in force.
   */
  issues(organizationId: string, ticketIds: readonly string[]): Promise<IssueRow[]>;
  /**
   * @param organizationId - The workspace.
   * @returns Its pipeline policy; the defaults when it has stored none.
   */
  settings(organizationId: string): Promise<PipelineSettings>;
  /**
   * @param organizationId - The workspace.
   * @param settings - The policy.
   * @param userId - Who decided.
   */
  saveSettings(organizationId: string, settings: PipelineSettings, userId: string): Promise<void>;
  /**
   * Move an investigation `brief_ready → issues_filed`. A no-op from any other status.
   *
   * @param investigationId - The investigation.
   */
  markIssuesFiled(investigationId: string): Promise<void>;
  /**
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The live batch already drafted from its gaps — its id and epic — or undefined.
   */
  gapBatch(
    organizationId: string,
    investigationId: string,
  ): Promise<{ readonly batchId: string; readonly epicId: string | null } | undefined>;
  /**
   * @param limit - The most to answer.
   * @returns Documents with a target source whose current version is not already known to have
   *   drifted, least recently changed first — what the scheduler's pass checks.
   */
  watchedDocs(limit: number): Promise<WatchedDoc[]>;
}

const schema = sql.id(SCHEMA_NAME);

interface DocRecord {
  id: string;
  organization_id: string;
  investigation_id: string | null;
  title: string;
  current_version: number | null;
  target_source_id: string | null;
  batch_id: string | null;
  created_at: Date;
}

interface VersionRecord {
  doc_id: string;
  version: number;
  structure: RoadmapStructure;
  markdown: string;
  generated_by: string;
  repo_projection: RepoProjection;
  created_at: Date;
}

interface SuggestionRecord {
  id: string;
  doc_id: string;
  author_kind: "user" | "ai";
  author_user_id: string | null;
  author_name: string | null;
  author_agent: string | null;
  text: string;
  hint: Record<string, unknown> | null;
  status: "open" | "applied" | "dismissed";
  applied_version: number | null;
  applied_at: Date | null;
  dismissed_at: Date | null;
  created_at: Date;
}

const DOC_COLUMNS = sql`d.id, d.organization_id, d.investigation_id, d.title, d.current_version,
  d.target_source_id, d.batch_id, d.created_at`;

const SUGGESTION_COLUMNS = sql`s.id, s.doc_id, s.author_kind, s.author_user_id,
  u."name" as author_name, s.author_agent, s.text, s.hint, s.status, s.applied_version,
  s.applied_at, s.dismissed_at, s.created_at`;

/** PostgreSQL's codes for the two ways a raced version is refused. */
const RACE_CODES = new Set(["23505", "23514"]);

/**
 * A document row in this service's names.
 *
 * @param row - The record.
 * @returns The document.
 */
function docOf(row: DocRecord): DocRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    investigationId: row.investigation_id,
    title: row.title,
    currentVersion: row.current_version,
    targetSourceId: row.target_source_id,
    batchId: row.batch_id,
    createdAt: row.created_at,
  };
}

/**
 * A suggestion row in this service's names.
 *
 * @param row - The record.
 * @returns The suggestion.
 */
function suggestionOf(row: SuggestionRecord): SuggestionRow {
  return {
    id: row.id,
    docId: row.doc_id,
    authorKind: row.author_kind,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorAgent: row.author_agent,
    text: row.text,
    hint: row.hint,
    status: row.status,
    appliedVersion: row.applied_version,
    appliedAt: row.applied_at,
    dismissedAt: row.dismissed_at,
    createdAt: row.created_at,
  };
}

/**
 * A version's projection as it is first written: nothing in the repository yet.
 *
 * @param path - The file.
 * @returns The `pending` projection.
 */
export function pendingProjection(path: string): RepoProjection {
  return { state: "pending", path, pr_ref: null, committed_sha: null, observed_sha: null };
}

@Injectable()
export class PipelineRepository implements PipelineStore {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async investigation(
    organizationId: string,
    investigationId: string,
  ): Promise<PipelineInvestigation | undefined> {
    const { rows } = await sql<{
      id: string;
      display_id: string;
      question: string;
      status: InvestigationStatus;
    }>`
      select i.id, i.display_id, i.question, i.status
        from ${schema}.investigations i
       where i.organization_id = ${organizationId} and i.id = ${investigationId}
    `.execute(this.database.db);
    const row = rows[0];

    return row === undefined
      ? undefined
      : { id: row.id, displayId: row.display_id, question: row.question, status: row.status };
  }

  /** @inheritdoc */
  async roadmapInput(investigationId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await sql<{ payload: Record<string, unknown> }>`
      select i.payload
        from ${schema}.investigation_deliverable_inputs i
        join ${schema}.briefs b on b.id = i.brief_id
       where i.investigation_id = ${investigationId} and i.deliverable = 'roadmap_doc'
       order by b.version desc
       limit 1
    `.execute(this.database.db);

    return rows[0]?.payload ?? null;
  }

  /** @inheritdoc */
  async sources(organizationId: string): Promise<PipelineSource[]> {
    const { rows } = await sql<{ id: string; kind: TicketSourceKind; display_name: string }>`
      select s.id, s.kind, s.display_name
        from ${schema}.ticket_sources_public s
       where s.organization_id = ${organizationId}
       order by s.created_at, s.id
    `.execute(this.database.db);

    return rows.map((row) => ({ id: row.id, kind: row.kind, displayName: row.display_name }));
  }

  /** @inheritdoc */
  async source(organizationId: string, sourceId: string): Promise<SyncSource | undefined> {
    const row = await this.database.db
      .selectFrom("ticket_sources_public")
      .select([
        "id",
        "organization_id",
        "kind",
        "display_name",
        "config",
        "sync_cursor",
        "synced_at",
      ])
      .where("organization_id", "=", organizationId)
      .where("id", "=", sourceId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          sourceId: row.id,
          organizationId: row.organization_id,
          kind: row.kind,
          displayName: row.display_name,
          config: row.config,
          cursor: row.sync_cursor,
          syncedAt: row.synced_at,
        };
  }

  /** @inheritdoc */
  async doc(organizationId: string, investigationId: string): Promise<DocRow | undefined> {
    const { rows } = await sql<DocRecord>`
      select ${DOC_COLUMNS}
        from ${schema}.roadmap_docs d
       where d.organization_id = ${organizationId} and d.investigation_id = ${investigationId}
    `.execute(this.database.db);

    return rows[0] === undefined ? undefined : docOf(rows[0]);
  }

  /** @inheritdoc */
  async version(docId: string, version: number): Promise<VersionRow | undefined> {
    const { rows } = await sql<VersionRecord>`
      select v.doc_id, v.version, v.structure, v.markdown, v.generated_by, v.repo_projection,
             v.created_at
        from ${schema}.roadmap_doc_versions v
       where v.doc_id = ${docId} and v.version = ${version}
    `.execute(this.database.db);
    const row = rows[0];

    return row === undefined
      ? undefined
      : {
          docId: row.doc_id,
          version: row.version,
          structure: row.structure,
          markdown: row.markdown,
          generatedBy: row.generated_by,
          projection: row.repo_projection,
          createdAt: row.created_at,
        };
  }

  /** @inheritdoc */
  async createDoc(input: NewDoc): Promise<string> {
    return this.database.transaction(async (trx) => {
      const { rows } = await sql<{ id: string }>`
        insert into ${schema}.roadmap_docs
          (organization_id, investigation_id, title, target_source_id)
        values (${input.organizationId}, ${input.investigationId}, ${input.title},
                ${input.targetSourceId})
        returning id
      `.execute(trx);
      const docId = rows[0].id;

      await sql`
        insert into ${schema}.roadmap_doc_versions
          (doc_id, version, structure, markdown, generated_by, repo_projection)
        values (${docId}, 1, ${JSON.stringify(input.version.structure)}::jsonb,
                ${input.version.markdown}, ${input.version.generatedBy},
                ${JSON.stringify(pendingProjection(input.version.path))}::jsonb)
      `.execute(trx);

      return docId;
    });
  }

  /** @inheritdoc */
  async addVersion(
    doc: DocRow,
    title: string,
    version: NewVersion,
    applied: { readonly suggestionId: string; readonly userId: string } | null,
  ): Promise<number> {
    const next = (doc.currentVersion ?? 0) + 1;

    try {
      await this.database.transaction(async (trx) => {
        await sql`
          insert into ${schema}.roadmap_doc_versions
            (doc_id, version, structure, markdown, generated_by, repo_projection)
          values (${doc.id}, ${next}, ${JSON.stringify(version.structure)}::jsonb,
                  ${version.markdown}, ${version.generatedBy},
                  ${JSON.stringify(pendingProjection(version.path))}::jsonb)
        `.execute(trx);

        if (title !== doc.title) {
          await sql`
            update ${schema}.roadmap_docs set title = ${title} where id = ${doc.id}
          `.execute(trx);
        }

        if (applied !== null) {
          const settled = await sql`
            update ${schema}.doc_suggestions
               set status = 'applied', applied_version = ${next}, applied_at = now(),
                   applied_by = ${applied.userId}
             where id = ${applied.suggestionId} and doc_id = ${doc.id} and status = 'open'
          `.execute(trx);

          // Someone settled it between the read and here: this version must not exist either.
          if (Number(settled.numAffectedRows ?? 0) !== 1) throw new VersionRaceError(doc.id);
        }
      });
    } catch (error) {
      if (error instanceof VersionRaceError) throw error;

      const refused = error as { code?: unknown; constraint?: unknown };

      if (
        typeof refused.code === "string" &&
        RACE_CODES.has(refused.code) &&
        typeof refused.constraint === "string" &&
        refused.constraint.startsWith("roadmap_doc_versions_")
      ) {
        throw new VersionRaceError(doc.id);
      }

      throw error;
    }

    return next;
  }

  /** @inheritdoc */
  async setProjection(docId: string, version: number, projection: RepoProjection): Promise<void> {
    await sql`
      update ${schema}.roadmap_doc_versions
         set repo_projection = ${JSON.stringify(projection)}::jsonb
       where doc_id = ${docId} and version = ${version}
    `.execute(this.database.db);
  }

  /** @inheritdoc */
  async setBatch(docId: string, batchId: string): Promise<void> {
    await sql`
      update ${schema}.roadmap_docs set batch_id = ${batchId} where id = ${docId}
    `.execute(this.database.db);
  }

  /** @inheritdoc */
  async suggestions(docId: string): Promise<SuggestionRow[]> {
    const { rows } = await sql<SuggestionRecord>`
      select ${SUGGESTION_COLUMNS}
        from ${schema}.doc_suggestions s
        left join ${schema}."user" u on u."id" = s.author_user_id
       where s.doc_id = ${docId}
       order by s.created_at, s.id
    `.execute(this.database.db);

    return rows.map(suggestionOf);
  }

  /** @inheritdoc */
  async addSuggestion(docId: string, suggestion: NewSuggestion): Promise<SuggestionRow> {
    const hint = suggestion.hint === null ? null : JSON.stringify(suggestion.hint);
    const { rows } = await sql<SuggestionRecord>`
      with s as (
        insert into ${schema}.doc_suggestions
          (doc_id, author_kind, author_user_id, author_agent, text, hint)
        values (${docId}, ${suggestion.authorKind}, ${suggestion.userId}, ${suggestion.agent},
                ${suggestion.text}, ${hint}::jsonb)
        returning *
      )
      select ${SUGGESTION_COLUMNS}
        from s
        left join ${schema}."user" u on u."id" = s.author_user_id
    `.execute(this.database.db);

    return suggestionOf(rows[0]);
  }

  /** @inheritdoc */
  async dismissSuggestion(docId: string, suggestionId: string, userId: string): Promise<boolean> {
    const result = await sql`
      update ${schema}.doc_suggestions
         set status = 'dismissed', dismissed_at = now(), dismissed_by = ${userId}
       where id = ${suggestionId} and doc_id = ${docId} and status = 'open'
    `.execute(this.database.db);

    return Number(result.numAffectedRows ?? 0) === 1;
  }

  /** @inheritdoc */
  async issues(organizationId: string, ticketIds: readonly string[]): Promise<IssueRow[]> {
    if (ticketIds.length === 0) return [];

    const { rows } = await sql<{
      id: string;
      external_key: string;
      external_url: string;
      title: string;
      state: "open" | "closed";
      labels: string[];
      effort: RoadmapEffort | null;
      risk: string | null;
      est_minutes: number | null;
    }>`
      select t.id, t.external_key, t.external_url, t.title, t.state, t.labels,
             e.effort, e.risk, (e.breakdown ->> 'est_minutes')::float8 as est_minutes
        from ${schema}.tickets t
        left join lateral (
               select ie.effort, ie.risk, ie.breakdown
                 from ${schema}.issue_estimates ie
                where ie.ticket_id = t.id
                   or ie.draft_id in (select d.id from ${schema}.ticket_drafts d
                                       where d.pushed_ticket_id = t.id)
                order by (ie.ticket_id is not null) desc, ie.version desc
                limit 1
             ) e on true
       where t.organization_id = ${organizationId}
         and t.id = any(${sql.val([...ticketIds])}::uuid[])
    `.execute(this.database.db);

    return rows.map((row) => ({
      id: row.id,
      key: row.external_key,
      url: row.external_url,
      title: row.title,
      state: row.state,
      labels: row.labels,
      estimate:
        row.effort === null
          ? null
          : { effort: row.effort, risk: row.risk, estMinutes: row.est_minutes },
    }));
  }

  /** @inheritdoc */
  async settings(organizationId: string): Promise<PipelineSettings> {
    const { rows } = await sql<{ direct_commit: boolean }>`
      select s.direct_commit
        from ${schema}.roadmap_pipeline_settings s
       where s.organization_id = ${organizationId}
    `.execute(this.database.db);

    return { directCommit: rows[0]?.direct_commit ?? false };
  }

  /** @inheritdoc */
  async saveSettings(
    organizationId: string,
    settings: PipelineSettings,
    userId: string,
  ): Promise<void> {
    await sql`
      insert into ${schema}.roadmap_pipeline_settings as s
        (organization_id, direct_commit, updated_by)
      values (${organizationId}, ${settings.directCommit}, ${userId})
      on conflict (organization_id) do update
         set direct_commit = excluded.direct_commit, updated_by = excluded.updated_by
    `.execute(this.database.db);
  }

  /** @inheritdoc */
  async markIssuesFiled(investigationId: string): Promise<void> {
    await sql`
      update ${schema}.investigations
         set status = 'issues_filed'
       where id = ${investigationId} and status = 'brief_ready'
    `.execute(this.database.db);
  }

  /** @inheritdoc */
  async gapBatch(
    organizationId: string,
    investigationId: string,
  ): Promise<{ readonly batchId: string; readonly epicId: string | null } | undefined> {
    const { rows } = await sql<{ id: string; epic_id: string | null }>`
      select b.id, b.epic_id
        from ${schema}.draft_batches b
       where b.organization_id = ${organizationId}
         and b.status <> 'abandoned'
         and exists (select 1 from ${schema}.ticket_drafts d
                      where d.batch_id = b.id
                        and d.research_provenance ->> 'origin' = 'gap'
                        and d.research_provenance ->> 'investigation_id' = ${investigationId})
       order by b.created_at desc
       limit 1
    `.execute(this.database.db);

    return rows[0] === undefined ? undefined : { batchId: rows[0].id, epicId: rows[0].epic_id };
  }

  /** @inheritdoc */
  async watchedDocs(limit: number): Promise<WatchedDoc[]> {
    const { rows } = await sql<{ organization_id: string; investigation_id: string }>`
      select d.organization_id, d.investigation_id
        from ${schema}.roadmap_docs d
        join ${schema}.roadmap_doc_versions v
          on v.doc_id = d.id and v.version = d.current_version
       where d.investigation_id is not null
         and d.target_source_id is not null
         and v.repo_projection ->> 'state' <> 'drift_detected'
       order by d.updated_at, d.id
       limit ${limit}
    `.execute(this.database.db);

    return rows.map((row) => ({
      organizationId: row.organization_id,
      investigationId: row.investigation_id,
    }));
  }
}
