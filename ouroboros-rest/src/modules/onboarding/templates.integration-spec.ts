/**
 * Step 3 against a real database and the engine stub
 * ([#386](https://github.com/NobuData/ouroboros/issues/386), BB.3).
 *
 * The acceptance criteria that are claims about real rows and a real request:
 *
 *   * **Selecting Quick fixes yields a valid, published workflow visible and editable in the
 *     studio** — the cross-plane fixture: the selection's workflow is read back through
 *     `/api/v1/workflows`, the studio's own routes, and found on its rail with v1 in force and a
 *     draft to edit.
 *   * **Provenance** — `template_slug` and `template_version` on the row.
 *   * **The same gate** — the engine stub records the definition the publish gate sent.
 *   * **A refused definition leaves nothing behind** — counted, not trusted.
 *   * **Slug collision → suffix flow**, **re-selection keeps and reports**, **the locked tile's
 *     progress from real merged runs**, **the override**, and **a template version bump alters
 *     nothing already instantiated**.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { WorkflowStats } from "../workflows/stats.resources";
import type { WorkflowDetail } from "../workflows/workflows.resources";
import type { WorkflowRail } from "../workflows/workflows.service";
import { shipTemplates } from "./onboarding.integration.fixture";
import type { OnboardingResource } from "./resources";
import type { TemplateSelectionResource, TemplateTilesResource } from "./templates.resources";

const REPO = "acme-robotics/helios-firmware";
const QUERY = `?repo=${encodeURIComponent(REPO)}`;
const TILES = `/api/v1/onboarding/templates${QUERY}`;
const SELECT = `/api/v1/onboarding/select-template${QUERY}`;
const WIZARD = `/api/v1/onboarding${QUERY}`;
const WORKFLOWS = "/api/v1/workflows";

describe("template instantiation, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({ OURO_ENGINE_URL: engine.url });
  });

  // The last truncate emptied `workflow_templates`; later suites read V068's rows as shipped.
  afterAll(async () => {
    await shipTemplates(api);
    await api.close();
    await engine.stop();
  });

  // `truncate()` empties `workflow_templates`, so V068's shipped rows are put back first —
  // whatever suite ran before this one (#389).
  beforeEach(async () => {
    engine.reset();
    await shipTemplates(api);
  });

  afterEach(async () => {
    const unfaithful = new Set(engine.violations);

    await api.truncate();

    expect([...unfaithful]).toEqual([]);
  });

  /** A workspace and its signed-in owner. */
  async function bench(): Promise<{ owner: Person; workspace: Workspace }> {
    const owner = await api.signIn();

    return { owner, workspace: await api.workspace(owner) };
  }

  /** A request as somebody, carrying the workspace. */
  function as(person: Person, workspace: Workspace) {
    return (method: "get" | "post", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /** Select a template, expecting success. */
  async function select(
    owner: Person,
    workspace: Workspace,
    slug: string,
  ): Promise<TemplateSelectionResource> {
    const response = await as(owner, workspace)("post", SELECT).send({ slug }).expect(200);

    return bodyOf<TemplateSelectionResource>(response);
  }

  /** The workspace's workflow rows, as stored. */
  async function workflowRows(workspace: Workspace) {
    const { rows } = await api.sql.query<{
      slug: string;
      current_version: number | null;
      template_slug: string | null;
      template_version: number | null;
    }>(
      `select slug, current_version, template_slug, template_version from ouroboros.workflows
        where organization_id = $1 order by slug`,
      [workspace.id],
    );

    return rows;
  }

  it("selecting Quick fixes yields a published workflow the studio can open and edit", async () => {
    const { owner, workspace } = await bench();

    const selection = await select(owner, workspace, "quick-fixes");

    expect(selection).toMatchObject({
      created: true,
      workflow: {
        slug: "quick-fixes",
        name: "Quick fixes",
        currentVersion: 1,
        templateSlug: "quick-fixes",
        templateVersion: 1,
        studioPath: "/workflows/quick-fixes",
      },
      kept: [],
    });

    // The studio's own routes: the detail with v1 in force and a draft to edit, and the rail.
    const detail = bodyOf<WorkflowDetail>(
      await as(owner, workspace)("get", `${WORKFLOWS}/${selection.workflow.id}`).expect(200),
    );
    const rail = bodyOf<WorkflowRail>(await as(owner, workspace)("get", WORKFLOWS).expect(200));

    expect(detail.currentVersion).toBe(1);
    expect(detail.draft.definition).toEqual(detail.version?.definition);
    expect(rail.workflows.map((entry: WorkflowStats) => entry.slug)).toContain("quick-fixes");

    // The same gate as a studio publish: the engine was asked about this definition.
    expect(engine.validations).toEqual([{ definition: detail.version?.definition }]);
  });

  it("records the template's slug and version on the workflow", async () => {
    const { owner, workspace } = await bench();

    await select(owner, workspace, "quick-fixes");

    expect(await workflowRows(workspace)).toEqual([
      {
        slug: "quick-fixes",
        current_version: 1,
        template_slug: "quick-fixes",
        template_version: 1,
      },
    ]);
  });

  it("completes step 3 of the derived rail and stores the active choice", async () => {
    const { owner, workspace } = await bench();

    await select(owner, workspace, "quick-fixes");

    const wizard = bodyOf<OnboardingResource>(
      await as(owner, workspace)("get", WIZARD).expect(200),
    );

    expect(wizard.choices.selectedTemplate).toBe("quick-fixes");
    expect(wizard.steps[2]).toMatchObject({ status: "done" });
  });

  it("surfaces a definition that fails validation as a designed error, leaving nothing", async () => {
    const { owner, workspace } = await bench();

    // An organization override whose definition has no trigger — the gate's first refusal.
    await api.sql.query(
      `insert into ouroboros.workflow_templates
         (organization_id, slug, version, name, description, stage_dots, effort_range, caption,
          definition, tier, unlock_rule, sort_order)
       values ($1, 'quick-fixes', 1, 'Quick fixes', 'Broken on purpose.', '["code"]',
               array['xs'], null, '{"dsl_version": "1.0", "nodes": []}', 'starter', null, 1)`,
      [workspace.id],
    );

    const response = await as(owner, workspace)("post", SELECT)
      .send({ slug: "quick-fixes" })
      .expect(422);
    const envelope = bodyOf<ErrorEnvelope>(response);

    expect(envelope.code).toBe("onboarding_template_invalid");
    expect(envelope.details).toMatchObject({ slug: "quick-fixes", version: 1 });
    expect((envelope.details.findings as unknown[]).length).toBeGreaterThan(0);
    expect(await workflowRows(workspace)).toEqual([]);
  });

  it("resolves a slug collision through the suffix flow", async () => {
    const { owner, workspace } = await bench();

    await as(owner, workspace)("post", WORKFLOWS).send({ name: "Quick fixes" }).expect(201);

    const selection = await select(owner, workspace, "quick-fixes");

    expect(selection.workflow).toMatchObject({ slug: "quick-fixes-2", name: "Quick fixes (2)" });
    expect((await workflowRows(workspace)).map((row) => row.slug)).toEqual([
      "quick-fixes",
      "quick-fixes-2",
    ]);
  });

  it("re-selection leaves the previous workflow intact and reports it", async () => {
    const { owner, workspace } = await bench();

    const first = await select(owner, workspace, "quick-fixes");
    const second = await select(owner, workspace, "feature-builder");

    expect(second.created).toBe(true);
    expect(second.kept).toEqual([expect.objectContaining({ id: first.workflow.id })]);
    expect((await workflowRows(workspace)).map((row) => row.slug)).toEqual([
      "feature-builder",
      "quick-fixes",
    ]);
  });

  it("reuses a template's live workflow when it is selected again", async () => {
    const { owner, workspace } = await bench();

    const first = await select(owner, workspace, "quick-fixes");
    const again = await select(owner, workspace, "quick-fixes");

    expect(again).toMatchObject({ created: false, workflow: { id: first.workflow.id } });
    expect(await workflowRows(workspace)).toHaveLength(1);
  });

  it("a published template version bump does not alter an instantiated workflow", async () => {
    const { owner, workspace } = await bench();

    const selection = await select(owner, workspace, "quick-fixes");
    const before = bodyOf<WorkflowDetail>(
      await as(owner, workspace)("get", `${WORKFLOWS}/${selection.workflow.id}`).expect(200),
    );

    await api.sql.query(
      `insert into ouroboros.workflow_templates
         (organization_id, slug, version, name, description, stage_dots, effort_range, caption,
          definition, tier, unlock_rule, sort_order)
       select null, slug, 2, name, 'Improved.', stage_dots, effort_range, caption,
              definition || '{"description": "v2"}', tier, unlock_rule, sort_order
         from ouroboros.workflow_templates
        where organization_id is null and slug = 'quick-fixes' and version = 1`,
    );

    const after = bodyOf<WorkflowDetail>(
      await as(owner, workspace)("get", `${WORKFLOWS}/${selection.workflow.id}`).expect(200),
    );
    const tiles = bodyOf<TemplateTilesResource>(
      await as(owner, workspace)("get", TILES).expect(200),
    );

    expect(after.version).toEqual(before.version);
    expect(await workflowRows(workspace)).toEqual([
      expect.objectContaining({ template_slug: "quick-fixes", template_version: 1 }),
    ]);
    expect(tiles.tiles[0]).toMatchObject({ slug: "quick-fixes", version: 2 });
  });

  it("computes the locked tile's progress from real merged runs, and refuses it", async () => {
    const { owner, workspace } = await bench();
    const repoId = await repository(workspace);

    await mergedRuns(workspace, repoId, 3);

    const tiles = bodyOf<TemplateTilesResource>(
      await as(owner, workspace)("get", TILES).expect(200),
    );
    const deep = tiles.tiles.find((tile) => tile.slug === "deep-refactor");

    expect(tiles.mergedLoops).toBe(3);
    expect(deep?.unlock).toEqual({
      locked: true,
      mergedLoops: 3,
      threshold: 10,
      rule: "unlock after 10 merged loops",
      progress: "3 of 10 merged loops",
    });

    const refused = await as(owner, workspace)("post", SELECT)
      .send({ slug: "deep-refactor" })
      .expect(409);

    expect(bodyOf<ErrorEnvelope>(refused).code).toBe("onboarding_template_locked");
    expect(await workflowRows(workspace)).toEqual([]);
  });

  it("no tile carries a fabricated statistic (O8)", async () => {
    const { owner, workspace } = await bench();

    const tiles = bodyOf<TemplateTilesResource>(
      await as(owner, workspace)("get", TILES).expect(200),
    );

    expect(tiles.tiles).toHaveLength(4);
    for (const tile of tiles.tiles) {
      expect(tile.caption ?? "").not.toMatch(/[0-9%]/);
    }
  });

  it("asks administrators to select — selecting publishes — and lets a member read", async () => {
    const { workspace } = await bench();
    const member = await api.signIn({ email: "member@ouroboros.invalid" });

    await api.join(workspace.id, member, "member");

    await as(member, workspace)("get", TILES).expect(200);
    await as(member, workspace)("post", SELECT).send({ slug: "quick-fixes" }).expect(403);
    expect(await workflowRows(workspace)).toEqual([]);
  });

  it("keeps another workspace's workflows out of the tiles and the kept list", async () => {
    const mine = await bench();
    const theirs = await api.signIn({ email: "other@ouroboros.invalid" });
    const other = await api.workspace(theirs);

    await select(theirs, other, "quick-fixes");

    const tiles = bodyOf<TemplateTilesResource>(
      await as(mine.owner, mine.workspace)("get", TILES).expect(200),
    );
    const selection = await select(mine.owner, mine.workspace, "feature-builder");

    expect(tiles.tiles.every((tile) => tile.workflow === null)).toBe(true);
    expect(selection.kept).toEqual([]);
  });

  describe("with an operator's threshold override", () => {
    let overridden: ApiHarness;

    beforeAll(async () => {
      overridden = await ApiHarness.start({
        OURO_ENGINE_URL: engine.url,
        OURO_ONBOARDING_UNLOCK_THRESHOLD: "2",
      });
    });

    afterAll(() => overridden.close());

    it("opens the tier on its own once the workspace has done the work", async () => {
      const owner = await overridden.signIn();
      const workspace = await overridden.workspace(owner);
      const repoId = await repository(workspace);

      await mergedRuns(workspace, repoId, 3);

      const tiles = bodyOf<TemplateTilesResource>(
        await overridden.as(owner)("get", TILES).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(tiles.tiles.find((tile) => tile.slug === "deep-refactor")?.unlock).toMatchObject({
        locked: false,
        threshold: 2,
        progress: "2 of 2 merged loops",
      });
    });
  });

  /** A mirrored repository for runs to belong to. */
  async function repository(workspace: Workspace): Promise<string> {
    const account = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [workspace.id],
    );
    const repo = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_repos (org_id, name, enabled, default_branch)
       values ($1, 'helios-firmware', true, 'main') returning id`,
      [account.rows[0].id],
    );

    return repo.rows[0].id;
  }

  /** `count` merged runs — the runs read-model's merged loops. */
  async function mergedRuns(workspace: Workspace, repoId: string, count: number): Promise<void> {
    for (let issue = 1; issue <= count; issue += 1) {
      await api.sql.query(
        `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                     workflow_tag, model, status, stage_label, stage_index,
                                     stage_total, started_at, finished_at, pr_number,
                                     checks_passed, checks_total)
         values ($1, $2, $3::int, 'Issue ' || $3::int, 'standard-fix', 'claude-fable-5', 'merged',
                 'Merged', 6, 6, now() - interval '1 hour', now(), $3::int, 3, 3)`,
        [workspace.id, repoId, issue],
      );
    }
  }
});
