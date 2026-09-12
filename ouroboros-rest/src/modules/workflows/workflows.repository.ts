/**
 * Every statement the workflow lifecycle issues — P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * ```
 * find / create / rename        the entity: one workspace's rows, and the rail's order
 * draftOf / writeDraft          the one mutable row a workflow has
 * versions / countVersions      the history, newest first
 * versionAt                     one published version, for `?version=` and for the chip
 * publish                       the whole of the publish write, in one transaction
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## Org scoping is not optional and is not the client's
 *
 * `dashboard.repository.ts`' rule, for its reason: every method that can be reached from a
 * request takes `organizationId` first and every statement filters on it, because the value
 * comes from the tenant context and never from anything a caller wrote — and because the
 * failure a missing predicate causes is *silent*. `workflows.repository.spec.ts` asserts the
 * predicate is present in every compiled statement, and the lifecycle integration suite
 * asserts the consequence against two workspaces holding the same slugs.
 *
 * **The version statements are scoped through the workflow instead**, which is V029's own
 * design: *"a version has no meaning apart from a workflow and every read enters through
 * one"*, so `workflow_versions` carries no `organization_id` for a predicate to name. Every
 * method below that touches it therefore takes a `workflowId` this service has **already
 * resolved through** {@link WorkflowsRepository.find} — that call is the tenancy check, and
 * skipping it is the one way to read another workspace's history through these statements.
 *
 * ## What this file refuses to decide
 *
 * The numbering rule, the immutability rule and the at-most-one-draft rule are V029's
 * triggers and indexes, not predicates here. {@link WorkflowsRepository.publish} computes
 * `max + 1` and offers it; `workflow_versions_next_version` is what agrees or refuses, and
 * `workflow_versions_workflow_version_key` is what makes two publishers racing produce one
 * winner and one `23505` rather than two versions numbered alike. This file's job is to let
 * those rules speak, which is why nothing here catches a constraint — `workflows.service.ts`
 * translates them, one layer up, where the request they belong to is still in scope.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Workflow, WorkflowStatus, WorkflowVersion } from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";
import { asCount, queryOn } from "../tenancy/queries";

/** What {@link WorkflowsRepository.create} is given. */
export interface NewWorkflowInput {
  /** The slug — lower-case kebab, held to `workflows_slug_format` by the database. */
  readonly slug: string;
  /** The human title. */
  readonly name: string;
  /** The document the draft starts life holding — `{}` for a blank canvas. */
  readonly definition: unknown;
}

/** What {@link WorkflowsRepository.rename} may change. */
export interface WorkflowChanges {
  /** The new title, when the request carried one. */
  readonly name?: string;
  /** The new status — `paused` is the rail's err-dot, `archived` the soft delete. */
  readonly status?: WorkflowStatus;
}

/** What {@link WorkflowsRepository.publish} stamps the new version with. */
export interface PublishInput {
  /** The document to freeze — the draft's, read inside the same transaction. */
  readonly definition: unknown;
  /** What changed, in the publisher's words, or `null` for a publish with nothing to say. */
  readonly changeNote: string | null;
  /** Who pressed Publish — `"user"."id"`, or `null` for a publish with no person behind it. */
  readonly publishedBy: string | null;
  /** When. Passed in rather than read here, so one request has one instant. */
  readonly publishedAt: Date;
}

/**
 * One row of the history, as {@link WorkflowsRepository.versions} returns it.
 *
 * The published columns with the document left out, and `version`/`published_at` narrowed to
 * non-null because the statement's own predicate and
 * `workflow_versions_version_publish_stamp` together make them so.
 */
export interface PublishedVersionRow {
  /** The `v14` chip's number. */
  readonly version: number;
  /** When this became a version. */
  readonly published_at: Date;
  /** Who pressed Publish, or `null` once that person has been deleted. */
  readonly published_by: string | null;
  /** What changed, in the publisher's words, or `null` for a publish with nothing to say. */
  readonly change_note: string | null;
  /** When the row was written — the same instant as {@link published_at} for a copy-on-publish. */
  readonly created_at: Date;
}

/** A workflow and the draft it was created with. */
export interface CreatedWorkflow {
  /** The entity, as it was stored. */
  readonly workflow: Workflow;
  /** Its draft — always present, which is what makes the etag of a new workflow well defined. */
  readonly draft: WorkflowVersion;
}

@Injectable()
export class WorkflowsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One workflow, if it is this workspace's to see.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow's id, already validated as a uuid.
   * @param trx - The transaction to read in, when the caller is inside one.
   * @returns The row, or `undefined` — which covers "no such workflow" and "somebody else's
   *   workflow" in one answer, deliberately. The service turns it into the `404`; nothing
   *   between here and there can tell the two cases apart, which is the point.
   */
  async find(
    organizationId: string,
    id: string,
    trx?: Transaction<Database>,
  ): Promise<Workflow | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("workflows")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * One workflow, locked against a concurrent publish.
   *
   * `for update` on the entity row rather than on the version table, because the thing two
   * publishers contend for is *this workflow's next number* and the entity is the one row they
   * both have. Holding it turns the common race into a wait instead of a `23505` somebody has
   * to be told about — V029's unique key is still what makes the rule true, and still refuses a
   * publisher that arrived through some other path.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @param trx - The transaction. Required: a row lock outside one is released immediately and
   *   would be a lock in name only.
   * @returns The row, or `undefined` when it is absent or another workspace's.
   */
  async lock(
    organizationId: string,
    id: string,
    trx: Transaction<Database>,
  ): Promise<Workflow | undefined> {
    return trx
      .selectFrom("workflows")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * Create a workflow and the draft it starts life with, together.
   *
   * One transaction, because a workflow with no draft is a state this API does not otherwise
   * produce and would leave the studio's first autosave with nothing to match against. Either
   * both rows exist or neither does.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param input - The slug, the title, and the document the canvas opens on.
   * @returns Both rows as they were stored.
   */
  async create(organizationId: string, input: NewWorkflowInput): Promise<CreatedWorkflow> {
    return this.database.transaction(async (trx) => {
      const workflow = await trx
        .insertInto("workflows")
        .values({
          organization_id: organizationId,
          slug: input.slug,
          name: input.name,
          // `active` is the column's own default; stating it here is what makes the created
          // status readable beside the create rather than in a migration.
          status: "active",
          current_version: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const draft = await this.insertDraft(workflow.id, input.definition, trx);

      return { workflow, draft };
    });
  }

  /**
   * Change a workflow's title, its status, or both.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @param changes - What the request asked to change. A call with neither field is the
   *   caller's to refuse; this would issue an `update` with nothing in it.
   * @returns The row after the change, or `undefined` when the id names nothing this workspace
   *   may see — the same answer {@link find} gives, so a `PATCH` and a `GET` agree about what
   *   exists.
   */
  async rename(
    organizationId: string,
    id: string,
    changes: WorkflowChanges,
  ): Promise<Workflow | undefined> {
    return this.database.db
      .updateTable("workflows")
      .set({
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * The one draft a workflow may have.
   *
   * `version is null` *is* the draft (V029), and this predicate is
   * `workflow_versions_one_draft_idx` exactly — the partial unique index the migration
   * describes as *"the index the studio's open-the-draft read uses"*.
   *
   * @param workflowId - A workflow already resolved through {@link find}; see this file's
   *   header on why that resolution is the tenancy check.
   * @param trx - The transaction to read in, when the caller is inside one.
   * @param lock - Take a row lock on the draft. `false` for a read; `true` for the read a
   *   write is about to be based on, which is what turns two concurrent autosaves into one
   *   that commits and one that sees the new etag — rather than two that both passed an
   *   `If-Match` against the same stale row. Meaningless outside a transaction, where a lock
   *   is released the instant the statement ends.
   * @returns The draft, or `undefined` when the workflow has none. A `for update` on no row
   *   locks nothing, which is why two writers that both find none are separated by
   *   `workflow_versions_one_draft_idx` instead.
   */
  async draftOf(
    workflowId: string,
    trx?: Transaction<Database>,
    lock = false,
  ): Promise<WorkflowVersion | undefined> {
    const query = queryOn(this.database, trx)
      .selectFrom("workflow_versions")
      .selectAll()
      .where("workflow_id", "=", workflowId)
      .where("version", "is", null);

    return (lock ? query.forUpdate() : query).executeTakeFirst();
  }

  /**
   * Create the draft a workflow does not have yet.
   *
   * Not upserting, deliberately: two requests that both found no draft must not both succeed,
   * and `workflow_versions_one_draft_idx` is what makes exactly one of them commit. The loser's
   * `23505` is a `409` the studio can act on, where an upsert would have quietly made the
   * second write win.
   *
   * @param workflowId - A workflow already resolved through {@link find}.
   * @param definition - The document to store. Serialised here, because Kysely wants the value
   *   a driver will send for a `jsonb` column and `pg` hands it back parsed.
   * @param trx - The transaction to write in, when the caller is inside one.
   * @returns The draft as it was stored.
   */
  async insertDraft(
    workflowId: string,
    definition: unknown,
    trx?: Transaction<Database>,
  ): Promise<WorkflowVersion> {
    return queryOn(this.database, trx)
      .insertInto("workflow_versions")
      .values({
        workflow_id: workflowId,
        version: null,
        definition: JSON.stringify(definition),
        published_at: null,
        published_by: null,
        change_note: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Replace the document a draft holds.
   *
   * Keyed by the draft's own id **and** by `version is null`, so a row that became a version
   * between the read and this write is not edited — `workflow_versions_no_update` would refuse
   * it anyway, and an `update` that matches nothing is the answer the caller can turn into the
   * conflict it really is.
   *
   * @param draftId - The draft row's id, from {@link draftOf}.
   * @param definition - The document to store.
   * @param trx - The transaction to write in, when the caller is inside one.
   * @returns The draft after the write — stamped by `workflow_versions_touch_updated_at`,
   *   which is where the mockup's *Last edited* comes from. `undefined` when the row is no
   *   longer a draft.
   */
  async writeDraft(
    draftId: string,
    definition: unknown,
    trx?: Transaction<Database>,
  ): Promise<WorkflowVersion | undefined> {
    return queryOn(this.database, trx)
      .updateTable("workflow_versions")
      .set({ definition: JSON.stringify(definition) })
      .where("id", "=", draftId)
      .where("version", "is", null)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * One page of a workflow's published versions, newest first.
   *
   * `order by version desc` is `workflow_versions_workflow_version_key` read backwards — the
   * migration's own note that the unique key *is* the history's index.
   *
   * **The definitions are deliberately not selected.** A definition holds a prompt template
   * per model stage — up to 20 000 characters each by the DSL's own bound — so a history of
   * twenty versions would move megabytes to render a list of numbers, notes and dates.
   * `stats.repository.ts` makes the same call for the same reason. A client that wants one
   * document asks for it by number, which is what `?version=` is.
   *
   * @param workflowId - A workflow already resolved through {@link find}.
   * @param window - Which rows of the history to return.
   * @returns The rows, without their documents. Drafts are excluded: an unnumbered row is not
   *   history, and `version desc` has nowhere to put it.
   */
  async versions(workflowId: string, window: PageWindow): Promise<PublishedVersionRow[]> {
    const rows = await this.database.db
      .selectFrom("workflow_versions")
      .select(["version", "published_at", "published_by", "change_note", "created_at"])
      .where("workflow_id", "=", workflowId)
      .where("version", "is not", null)
      .orderBy("version", "desc")
      .limit(window.limit)
      .offset(window.offset)
      .execute();

    // `version is not null` is the predicate above, and `workflow_versions_version_publish_stamp`
    // is what makes `published_at` non-null exactly when `version` is — so the narrowing below
    // restates two rules the database already keeps rather than assuming anything new.
    return rows.map((row) => ({
      ...row,
      version: row.version as number,
      published_at: row.published_at as Date,
    }));
  }

  /**
   * How many published versions a workflow has — the `total` the #31 convention promises.
   *
   * @param workflowId - A workflow already resolved through {@link find}.
   * @returns The count, drafts excluded exactly as {@link versions} excludes them.
   */
  async countVersions(workflowId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("workflow_versions")
      .where("workflow_id", "=", workflowId)
      .where("version", "is not", null)
      .select(sql<string>`count(*)`.as("total"))
      .executeTakeFirstOrThrow();

    return asCount(row.total);
  }

  /**
   * One published version of one workflow.
   *
   * @param workflowId - A workflow already resolved through {@link find}.
   * @param version - The number, from `?version=` or from `workflows.current_version`.
   * @returns The row, or `undefined` when that workflow has no such version. Never a draft:
   *   `version` is the key, and a draft has none.
   */
  async versionAt(workflowId: string, version: number): Promise<WorkflowVersion | undefined> {
    return this.database.db
      .selectFrom("workflow_versions")
      .selectAll()
      .where("workflow_id", "=", workflowId)
      .where("version", "=", version)
      .executeTakeFirst();
  }

  /**
   * Freeze a definition as the next version, and put it in force.
   *
   * One transaction holding three statements, and the order is the argument for it: the
   * highest number is read, the version is inserted at one above it, and only then does
   * `workflows.current_version` move. A failure anywhere in that sequence — the numbering
   * trigger, the unique key, the composite foreign key — rolls the whole of it back, which is
   * the ticket's *nothing is written* criterion as a property of the write rather than as an
   * ordering somebody has to keep.
   *
   * **The draft is left where it is.** V029 permits either shape, and copying is the one that
   * makes the studio's next edit ordinary: the canvas still has a draft to autosave into, its
   * etag is unchanged, and the version that just became immutable is a separate row nothing
   * will try to edit. Promoting the draft in place would leave a workflow with no draft and a
   * client with no etag to write against until it created one.
   *
   * @param workflowId - A workflow already resolved through {@link find} — and, for a publish,
   *   through {@link lock}.
   * @param input - The document, the note, the publisher and the instant.
   * @param trx - The transaction. Required: the two writes are only atomic together, and a
   *   caller that had to remember to open one would eventually not.
   * @returns The version as it was stored.
   */
  async publish(
    workflowId: string,
    input: PublishInput,
    trx: Transaction<Database>,
  ): Promise<WorkflowVersion> {
    const highest = await trx
      .selectFrom("workflow_versions")
      .where("workflow_id", "=", workflowId)
      .select(sql<number | null>`max(version)`.as("highest"))
      .executeTakeFirstOrThrow();

    // Offered, not assigned: `workflow_versions_next_version` refuses anything that is not
    // exactly one above the highest, which is what makes two publishers that computed the same
    // number produce one winner rather than a gap.
    const next = (highest.highest ?? 0) + 1;

    const version = await trx
      .insertInto("workflow_versions")
      .values({
        workflow_id: workflowId,
        version: next,
        definition: JSON.stringify(input.definition),
        published_at: input.publishedAt,
        published_by: input.publishedBy,
        change_note: input.changeNote,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .updateTable("workflows")
      .set({ current_version: next })
      .where("id", "=", workflowId)
      .execute();

    return version;
  }
}
