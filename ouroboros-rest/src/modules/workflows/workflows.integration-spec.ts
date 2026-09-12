import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { BOOTSTRAP_WORKFLOW_SLUGS, WorkflowRegistryService } from "./registry.service";
import { USAGE_WINDOW_DAYS, WorkflowStatsService } from "./stats.service";

/**
 * The rail's statistics, against a migrated database
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * The unit suites hold each layer to its own rules — the captions to the mockup's strings, the
 * statements to their workspace predicate, the service to its window. What only this one can
 * certify is the ticket's own acceptance criteria, because each of them is a claim about rows:
 *
 *   * **The captions come out of real definitions**, through PostgreSQL's own jsonb operators.
 *     A `case`/`jsonb_typeof` guard that compiles is not a guard the server accepts.
 *   * **A workspace with no runs reads `no runs yet`** — never a fabricated percentage.
 *   * **Stage counts and terminal captions change when the definition changes, with no
 *     separate write.** Asserted by publishing a version with one stage more and re-reading:
 *     there is no column to update, so the proof is that nothing was updated.
 *   * **Cross-org isolation** — two workspaces holding the same slugs, with the runs of one
 *     absent from the numbers of the other.
 *
 * The definitions are the committed DSL fixtures rather than documents written here:
 * `schemas/workflow-dsl/fixtures/valid/standard-fix.json` *is* mockup 04's canvas, node for
 * node, so a stage count taken from it is a stage count taken from the design.
 *
 * There is no endpoint to call. P.4 is the derivation and P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)) is the route over it, so this
 * resolves the two exported services out of the running application — `registry.integration-spec.ts`'
 * shape, for its reason.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** Where the shared contract lives — the same directory `dsl.golden.fixture.ts` reads. */
const FIXTURES = join(__dirname, "..", "..", "..", "..", "schemas", "workflow-dsl", "fixtures");

/** Mockup 04's canvas, as P.2 committed it: twelve nodes, two terminals, the loop edge. */
const STANDARD_FIX = JSON.parse(
  readFileSync(join(FIXTURES, "valid", "standard-fix.json"), "utf8"),
) as { nodes: unknown[] };

/** How many nodes that canvas holds — the stage count it must produce. */
const STANDARD_FIX_STAGES = STANDARD_FIX.nodes.length;

/** A definition with a chosen number of stages and one terminal, for the cases about counting. */
function definition(stages: number, action: string): unknown {
  return {
    dsl_version: "1.0",
    trigger: { event: "ticket_queued", conditions: {} },
    nodes: [
      {
        id: "queued",
        type: "trigger",
        title: "Issue queued",
        position: { x: 0, y: 0 },
        config: {},
      },
      ...Array.from({ length: Math.max(stages - 2, 0) }, (_unused, index) => ({
        id: `work-${index}`,
        type: "infra",
        title: `Stage ${index}`,
        position: { x: 0, y: 100 + index * 100 },
        config: {},
      })),
      {
        id: "done",
        type: "term",
        title: "Done",
        position: { x: 0, y: 900 },
        config: {
          action,
          options:
            action === "open_pr_automerge" ? { merge_method: "squash", delete_branch: true } : {},
        },
      },
    ],
    edges: [],
  };
}

describe("the workflow rail, against a migrated database", () => {
  let api: ApiHarness;
  let stats: WorkflowStatsService;
  let registry: WorkflowRegistryService;

  beforeAll(async () => {
    api = await ApiHarness.start();
    stats = api.nest.get(WorkflowStatsService);
    registry = api.nest.get(WorkflowRegistryService);
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace with a repository, so it can hold runs.
   *
   * @param email - Whose workspace, for a case that wants two.
   * @returns The workspace.
   */
  async function workspace(email?: string): Promise<SeededWorkspace> {
    return workspaceWithRepo(api, await api.signIn(email === undefined ? {} : { email }));
  }

  /**
   * A workflow, optionally with a published version in force.
   *
   * Written straight into the tables because P.3's create does not exist yet — which is the
   * same position `dashboard.integration-spec.ts` is in with `runs`, and the reason V029 put
   * every rule a reader depends on into a constraint rather than into a writer.
   *
   * @param where - Whose workspace.
   * @param workflow - The slug, the status, and the definition to publish as v1 when there is
   *   one. Omitting the definition leaves the workflow with no version in force.
   * @returns `workflows.id`.
   */
  async function createWorkflow(
    where: SeededWorkspace,
    workflow: { slug: string; status?: string; definition?: unknown },
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.workflows (organization_id, slug, name, status)
       values ($1, $2, $2, $3) returning id`,
      [where.id, workflow.slug, workflow.status ?? "active"],
    );
    const id = rows[0].id;

    if (workflow.definition !== undefined) {
      await publish(id, 1, workflow.definition);
    }

    return id;
  }

  /**
   * Publish one version of a workflow and put it in force.
   *
   * @param workflowId - Which workflow.
   * @param version - The number to publish as.
   * @param document - The definition.
   */
  async function publish(workflowId: string, version: number, document: unknown): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.workflow_versions (workflow_id, version, definition, published_at)
       values ($1, $2, $3::jsonb, now())`,
      [workflowId, version, JSON.stringify(document)],
    );
    await api.sql.query(`update ${SCHEMA_NAME}.workflows set current_version = $2 where id = $1`, [
      workflowId,
      version,
    ]);
  }

  /**
   * Runs in a workspace, all under one tag.
   *
   * @param where - Whose workspace, and which repository they target.
   * @param tag - The `workflow_tag` they carry.
   * @param count - How many.
   * @param daysAgo - How long ago they started, so a case can put one outside the window.
   */
  async function runs(
    where: SeededWorkspace,
    tag: string,
    count: number,
    daysAgo = 1,
  ): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.runs
           (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
            status, stage_label, stage_index, stage_total, started_at)
         values ($1, $2, $3, $4, $5, 'claude-fable-5', 'coding', 'Implement', 3, 6,
                 now() - ($6 || ' days')::interval)`,
        [where.id, where.repoId, 1000 + index, `Run ${index}`, tag, String(daysAgo)],
      );
    }
  }

  describe("the captions", () => {
    it("reads the mockup's rail out of real definitions", async () => {
      // docs/mockups/04-workflow-builder.html's `.wf-cap` strings, composed from five stored
      // documents and one `status` column. `standard-fix` carries the committed canvas, so its
      // count is whatever that canvas holds — see `stats.captions.ts` on the mockup's own
      // disagreement between its rail and its twelve-node canvas, which #136's seed settles.
      const where = await workspace();
      await createWorkflow(where, { slug: "standard-fix", definition: STANDARD_FIX });
      await createWorkflow(where, {
        slug: "feature-loop",
        definition: definition(7, "open_pr_automerge"),
      });
      await createWorkflow(where, {
        slug: "deps-refresh",
        definition: definition(5, "needs_review"),
      });
      await createWorkflow(where, {
        slug: "docs-loop",
        definition: definition(4, "open_pr_automerge"),
      });
      await createWorkflow(where, {
        slug: "hotfix-p0",
        status: "paused",
        definition: definition(5, "open_pr_automerge"),
      });

      const rail = await stats.forWorkspace(where.id);

      expect(rail.map((entry) => [entry.slug, entry.caption])).toEqual([
        ["standard-fix", `${STANDARD_FIX_STAGES} stages · auto-merge`],
        ["feature-loop", "7 stages · auto-merge"],
        ["deps-refresh", "5 stages · needs review"],
        ["docs-loop", "4 stages · auto-merge"],
        ["hotfix-p0", "5 stages · paused"],
      ]);
    });

    it("picks the furthest terminal out of a definition that ends in several places", async () => {
      // The committed canvas ends at `Open PR & auto-merge` *and* at `Back to queue`, and the
      // mockup's rail says `auto-merge`. Both actions come back from the statement, in
      // document order, and the precedence is what decides.
      const where = await workspace();
      await createWorkflow(where, { slug: "standard-fix", definition: STANDARD_FIX });

      const [entry] = await stats.forWorkspace(where.id);

      expect(entry.terminal).toBe("open_pr_automerge");
      expect(entry.stageCount).toBe(STANDARD_FIX_STAGES);
    });

    it("says nothing is published for a workflow that has only a draft", async () => {
      // What **+ New workflow** leaves behind: a `workflows` row whose `current_version` is
      // null. It belongs on the rail, which is why the join is a `left join`.
      const where = await workspace();
      await createWorkflow(where, { slug: "brand-new" });

      const [entry] = await stats.forWorkspace(where.id);

      expect(entry).toMatchObject({
        slug: "brand-new",
        currentVersion: null,
        stageCount: null,
        terminal: null,
        caption: "not published",
      });
    });

    it("survives a definition this build cannot read, rather than failing the whole rail", async () => {
      // `workflow_versions_definition_object` CHECKs an object and no further, deliberately —
      // an empty `{}` is the legal state of a canvas nobody has placed a node on. Both
      // `jsonb_array_length` and `jsonb_array_elements` raise on a value that is not an array,
      // so one such document must not be a 500 for every other workflow on the rail.
      const where = await workspace();
      await createWorkflow(where, { slug: "empty-canvas", definition: {} });
      await createWorkflow(where, { slug: "nodes-not-an-array", definition: { nodes: "twelve" } });
      await createWorkflow(where, {
        slug: "readable",
        definition: definition(4, "open_pr_automerge"),
      });

      const rail = await stats.forWorkspace(where.id);

      expect(rail.map((entry) => [entry.slug, entry.caption])).toEqual([
        ["empty-canvas", "not published"],
        ["nodes-not-an-array", "not published"],
        ["readable", "4 stages · auto-merge"],
      ]);
    });

    it("leaves an archived workflow off the rail, and its history where it is", async () => {
      const where = await workspace();
      await createWorkflow(where, {
        slug: "retired",
        status: "archived",
        definition: definition(3, "needs_review"),
      });

      expect(await stats.forWorkspace(where.id)).toEqual([]);

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.workflow_versions`,
      );
      expect(Number(rows[0].count)).toBe(1);
    });
  });

  describe("a definition that changes", () => {
    it("changes the caption with no separate write", async () => {
      // The ticket's third criterion. Publishing v2 writes a `workflow_versions` row and moves
      // one pointer; nothing writes a stage count or a caption anywhere, because there is no
      // column for either — which is what the row count afterwards says.
      const where = await workspace();
      const id = await createWorkflow(where, {
        slug: "standard-fix",
        definition: definition(6, "open_pr_automerge"),
      });

      const [before] = await stats.forWorkspace(where.id);
      expect(before.caption).toBe("6 stages · auto-merge");

      await publish(id, 2, definition(7, "needs_review"));

      const [after] = await stats.forWorkspace(where.id);
      expect(after).toMatchObject({
        currentVersion: 2,
        stageCount: 7,
        terminal: "needs_review",
        caption: "7 stages · needs review",
      });
    });

    it("reads the version in force rather than the newest one", async () => {
      // V029: `current_version` is a pointer, not a cache of `max(version)`. A workflow may
      // hold a published v2 while v1 is what runs, and the `v14` chip is what is in force.
      const where = await workspace();
      const id = await createWorkflow(where, {
        slug: "standard-fix",
        definition: definition(6, "open_pr_automerge"),
      });

      await api.sql.query(
        `insert into ${SCHEMA_NAME}.workflow_versions (workflow_id, version, definition, published_at)
         values ($1, 2, $2::jsonb, now())`,
        [id, JSON.stringify(definition(9, "needs_review"))],
      );

      const [entry] = await stats.forWorkspace(where.id);

      expect(entry).toMatchObject({
        currentVersion: 1,
        stageCount: 6,
        terminal: "open_pr_automerge",
      });
    });

    it("ignores the draft, which is the row with no version number", async () => {
      const where = await workspace();
      const id = await createWorkflow(where, {
        slug: "standard-fix",
        definition: definition(6, "open_pr_automerge"),
      });

      await api.sql.query(
        `insert into ${SCHEMA_NAME}.workflow_versions (workflow_id, definition) values ($1, $2::jsonb)`,
        [id, JSON.stringify(definition(20, "needs_review"))],
      );

      const [entry] = await stats.forWorkspace(where.id);

      expect(entry.stageCount).toBe(6);
    });
  });

  describe("the usage share", () => {
    it("is the workflow's runs over every run in the window", async () => {
      const where = await workspace();
      await createWorkflow(where, {
        slug: "standard-fix",
        definition: definition(6, "open_pr_automerge"),
      });
      await createWorkflow(where, {
        slug: "docs-loop",
        definition: definition(4, "open_pr_automerge"),
      });

      await runs(where, "standard-fix", 6);
      await runs(where, "docs-loop", 3);
      // A tag no workflow resolves — a workflow that was renamed or deleted. Still a run this
      // workspace performed, so still in the denominator.
      await runs(where, "retired-experiment", 1);

      const rail = await stats.forWorkspace(where.id);

      expect(rail.map((entry) => [entry.slug, entry.runs, entry.usagePercent])).toEqual([
        ["standard-fix", 6, 60],
        ["docs-loop", 3, 30],
      ]);
      expect(rail[0].usageCaption).toBe("used by 60% of runs");
    });

    it("says `no runs yet` for a workspace that has never run anything", async () => {
      // The ticket's second criterion, against rows: no runs at all, and no percentage — not
      // `0%`, which would be a number about a denominator that does not exist.
      const where = await workspace();
      await createWorkflow(where, {
        slug: "standard-fix",
        definition: definition(6, "open_pr_automerge"),
      });

      const [entry] = await stats.forWorkspace(where.id);

      expect(entry.usagePercent).toBeNull();
      expect(entry.usageCaption).toBe("no runs yet");
      expect(entry.runs).toBe(0);
    });

    it("says `no runs yet` when every run is older than the window", async () => {
      // A workspace whose runs all predate the thirty days is, for this question, a workspace
      // with no runs — and the honest caption is the same one.
      const where = await workspace();
      await createWorkflow(where, {
        slug: "standard-fix",
        definition: definition(6, "open_pr_automerge"),
      });
      await runs(where, "standard-fix", 4, USAGE_WINDOW_DAYS + 2);

      const [entry] = await stats.forWorkspace(where.id);

      expect(entry.usageCaption).toBe("no runs yet");
    });

    it("counts a run inside the window and not one outside it", async () => {
      const where = await workspace();
      await createWorkflow(where, {
        slug: "standard-fix",
        definition: definition(6, "open_pr_automerge"),
      });
      await runs(where, "standard-fix", 3, USAGE_WINDOW_DAYS - 1);
      await runs(where, "standard-fix", 5, USAGE_WINDOW_DAYS + 1);

      const [entry] = await stats.forWorkspace(where.id);

      expect(entry.runs).toBe(3);
      expect(entry.usagePercent).toBe(100);
    });
  });

  describe("two workspaces", () => {
    it("counts only the asking workspace's runs, though both hold the same slug", async () => {
      // The ticket's fifth criterion. Two workspaces both running a `standard-fix` is the
      // ordinary case — V029 made `(organization_id, slug)` unique rather than the slug alone
      // for exactly that reason — so a missing predicate would not error, it would answer with
      // somebody else's numbers mixed in.
      const mine = await workspace();
      const theirs = await workspace("other-tenant@example.test");

      for (const where of [mine, theirs]) {
        await createWorkflow(where, {
          slug: "standard-fix",
          definition: definition(6, "open_pr_automerge"),
        });
      }

      await runs(mine, "standard-fix", 2);
      await runs(theirs, "standard-fix", 98);

      const [ours] = await stats.forWorkspace(mine.id);
      const [others] = await stats.forWorkspace(theirs.id);

      expect(ours.runs).toBe(2);
      expect(ours.usagePercent).toBe(100);
      expect(others.runs).toBe(98);
    });

    it("lists only the asking workspace's workflows", async () => {
      const mine = await workspace();
      const theirs = await workspace("other-tenant@example.test");

      await createWorkflow(mine, { slug: "mine-only", definition: definition(3, "needs_review") });
      await createWorkflow(theirs, {
        slug: "theirs-only",
        definition: definition(3, "needs_review"),
      });

      expect((await stats.forWorkspace(mine.id)).map((entry) => entry.slug)).toEqual(["mine-only"]);
      expect((await stats.forWorkspace(theirs.id)).map((entry) => entry.slug)).toEqual([
        "theirs-only",
      ]);
    });
  });

  describe("the assign-workflow vocabulary", () => {
    it("is the workspace's active workflows once it has any", async () => {
      // The ticket's fourth criterion at the registry: what the menu lists is what the
      // workspace has. `queue.integration-spec.ts` asserts the other half — that the write
      // accepts exactly this list.
      const where = await workspace();
      await createWorkflow(where, { slug: "release-train" });
      await createWorkflow(where, { slug: "hotfix-p0", status: "paused" });
      await createWorkflow(where, { slug: "retired", status: "archived" });

      await expect(registry.offered(where.id)).resolves.toEqual({
        slugs: ["release-train"],
        source: "registry",
      });
    });

    it("is the built-in four for a workspace with none, so a shipped intake keeps working", async () => {
      const where = await workspace();

      await expect(registry.offered(where.id)).resolves.toEqual({
        slugs: BOOTSTRAP_WORKFLOW_SLUGS,
        source: "bootstrap",
      });
    });

    it("is one workspace's own, never another's", async () => {
      const mine = await workspace();
      const theirs = await workspace("other-tenant@example.test");
      await createWorkflow(theirs, { slug: "theirs-only" });

      await expect(registry.accepts(mine.id, "theirs-only")).resolves.toBe(false);
      await expect(registry.accepts(theirs.id, "theirs-only")).resolves.toBe(true);
    });
  });
});
