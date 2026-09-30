/**
 * The skills registry's statements (BF.1, [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * V069's `skills` and `skill_versions`, read and written on `WorkflowsRepository`'s model. Every
 * statement that takes an organization is scoped by it, and every statement keyed by a skill id is
 * handed an id the service resolved through {@link SkillsRepository.findBySlug} first —
 * `skill_versions` carries no `organization_id` (V069, for V029's reason), so that resolution is
 * its tenancy check.
 *
 * The rules are the database's: the slug's uniqueness, one draft per skill, dense version numbers,
 * published immutability, `required ⇒ enabled`. This file does not re-check them; the service
 * catches each by name.
 *
 * Three reads reach past the two tables, and each says why:
 *
 *   * {@link SkillsRepository.referencingWorkflows} reads `workflow_versions.definition` — a
 *     skill reference is a validated *string* (decision P7), not a foreign key, so the delete
 *     guard and the scope preview find references by looking in the documents;
 *   * {@link SkillsRepository.universe} reads the GitHub mirror and the workflows, for a scope
 *     move's reach;
 *   * {@link SkillsRepository.usage} reads `context_injections` (V071) and the runs they name, for
 *     the Used-by column.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Skill, SkillOrigin, SkillScope, SkillVersion } from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";
import { asCount, queryOn } from "../tenancy/queries";
import type { ReachUniverse } from "./skills.scope";
import type { SkillReference, SkillRow, WorkflowRef } from "./skills.resources";
import type { InjectedRun } from "./skills.usage";

/** What {@link SkillsRepository.create} writes. */
export interface NewSkillInput {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly scope: SkillScope;
  readonly repoRef: string | null;
  readonly workflowId: string | null;
  readonly origin: SkillOrigin;
  /** Whether the skill starts life as a draft — never injected until promoted. */
  readonly draft: boolean;
  /** The first draft's frontmatter. */
  readonly frontmatter: unknown;
  /** The first draft's markdown. */
  readonly body: string;
}

/** What {@link SkillsRepository.update} may change on the registry row. */
export interface SkillChanges {
  readonly enabled?: boolean;
  readonly required?: boolean;
  readonly draft?: boolean;
  readonly scope?: SkillScope;
  readonly repo_ref?: string | null;
  readonly workflow_id?: string | null;
}

/** What {@link SkillsRepository.publish} stamps a version with. */
export interface PublishSkillInput {
  readonly changeNote: string | null;
  readonly publishedBy: string | null;
  readonly publishedAt: Date;
  /** The frontmatter's name, which the registry row takes. */
  readonly name: string;
  /** The frontmatter's description, which the registry row takes. */
  readonly description: string;
}

/** One `(skill, run)` pair: a run whose manifests carried a version of the skill. */
export interface CarriedRun {
  readonly skillId: string;
  readonly runId: string;
}

/** Everything the Used-by column is counted from, for one window. */
export interface UsageRecords {
  /** Every run context was assembled for in the window. */
  readonly runs: readonly InjectedRun[];
  /** Which of those runs carried which skill. */
  readonly carried: readonly CarriedRun[];
  /** Manifests in the window carrying a version of each skill, every consumer. */
  readonly injections: ReadonlyMap<string, number>;
}

@Injectable()
export class SkillsRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every skill of a workspace, with the two facts the table shows beside the row.
   *
   * @param organizationId - The workspace.
   * @returns The rows, by slug.
   */
  async list(organizationId: string): Promise<SkillRow[]> {
    return this.rows(this.database.db, organizationId).orderBy("skills.slug").execute();
  }

  /**
   * One skill, by the slug a workflow names it with.
   *
   * @param organizationId - The workspace.
   * @param slug - The slug.
   * @param trx - The transaction to read in, when there is one.
   * @returns The row, or `undefined` — absent and another workspace's alike.
   */
  async findBySlug(
    organizationId: string,
    slug: string,
    trx?: Transaction<Database>,
  ): Promise<SkillRow | undefined> {
    return this.rows(queryOn(this.database, trx), organizationId)
      .where("skills.slug", "=", slug)
      .executeTakeFirst();
  }

  /**
   * Lock one skill's row for the rest of a transaction.
   *
   * @param organizationId - The workspace.
   * @param slug - The slug.
   * @param trx - The transaction.
   * @returns The row as locked, or `undefined` when it is gone.
   */
  async lock(
    organizationId: string,
    slug: string,
    trx: Transaction<Database>,
  ): Promise<Skill | undefined> {
    return trx
      .selectFrom("skills")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("slug", "=", slug)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * Create a skill and its first draft, atomically.
   *
   * @param organizationId - The workspace.
   * @param input - The row and the draft.
   * @returns The skill's id.
   */
  async create(organizationId: string, input: NewSkillInput): Promise<string> {
    return this.database.transaction(async (trx) => {
      const skill = await trx
        .insertInto("skills")
        .values({
          organization_id: organizationId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          scope: input.scope,
          repo_ref: input.repoRef,
          workflow_id: input.workflowId,
          origin: input.origin,
          draft: input.draft,
          current_version: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      await this.insertDraft(skill.id, input.frontmatter, input.body, trx);

      return skill.id;
    });
  }

  /**
   * A skill's draft version.
   *
   * @param skillId - A skill the caller resolved.
   * @param trx - The transaction, when there is one.
   * @param lock - `for update`, for a guarded write.
   * @returns The draft, or `undefined` when there is none.
   */
  async draftOf(
    skillId: string,
    trx?: Transaction<Database>,
    lock = false,
  ): Promise<SkillVersion | undefined> {
    const query = queryOn(this.database, trx)
      .selectFrom("skill_versions")
      .selectAll()
      .where("skill_id", "=", skillId)
      .where("version", "is", null);

    return (lock ? query.forUpdate() : query).executeTakeFirst();
  }

  /**
   * Write a first draft.
   *
   * @param skillId - A skill the caller resolved.
   * @param frontmatter - The parsed frontmatter.
   * @param body - The markdown.
   * @param trx - The transaction, when there is one.
   * @returns The draft. `skill_versions_one_draft_idx` refuses a second.
   */
  async insertDraft(
    skillId: string,
    frontmatter: unknown,
    body: string,
    trx?: Transaction<Database>,
  ): Promise<SkillVersion> {
    return queryOn(this.database, trx)
      .insertInto("skill_versions")
      .values({
        skill_id: skillId,
        version: null,
        body,
        frontmatter: JSON.stringify(frontmatter),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Overwrite a draft.
   *
   * @param draftId - The draft row.
   * @param frontmatter - The parsed frontmatter.
   * @param body - The markdown.
   * @param trx - The transaction, when there is one.
   * @returns The draft, or `undefined` when the row stopped being a draft.
   */
  async writeDraft(
    draftId: string,
    frontmatter: unknown,
    body: string,
    trx?: Transaction<Database>,
  ): Promise<SkillVersion | undefined> {
    return queryOn(this.database, trx)
      .updateTable("skill_versions")
      .set({ body, frontmatter: JSON.stringify(frontmatter) })
      .where("id", "=", draftId)
      .where("version", "is", null)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * One published version.
   *
   * @param skillId - A skill the caller resolved.
   * @param version - The number.
   * @returns The row, or `undefined`.
   */
  async versionAt(skillId: string, version: number): Promise<SkillVersion | undefined> {
    return this.database.db
      .selectFrom("skill_versions")
      .selectAll()
      .where("skill_id", "=", skillId)
      .where("version", "=", version)
      .executeTakeFirst();
  }

  /**
   * One page of the history, newest first, without documents.
   *
   * @param skillId - A skill the caller resolved.
   * @param window - `limit` and `offset`.
   * @returns The rows.
   */
  async versions(skillId: string, window: PageWindow) {
    return this.database.db
      .selectFrom("skill_versions")
      .select(["version", "published_at", "published_by", "change_note"])
      .where("skill_id", "=", skillId)
      .where("version", "is not", null)
      .orderBy("version", "desc")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
  }

  /**
   * @param skillId - A skill the caller resolved.
   * @returns How many published versions it has.
   */
  async countVersions(skillId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("skill_versions")
      .where("skill_id", "=", skillId)
      .where("version", "is not", null)
      .select(sql<string>`count(*)`.as("total"))
      .executeTakeFirstOrThrow();

    return asCount(row.total);
  }

  /**
   * Publish a draft: give it the next number, and point the skill at it.
   *
   * The draft row *becomes* the version — V069's model, *"publishing is the draft being given the
   * next number"* — so after a publish there is no draft, and the next edit starts one.
   *
   * @param skillId - A skill the caller resolved and locked.
   * @param draftId - Its draft, locked in the same transaction.
   * @param input - The stamp, and the name and description the row takes from the frontmatter.
   * @param trx - The transaction.
   * @returns The version as stored.
   */
  async publish(
    skillId: string,
    draftId: string,
    input: PublishSkillInput,
    trx: Transaction<Database>,
  ): Promise<SkillVersion> {
    const highest = await trx
      .selectFrom("skill_versions")
      .where("skill_id", "=", skillId)
      .select(sql<number | null>`max(version)`.as("highest"))
      .executeTakeFirstOrThrow();

    // Offered, not assigned: `skill_versions_next_version` refuses anything but max + 1.
    const next = (highest.highest ?? 0) + 1;

    const version = await trx
      .updateTable("skill_versions")
      .set({
        version: next,
        published_at: input.publishedAt,
        published_by: input.publishedBy,
        change_note: input.changeNote,
      })
      .where("id", "=", draftId)
      .where("version", "is", null)
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .updateTable("skills")
      .set({ current_version: next, name: input.name, description: input.description })
      .where("id", "=", skillId)
      .execute();

    return version;
  }

  /**
   * Change the registry row.
   *
   * @param skillId - A skill the caller resolved.
   * @param changes - The columns to set.
   * @param trx - The transaction, when there is one.
   */
  async update(skillId: string, changes: SkillChanges, trx?: Transaction<Database>): Promise<void> {
    await queryOn(this.database, trx)
      .updateTable("skills")
      .set({ ...changes })
      .where("id", "=", skillId)
      .execute();
  }

  /**
   * Delete a skill; its versions cascade.
   *
   * @param skillId - A skill the caller resolved.
   * @param trx - The transaction, when there is one.
   */
  async delete(skillId: string, trx?: Transaction<Database>): Promise<void> {
    await queryOn(this.database, trx).deleteFrom("skills").where("id", "=", skillId).execute();
  }

  /**
   * The published workflows whose version in force names a skill.
   *
   * "Published" is a workflow with a version in force, and not archived: an archived workflow
   * runs nothing, and a draft names nothing that runs. The reference is a `llm` stage's
   * `config.skill` — the only place the DSL names a skill.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill's slug.
   * @param trx - The transaction, when there is one.
   * @returns The workflows, by slug.
   */
  async referencingWorkflows(
    organizationId: string,
    slug: string,
    trx?: Transaction<Database>,
  ): Promise<SkillReference[]> {
    const result = await sql<SkillReference>`
      select w.id, w.slug, w.name, w.current_version as version
        from ouroboros.workflows w
        join ouroboros.workflow_versions v
          on v.workflow_id = w.id and v.version = w.current_version
       where w.organization_id = ${organizationId}
         and w.status <> 'archived'
         and jsonb_typeof(v.definition -> 'nodes') = 'array'
         and exists (select 1
                       from jsonb_array_elements(v.definition -> 'nodes') as node
                      where node ->> 'type' = 'llm'
                        and node -> 'config' ->> 'skill' = ${slug})
       order by w.slug`.execute(queryOn(this.database, trx));

    return result.rows;
  }

  /**
   * A workflow of this workspace, for a workflow-scoped target.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns Its id and slug, or `undefined` — absent and another workspace's alike.
   */
  async workflowRef(organizationId: string, workflowId: string): Promise<WorkflowRef | undefined> {
    return this.database.db
      .selectFrom("workflows")
      .select(["id", "slug"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", workflowId)
      .executeTakeFirst();
  }

  /**
   * What a scope's reach is measured against.
   *
   * @param organizationId - The workspace.
   * @param trx - The transaction, when there is one.
   * @returns The workspace's mirrored repositories as `owner/name`, and its workflows that are not
   *   archived, each by name.
   */
  async universe(organizationId: string, trx?: Transaction<Database>): Promise<ReachUniverse> {
    const db = queryOn(this.database, trx);
    const [repos, workflows] = await Promise.all([
      db
        .selectFrom("github_repos as r")
        .innerJoin("github_orgs as o", "o.id", "r.org_id")
        .select(sql<string>`o.login || '/' || r.name`.as("ref"))
        .where("o.organization_id", "=", organizationId)
        .orderBy("ref")
        .execute(),
      db
        .selectFrom("workflows")
        .select(["id", "slug"])
        .where("organization_id", "=", organizationId)
        .where("status", "<>", "archived")
        .orderBy("slug")
        .execute(),
    ]);

    return { repos: repos.map((row) => row.ref), workflows };
  }

  /**
   * Other skills at a target with the same name, compared case-insensitively.
   *
   * @param organizationId - The workspace.
   * @param skillId - The skill being moved, which is not its own clash.
   * @param name - Its name.
   * @param target - The destination's scope and referent.
   * @param trx - The transaction, when there is one.
   * @returns The clashing skills, by slug.
   */
  async nameClashes(
    organizationId: string,
    skillId: string,
    name: string,
    target: { scope: SkillScope; repoRef: string | null; workflowId: string | null },
    trx?: Transaction<Database>,
  ) {
    let query = queryOn(this.database, trx)
      .selectFrom("skills")
      .select(["id", "slug", "name"])
      .where("organization_id", "=", organizationId)
      .where("id", "<>", skillId)
      .where("scope", "=", target.scope)
      .where(sql<boolean>`lower(name) = lower(${name})`);

    if (target.scope === "repo") query = query.where("repo_ref", "=", target.repoRef);
    if (target.scope === "workflow") query = query.where("workflow_id", "=", target.workflowId);

    return query.orderBy("slug").execute();
  }

  /**
   * The slugs a workflow may name and expect injected: skills that are not drafts and have a
   * published version. What the stage catalog suggests and P7's reference check accepts.
   *
   * @param organizationId - The workspace.
   * @returns The slugs, sorted.
   */
  async catalogSlugs(organizationId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("skills")
      .select("slug")
      .where("organization_id", "=", organizationId)
      .where("draft", "=", false)
      .where("current_version", "is not", null)
      .orderBy("slug")
      .execute();

    return rows.map((row) => row.slug);
  }

  /**
   * The injection records of one window, shaped for the Used-by rule.
   *
   * @param organizationId - The workspace.
   * @param from - The window's start, inclusive.
   * @param to - Its end, exclusive.
   * @returns The runs, the carried pairs and the per-skill manifest counts.
   */
  async usage(organizationId: string, from: Date, to: Date): Promise<UsageRecords> {
    const db = this.database.db;
    const [runs, carried, injections] = await Promise.all([
      sql<InjectedRun>`
        select distinct injection.run_id as "runId",
               o.login || '/' || repo.name as "repoRef",
               run.workflow_tag as "workflowSlug",
               run.pr_number is not null as "openedPr",
               exists (select 1
                         from ouroboros.test_runs tr
                         join ouroboros.test_suites suite on suite.test_run_id = tr.id
                         join ouroboros.test_cases tc on tc.test_suite_id = suite.id
                         join ouroboros.hil_measurements m on m.test_case_id = tc.id
                        where tr.run_id = injection.run_id) as physical
          from ouroboros.context_injections injection
          join ouroboros.runs run on run.id = injection.run_id
          join ouroboros.github_repos repo on repo.id = run.github_repo_id
          join ouroboros.github_orgs o on o.id = repo.org_id
         where injection.organization_id = ${organizationId}
           and injection.injected_at >= ${from}
           and injection.injected_at < ${to}
         order by "runId"`.execute(db),
      sql<CarriedRun>`
        select distinct v.skill_id as "skillId", injection.run_id as "runId"
          from ouroboros.context_injections injection
          join ouroboros.skill_versions v on v.id = any (injection.skill_version_ids)
         where injection.organization_id = ${organizationId}
           and injection.run_id is not null
           and injection.injected_at >= ${from}
           and injection.injected_at < ${to}`.execute(db),
      sql<{ skillId: string; total: string }>`
        select v.skill_id as "skillId", count(distinct injection.id) as total
          from ouroboros.context_injections injection
          join ouroboros.skill_versions v on v.id = any (injection.skill_version_ids)
         where injection.organization_id = ${organizationId}
           and injection.injected_at >= ${from}
           and injection.injected_at < ${to}
         group by v.skill_id`.execute(db),
    ]);

    return {
      runs: runs.rows,
      carried: carried.rows,
      injections: new Map(injections.rows.map((row) => [row.skillId, asCount(row.total)])),
    };
  }

  /**
   * The select every skill read shares: the row, its workflow's slug, and when its version in
   * force was published.
   *
   * @param db - The pool or a transaction.
   * @param organizationId - The workspace.
   * @returns The query, before any per-read predicate.
   */
  private rows(db: ReturnType<typeof queryOn>, organizationId: string) {
    return db
      .selectFrom("skills")
      .leftJoin("workflows", "workflows.id", "skills.workflow_id")
      .leftJoin("skill_versions as current", (join) =>
        join
          .onRef("current.skill_id", "=", "skills.id")
          .onRef("current.version", "=", "skills.current_version"),
      )
      .selectAll("skills")
      .select(["workflows.slug as workflow_slug", "current.published_at as current_published_at"])
      .where("skills.organization_id", "=", organizationId);
  }
}
