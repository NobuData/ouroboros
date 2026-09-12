/**
 * The three statements the rail's statistics are read with — P.4
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * ```
 * registryEntries()  one row per rail entry: the workflow, and the two facts its definition yields
 * runShares()        one row per workflow tag: how many runs in the window carried it
 * activeSlugs()      the assign-workflow vocabulary — the amendment carried in from #124
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` as its first parameter and every statement filters on
 * it — `dashboard.repository.ts`' rule, for its reason: the value comes from the tenant
 * context and never from anything a caller wrote, and the failure a missing predicate causes
 * is *silent*, because a query that forgot it would answer, and would answer with somebody
 * else's numbers mixed in. `stats.repository.spec.ts` asserts the predicate is present in
 * every compiled statement, and `workflows.integration-spec.ts` asserts the consequence
 * against two workspaces with the same slugs — the ticket's cross-org criterion.
 *
 * ## The definition is read *in* PostgreSQL, and only two facts come back
 *
 * A stage count is `jsonb_array_length(definition -> 'nodes')` and the terminal behaviour is
 * the `action` of every `term` node. Both are asked of the database rather than by fetching
 * the documents and counting here, and the reason is size: a definition holds a prompt
 * template per model stage — up to 20 000 characters each by the DSL's own bound — so a rail
 * of twenty workflows would move megabytes of prose to compute two integers and a handful of
 * words. What crosses the wire is the answer.
 *
 * The *policy* stays in TypeScript. Which terminal wins, what the words are, and what a
 * workflow with no version in force reads instead are all `stats.captions.ts`', where they can
 * be tested without a database; this file decides nothing it could be asked about.
 *
 * ## Nothing here trusts the document
 *
 * `workflow_versions_definition_object` CHECKs `definition` to be a jsonb *object* and no
 * further — deliberately, because the grammar has one owner (P.2) and an empty `{}` is the
 * legal state of a canvas nobody has placed a node on. So a stored document may hold anything
 * an object can hold, and every jsonb expression below is guarded: `jsonb_array_length` raises
 * `22023` on a value that is not an array and `jsonb_array_elements` raises it on a value that
 * is not an array either, which would turn one malformed draft into a 500 for the whole rail.
 * A definition this build cannot read produces a null stage count and no terminals, which
 * `stats.captions.ts` renders as an unpublished workflow — the honest answer, since a document
 * whose `nodes` is not an array has no stages to name.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { WorkflowStatus } from "../db/schema";
import type { NodeType } from "./dsl.schema";

/**
 * The `type` a terminal node carries, from the DSL's own vocabulary.
 *
 * Typed as a {@link NodeType} rather than written into the SQL as a bare string, so that a
 * rename in `dsl.schema.ts` is a compile error here rather than a caption that quietly stops
 * finding terminals. Bound as a parameter by the statement below for the same reason it is a
 * constant here: there is one place the word is written down.
 */
const TERMINAL_NODE_TYPE: NodeType = "term";

/**
 * The status a workflow is off the rail at.
 *
 * `archived` is V029's soft delete — *"the soft delete that keeps a workflow's history
 * readable after it stops being offered"* — so it is excluded from the rail and from the
 * assign-workflow vocabulary, while its rows and its version history stay where they are.
 */
const ARCHIVED: WorkflowStatus = "archived";

/** The status a workflow is offered for assignment at. */
const ACTIVE: WorkflowStatus = "active";

/** One rail entry, as {@link WorkflowStatsRepository.registryEntries} returns it. */
export interface WorkflowRegistryRow {
  /** `workflows.id`. */
  readonly id: string;
  /** The slug — the bridge a stored `workflow_tag` resolves through. */
  readonly slug: string;
  /** The human title the page head prints. */
  readonly name: string;
  /** `active`, or `paused` for the mockup's err-dot entry. Never `archived`; see this file's header. */
  readonly status: WorkflowStatus;
  /** The `v14` chip's number, or `null` for a workflow that has only ever had a draft. */
  readonly current_version: number | null;
  /**
   * How many nodes the definition in force holds.
   *
   * `null` when there is no version in force, and `null` when its `definition.nodes` is not a
   * JSON array — the two cases a caption cannot honestly count. Never `0` for a real document:
   * the DSL requires at least one node, so a published version has stages.
   */
  readonly stage_count: number | null;
  /**
   * The `action` of every `term` node in the definition in force, in document order.
   *
   * Empty rather than null for a workflow with no version in force, because "no terminals" is
   * the answer in both cases and a caller that had to branch on null *and* on empty would
   * eventually forget one. Values are whatever the document stored — `stats.captions.ts`
   * ignores any the DSL does not define.
   */
  readonly terminal_actions: string[];
}

/** How many runs in the window carried one workflow tag. */
export interface WorkflowRunShare {
  /** The tag as the run stored it — opaque by decision **F8**, and a slug by V029's bound. */
  readonly workflow_tag: string;
  /** How many runs in the window carried it. At least 1: a tag with no runs has no row. */
  readonly runs: number;
}

@Injectable()
export class WorkflowStatsRepository {
  /**
   * @param database - The Kysely instance, from the non-global `DbModule` — the import in
   *   `workflows.module.ts` is the answer to *who can reach these tables*.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every workflow the rail lists, with the two facts its definition in force yields.
   *
   * **The definition is reached through `current_version`, not through the newest row.** The
   * `v14` chip is what is *in force*, and V029 is emphatic that `current_version` is a pointer
   * rather than a cache of `max(version)` — a workflow can carry a draft and several published
   * versions while an older one runs. So the join is on `(workflow_id, version)`, which is
   * `workflow_versions_workflow_version_key` exactly, and it is a `left join` because a
   * workflow with only a draft has nothing to join to and still belongs on the rail.
   *
   * **Ordered by `created_at`, then by slug.** The mockup's rail is neither alphabetical
   * (`deps-refresh` would lead) nor arbitrary — it reads in the order the workflows came into
   * being, which is the order a seed inserts them and the order a person added them. The slug
   * breaks the tie a single statement's identical stamps would otherwise leave to the planner,
   * so the rail does not reshuffle between two reads.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns One row per non-archived workflow. Empty for a workspace with none, which is the
   *   ordinary state of one that has not opened the studio.
   */
  async registryEntries(organizationId: string): Promise<WorkflowRegistryRow[]> {
    // The definition's `nodes`, or an empty array when the version in force has no readable
    // one — including the case of no version in force at all, where `definition` is null and
    // `-> 'nodes'` is null with it.
    //
    // It is what `jsonb_array_elements` is handed, and it deliberately is *not* what the stage
    // count is taken from: the two unreadable cases want different answers. An empty array is
    // the right input to "which terminals does this hold" (none of them), while a stage count
    // over it would be `0` — a number about a document nobody published. So the count carries
    // its own guard, a `case` with no `else`, and evaluates to null instead.
    const nodes = sql`case
      when jsonb_typeof(v.definition -> 'nodes') = 'array' then v.definition -> 'nodes'
      else '[]'::jsonb
    end`;

    return this.database.db
      .selectFrom("workflows as w")
      .leftJoin("workflow_versions as v", (join) =>
        join.onRef("v.workflow_id", "=", "w.id").onRef("v.version", "=", "w.current_version"),
      )
      .where("w.organization_id", "=", organizationId)
      .where("w.status", "!=", ARCHIVED)
      .select([
        "w.id",
        "w.slug",
        "w.name",
        "w.status",
        "w.current_version",
        // Null rather than zero when there is nothing countable: `case` with no `else` is what
        // makes "no version in force" and "a document I cannot read" the same answer, and
        // `stats.captions.ts` is where that answer becomes a caption.
        sql<number | null>`case
          when jsonb_typeof(v.definition -> 'nodes') = 'array'
          then jsonb_array_length(v.definition -> 'nodes')
        end`.as("stage_count"),
        // `array_agg` returns null over no rows, so the coalesce is what makes the column a
        // `text[]` in every case. `with ordinality` is not needed: the elements of a jsonb
        // array come out in document order.
        sql<string[]>`coalesce((
          select array_agg(node.value -> 'config' ->> 'action')
            from jsonb_array_elements(${nodes}) as node
           where node.value ->> 'type' = ${TERMINAL_NODE_TYPE}
             and node.value -> 'config' ->> 'action' is not null
        ), '{}'::text[])`.as("terminal_actions"),
      ])
      .orderBy("w.created_at", "asc")
      .orderBy("w.slug", "asc")
      .execute();
  }

  /**
   * How many runs each workflow tag accounts for, over one window.
   *
   * **One statement, so the numerator and the denominator cannot disagree.** The share the
   * head prints is *this workflow's runs over all of them*, and computing the two halves in
   * two statements is `windows.ts`' whole warning: a run started on the boundary would be
   * inside one number and outside the other. The caller sums these rows for the total it
   * divides by, so both halves come from one snapshot of one index scan.
   *
   * **Windowed on `started_at`, which is when a workflow was used.** A run's `finished_at` is
   * null while it is in flight — `runs_terminal_finished_at` — so windowing on it would leave
   * every live loop out of *used by N% of runs*, which is precisely the usage a studio reader
   * is asking about. `started_at` is `not null`, so no run escapes the denominator.
   *
   * **Grouped by the raw tag rather than joined to `workflows`.** Decision **F8** keeps
   * `runs.workflow_tag` opaque and V029 deliberately added no foreign key, so a run whose
   * workflow was renamed or deleted still counts towards the total — which is the honest
   * denominator, since it is still a run this workspace performed. Tags that resolve to no
   * workflow simply match no rail entry.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param since - The start of the window, computed once per request by the caller.
   * @returns One row per tag with at least one run in the window; empty for a workspace whose
   *   window holds none, which is what `no runs yet` is rendered from.
   */
  async runShares(organizationId: string, since: Date): Promise<WorkflowRunShare[]> {
    return this.database.db
      .selectFrom("runs")
      .where("organization_id", "=", organizationId)
      .where("started_at", ">=", since)
      .select(["workflow_tag", sql<number>`count(*)::int`.as("runs")])
      .groupBy("workflow_tag")
      .execute();
  }

  /**
   * The slugs this workspace offers as workflows to run something under.
   *
   * **`active` only**, and that is the difference between this and the rail: a paused workflow
   * belongs on the rail — it is the mockup's `hotfix-p0`, err-dot and all — and does not
   * belong in an assign menu, because queueing an issue under it would be queueing work onto
   * something the workspace has switched off. Archived is out of both.
   *
   * Its own statement rather than a projection of {@link registryEntries}, because it needs
   * none of the jsonb work: this is an index-only read of `(organization_id, slug)`, which is
   * `workflows_organization_slug_key`, and it is on the path of every queue write.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The slugs, in the rail's own order. Empty for a workspace with no workflows —
   *   which `registry.service.ts` answers rather than passes on.
   */
  async activeSlugs(organizationId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("workflows")
      .where("organization_id", "=", organizationId)
      .where("status", "=", ACTIVE)
      .select("slug")
      .orderBy("created_at", "asc")
      .orderBy("slug", "asc")
      .execute();

    return rows.map((row) => row.slug);
  }
}
