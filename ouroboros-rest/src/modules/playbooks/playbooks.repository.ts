/**
 * Every statement the playbooks service issues (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415)) — each takes the workspace first and
 * filters on it, so another workspace's playbook, run or issue is simply absent.
 *
 * ```
 * list / find          playbooks ⋈ workflows, with count(runs.playbook_id) — never a column
 * counts               every playbook, with its launches counted
 * insert / update / delete
 * workflowBySlug / versionPublished   the pin's two checks
 * runSource            a run, its repository, its injected skills and its steers
 * issues / issue       the picker, narrowed by V072's playbook_issue_filter_admits
 * ```
 *
 * **The filter is V072's function, not a copy of it.** The picker and the launch both ask
 * `ouroboros.playbook_issue_filter_admits(filter, repo, labels)` — one implementation of *what the
 * filter admits*, the migration's.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder, type SqlBool } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { RunStatus, SizingStatus } from "../db/schema";
import type { PlaybookRow } from "./playbooks.resources";

/** The columns a playbook write sets — the jsonb documents already stringified. */
export interface PlaybookWrite {
  readonly name: string;
  readonly description: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly skillOverrides: string;
  readonly contextPreset: string;
  readonly issueFilter: string | null;
  readonly sourceRunId: string | null;
}

/** A run create-from-run reads. */
export interface RunSource {
  readonly id: string;
  readonly status: RunStatus;
  readonly loopSeq: number;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly workflowTag: string;
  readonly workflowVersionPin: number | null;
  /** `owner/name`, lower-case. */
  readonly repo: string;
}

/** What the run was injected with — the skills of its injection records. */
export interface RunInjections {
  /** How many injection records name the run. */
  readonly records: number;
  /** The distinct skill ids of every skill version they injected. */
  readonly skillIds: readonly string[];
}

/** One issue as the picker and the launch read it. */
export interface IssueRow {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly repo: string;
  readonly labels: string[];
  readonly sizingStatus: SizingStatus;
  readonly queued: boolean;
  readonly admitted: boolean;
}

/** The picker's query. */
export interface IssueQuery {
  /** A substring of the title, or the number. */
  readonly q?: string;
  readonly limit: number;
}

@Injectable()
export class PlaybooksRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every playbook of a workspace, by name, each with its launches counted.
   *
   * @param organizationId - The workspace.
   * @returns The rows.
   */
  async list(organizationId: string): Promise<PlaybookRow[]> {
    return this.rows(organizationId).orderBy("p.name").execute();
  }

  /**
   * One playbook.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @returns The row, or `undefined` — absent and another workspace's alike.
   */
  async find(organizationId: string, id: string): Promise<PlaybookRow | undefined> {
    return this.rows(organizationId).where("p.id", "=", id).executeTakeFirst();
  }

  /**
   * Every playbook's launch count — `count(*)` of the runs carrying its id, zero included.
   *
   * @param organizationId - The workspace.
   * @returns One entry per playbook, by id.
   */
  async counts(organizationId: string): Promise<{ playbookId: string; runs: number }[]> {
    const rows = await this.database.db
      .selectFrom("playbooks as p")
      .leftJoin("runs as r", (join) =>
        join
          .onRef("r.playbook_id", "=", "p.id")
          .onRef("r.organization_id", "=", "p.organization_id"),
      )
      .select(["p.id as playbookId", sql<string>`count(r.id)`.as("runs")])
      .where("p.organization_id", "=", organizationId)
      .groupBy("p.id")
      .orderBy("p.id")
      .execute();

    return rows.map((row) => ({ playbookId: row.playbookId, runs: Number(row.runs) }));
  }

  /**
   * Insert a playbook.
   *
   * @param organizationId - The workspace.
   * @param write - The columns.
   * @returns The new id.
   */
  async insert(organizationId: string, write: PlaybookWrite): Promise<string> {
    const row = await this.database.db
      .insertInto("playbooks")
      .values({
        organization_id: organizationId,
        name: write.name,
        description: write.description,
        workflow_id: write.workflowId,
        workflow_version: write.workflowVersion,
        skill_overrides: write.skillOverrides,
        context_preset: write.contextPreset,
        issue_filter: write.issueFilter,
        source_run_id: write.sourceRunId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /**
   * Change a playbook. `source_run_id` is provenance and never changes.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @param write - The columns, all of them — the service merged the change into the row.
   * @returns Whether a row was updated.
   */
  async update(
    organizationId: string,
    id: string,
    write: Omit<PlaybookWrite, "sourceRunId">,
  ): Promise<boolean> {
    const result = await this.database.db
      .updateTable("playbooks")
      .set({
        name: write.name,
        description: write.description,
        workflow_id: write.workflowId,
        workflow_version: write.workflowVersion,
        skill_overrides: write.skillOverrides,
        context_preset: write.contextPreset,
        issue_filter: write.issueFilter,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Delete a playbook. Its runs and queued items keep their history — V072 sets their
   * `playbook_id` null.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @returns Whether a row was deleted.
   */
  async delete(organizationId: string, id: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("playbooks")
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  /**
   * A workflow of the workspace, by slug.
   *
   * @param organizationId - The workspace.
   * @param slug - The slug.
   * @returns Its id, or `undefined`.
   */
  async workflowBySlug(organizationId: string, slug: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("workflows")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("slug", "=", slug)
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * A workflow of the workspace, by id — its slug.
   *
   * @param organizationId - The workspace.
   * @param id - The workflow.
   * @returns Its slug, or `undefined`.
   */
  async workflowSlug(organizationId: string, id: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("workflows")
      .select("slug")
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();

    return row?.slug;
  }

  /**
   * Whether a version of a workflow is published — V072's pin names only those.
   *
   * @param workflowId - A workflow the caller resolved in its workspace.
   * @param version - The version.
   * @returns True when `workflow_versions` holds that published version.
   */
  async versionPublished(workflowId: string, version: number): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("workflow_versions")
      .select("version")
      .where("workflow_id", "=", workflowId)
      .where("version", "=", version)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * A run, with its repository — what create-from-run starts from.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The run, or `undefined`.
   */
  async runSource(organizationId: string, runId: string): Promise<RunSource | undefined> {
    return this.database.db
      .selectFrom("runs as r")
      .innerJoin("github_repos as gr", "gr.id", "r.github_repo_id")
      .innerJoin("github_orgs as go", "go.id", "gr.org_id")
      .select([
        "r.id as id",
        "r.status as status",
        "r.loop_seq as loopSeq",
        "r.issue_number as issueNumber",
        "r.issue_title as issueTitle",
        "r.workflow_tag as workflowTag",
        "r.workflow_version_pin as workflowVersionPin",
        sql<string>`lower(go.login || '/' || gr.name)`.as("repo"),
      ])
      .where("r.organization_id", "=", organizationId)
      .where("r.id", "=", runId)
      .executeTakeFirst();
  }

  /**
   * The skills a run was injected with — every skill version any of its injection records names.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The record count and the distinct skill ids.
   */
  async runInjections(organizationId: string, runId: string): Promise<RunInjections> {
    const records = await this.database.db
      .selectFrom("context_injections")
      .select("skill_version_ids")
      .where("organization_id", "=", organizationId)
      .where("run_id", "=", runId)
      .execute();

    const versionIds = [...new Set(records.flatMap((record) => record.skill_version_ids))];

    if (versionIds.length === 0) {
      return { records: records.length, skillIds: [] };
    }

    const skills = await this.database.db
      .selectFrom("skill_versions as sv")
      .innerJoin("skills as s", "s.id", "sv.skill_id")
      .select("s.id")
      .distinct()
      .where("s.organization_id", "=", organizationId)
      .where("sv.id", "in", versionIds)
      .execute();

    return { records: records.length, skillIds: skills.map((skill) => skill.id) };
  }

  /**
   * The steers someone typed into a run, oldest first — every one the executor was not refused.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The steer texts.
   */
  async runSteers(organizationId: string, runId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("run_controls as rc")
      .innerJoin("runs as r", "r.id", "rc.run_id")
      .select("rc.payload")
      .where("r.organization_id", "=", organizationId)
      .where("rc.run_id", "=", runId)
      .where("rc.kind", "=", "steer")
      .where("rc.state", "!=", "rejected")
      .where("rc.payload", "is not", null)
      .orderBy("rc.requested_at")
      .orderBy("rc.id")
      .execute();

    return rows.flatMap((row) => (row.payload === null ? [] : [row.payload]));
  }

  /**
   * The open issues *Run on issue… ▾* offers — those the playbook's filter admits.
   *
   * @param organizationId - The workspace.
   * @param filter - The playbook's stored `issue_filter`, or `null`.
   * @param query - A title or number match, and the page size.
   * @returns The issues, newest number first.
   */
  async issues(organizationId: string, filter: unknown, query: IssueQuery): Promise<IssueRow[]> {
    let select = this.issueRows(organizationId, filter)
      .where("gi.state", "=", "open")
      .where(admits(filter));

    const q = query.q?.trim();

    if (q !== undefined && q !== "") {
      const number = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : undefined;
      select = select.where((eb) =>
        eb.or([
          eb("gi.title", "ilike", `%${escapeLike(q)}%`),
          ...(number === undefined ? [] : [eb("gi.number", "=", number)]),
        ]),
      );
    }

    return select.orderBy("gi.number", "desc").limit(query.limit).execute();
  }

  /**
   * One issue, and whether the playbook's filter admits it.
   *
   * @param organizationId - The workspace.
   * @param filter - The playbook's stored `issue_filter`, or `null`.
   * @param issueId - `github_issues.id`.
   * @returns The issue, or `undefined`.
   */
  async issue(
    organizationId: string,
    filter: unknown,
    issueId: string,
  ): Promise<IssueRow | undefined> {
    return this.issueRows(organizationId, filter).where("gi.id", "=", issueId).executeTakeFirst();
  }

  /**
   * The playbook select, org-scoped, with the workflow slug and the counted launches.
   *
   * @param organizationId - The workspace.
   * @returns The query, open to a where and an order.
   */
  private rows(organizationId: string) {
    return this.database.db
      .selectFrom("playbooks as p")
      .innerJoin("workflows as w", "w.id", "p.workflow_id")
      .select([
        "p.id",
        "p.name",
        "p.description",
        "p.workflow_id",
        "w.slug as workflow_slug",
        "p.workflow_version",
        "p.skill_overrides",
        "p.context_preset",
        "p.issue_filter",
        "p.source_run_id",
        "p.created_at",
        "p.updated_at",
        (eb) =>
          eb
            .selectFrom("runs as r")
            .select(sql<string>`count(*)`.as("n"))
            .whereRef("r.playbook_id", "=", "p.id")
            .whereRef("r.organization_id", "=", "p.organization_id")
            .as("run_count"),
      ])
      .where("p.organization_id", "=", organizationId)
      .$castTo<PlaybookRow>();
  }

  /**
   * The issue select, org-scoped, with its repository, queue state and the filter's verdict.
   *
   * @param organizationId - The workspace.
   * @param filter - The stored filter, or `null`.
   * @returns The query.
   */
  private issueRows(organizationId: string, filter: unknown) {
    return this.database.db
      .selectFrom("github_issues as gi")
      .innerJoin("github_repos as gr", "gr.id", "gi.github_repo_id")
      .innerJoin("github_orgs as go", "go.id", "gr.org_id")
      .select([
        "gi.id as id",
        "gi.number as number",
        "gi.title as title",
        sql<string>`lower(go.login || '/' || gr.name)`.as("repo"),
        "gi.labels as labels",
        "gi.sizing_status as sizingStatus",
        (eb) =>
          eb
            .exists(
              eb
                .selectFrom("queue_items as qi")
                .select("qi.id")
                .whereRef("qi.organization_id", "=", "gi.organization_id")
                .whereRef("qi.issue_number", "=", "gi.number"),
            )
            .as("queued"),
        admits(filter).as("admitted"),
      ])
      .where("gi.organization_id", "=", organizationId)
      .$castTo<IssueRow>();
  }
}

/**
 * V072's `playbook_issue_filter_admits` for one issue row of {@link PlaybooksRepository}'s selects.
 *
 * @param filter - The stored filter, or `null` (admits every issue).
 * @returns The call, over `lower(owner/name)` and `gi.labels`.
 */
function admits(filter: unknown): RawBuilder<SqlBool> {
  const document = filter === null || filter === undefined ? null : JSON.stringify(filter);

  return sql<SqlBool>`ouroboros.playbook_issue_filter_admits(${document}::jsonb, lower(go.login || '/' || gr.name), gi.labels)`;
}

/**
 * @param text - A search term.
 * @returns It, with `ilike`'s wildcards escaped.
 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (match) => `\\${match}`);
}
