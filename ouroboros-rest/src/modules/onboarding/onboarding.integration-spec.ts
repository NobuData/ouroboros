/**
 * `/api/v1/onboarding` against a real database
 * ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2).
 *
 * The acceptance criteria that need a database to mean anything: the disconnect regression
 * visible on the next read with no wizard write; no step status persisted across a full
 * traversal (the wizard's table is inspected, not the service's calls); choices surviving across
 * sessions; the step-3 guard; the honest import-skip; the surfacing rule; per-repository state;
 * and cross-tenant isolation.
 */

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { OnboardingResource, OnboardingSkipResource } from "./resources";

const REPO = "acme-robotics/helios-firmware";
const PATH = `/api/v1/onboarding?repo=${encodeURIComponent(REPO)}`;
const COMPLETE = `/api/v1/onboarding/complete-step?repo=${encodeURIComponent(REPO)}`;
const SKIP = `/api/v1/onboarding/skip?repo=${encodeURIComponent(REPO)}`;

describe("the onboarding wizard API", () => {
  let api: ApiHarness;
  /** V068's shipped template rows, as the migration left them. */
  let shippedTemplates: unknown;

  beforeAll(async () => {
    api = await ApiHarness.start();

    const { rows } = await api.sql.query<{ templates: unknown }>(
      `select json_agg(t) as templates from ouroboros.workflow_templates t
        where t.organization_id is null`,
    );

    shippedTemplates = rows[0].templates;
  });

  // `truncate()` cascades from `organization` to every table that references it, and
  // `workflow_templates` is one — so V068's shipped rows go with the first truncate. They are
  // product data the offered-template check reads, so each test starts with them put back.
  beforeEach(async () => {
    await api.sql.query(
      `insert into ouroboros.workflow_templates
       select * from json_populate_recordset(null::ouroboros.workflow_templates, $1::json)
        where not exists (select 1 from ouroboros.workflow_templates where organization_id is null)`,
      [JSON.stringify(shippedTemplates)],
    );
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The wizard's stored row for the repository — what a read must not change. */
  async function storedRow(workspace: Workspace): Promise<Record<string, unknown> | undefined> {
    const { rows } = await api.sql.query<Record<string, unknown>>(
      `select * from ouroboros.onboarding_state where organization_id = $1 and repo_ref = $2`,
      [workspace.id, REPO],
    );

    return rows[0];
  }

  /**
   * Steps 1 and 2 made true by their own subsystems: a GitHub source covering the repository,
   * and the repository enabled under an enabled account.
   *
   * @returns The source and repository ids.
   */
  async function connect(workspace: Workspace): Promise<{ sourceId: string; repoId: string }> {
    const source = await api.sql.query<{ id: string }>(
      `insert into ouroboros.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub · acme-robotics',
               '{"login": "acme-robotics", "repos": ["helios-firmware"]}')
       returning id`,
      [workspace.id],
    );
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

    return { sourceId: source.rows[0].id, repoId: repo.rows[0].id };
  }

  /** A canonical ticket for issue #488 of the repository. */
  async function ticket(workspace: Workspace, sourceId: string): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.tickets
         (organization_id, source_id, external_id, external_key, external_url, title, state,
          source_created_at, source_updated_at, meta)
       values ($1, $2, '488', '#488',
               'https://github.com/acme-robotics/helios-firmware/issues/488',
               'docs: fix typo in README', 'open', now(), now(),
               '{"github": {"owner": "acme-robotics", "repo": "helios-firmware"}}')
       returning id`,
      [workspace.id, sourceId],
    );

    return rows[0].id;
  }

  /** Step 3's subsystem truth: a workflow instantiated from the template (BB.3's write). */
  async function instantiate(workspace: Workspace): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.workflows (organization_id, slug, name, template_slug, template_version)
       values ($1, 'quick-fixes', 'Quick fixes', 'quick-fixes', 1)`,
      [workspace.id],
    );
  }

  /** Step 4's subsystem truth: the picked issue queued (BB.5's write). */
  async function enqueue(workspace: Workspace, repoId: string): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.queue_items
         (organization_id, github_repo_id, issue_number, issue_title, effort, workflow_tag, position)
       values ($1, $2, 488, 'docs: fix typo in README', 'xs', 'quick-fixes', 1)`,
      [workspace.id, repoId],
    );
  }

  /** Read the wizard as `person` in `workspace`. */
  async function read(person: Person, workspace: Workspace): Promise<OnboardingResource> {
    const response = await api
      .as(person)("get", PATH)
      .set(TENANT_HEADER, workspace.slug)
      .expect(200);

    return bodyOf<OnboardingResource>(response);
  }

  describe("who may ask", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", PATH).expect(401);
      await api.anonymous("patch", PATH).expect(401);
      await api.anonymous("post", COMPLETE).expect(401);
      await api.anonymous("post", SKIP).expect(401);
    });

    it("refuses a malformed repository", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const response = await api
        .as(owner)("get", "/api/v1/onboarding?repo=..%2Fetc")
        .set(TENANT_HEADER, workspace.slug)
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
    });
  });

  describe("derivation", () => {
    it("regresses step 1 on the next read when the source is disconnected, with no wizard write", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const { sourceId } = await connect(workspace);

      expect((await read(owner, workspace)).steps[0].status).toBe("done");
      const before = await storedRow(workspace);

      // A teammate pauses the source — through the sources plane, not the wizard.
      await api.sql.query(`update ouroboros.ticket_sources set status = 'paused' where id = $1`, [
        sourceId,
      ]);

      const after = await read(owner, workspace);

      expect(after.steps[0]).toMatchObject({ status: "todo", regressed: true });
      expect(after.steps[0].reason).toContain("is paused");
      expect(await storedRow(workspace)).toEqual(before);
    });

    it("stores no step status across a full traversal", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const { sourceId, repoId } = await connect(workspace);
      const ticketId = await ticket(workspace, sourceId);
      const call = api.as(owner);

      await call("post", COMPLETE).set(TENANT_HEADER, workspace.slug).send({ step: 1 }).expect(200);
      await call("post", COMPLETE).set(TENANT_HEADER, workspace.slug).send({ step: 2 }).expect(200);
      // Completing steps 1–2 wrote nothing at all.
      expect(await storedRow(workspace)).toBeUndefined();

      await call("patch", PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ selectedTemplate: "quick-fixes" })
        .expect(200);
      await instantiate(workspace);
      await call("post", COMPLETE).set(TENANT_HEADER, workspace.slug).send({ step: 3 }).expect(200);
      await call("patch", PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ pickedTicketId: ticketId })
        .expect(200);
      await enqueue(workspace, repoId);

      const done = bodyOf<OnboardingResource>(
        await call("post", COMPLETE)
          .set(TENANT_HEADER, workspace.slug)
          .send({ step: 4 })
          .expect(200),
      );

      expect(done.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);

      // The row holds choices and the completion stamp — the table has nowhere else to put
      // anything, and that is asserted rather than assumed.
      const row = await storedRow(workspace);

      expect(Object.keys(row ?? {}).sort()).toEqual([
        "bypassed_at",
        "completed_at",
        "created_at",
        "dismissed",
        "id",
        "organization_id",
        "picked_ticket_id",
        "repo_ref",
        "selected_template",
        "updated_at",
      ]);
      expect(row).toMatchObject({ selected_template: "quick-fixes", picked_ticket_id: ticketId });
      expect(row?.completed_at).not.toBeNull();
    });
  });

  describe("choices", () => {
    it("survive across sessions", async () => {
      const owner = await api.signUp();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("patch", PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ selectedTemplate: "quick-fixes" })
        .expect(200);

      // A second session — another device, another tab — reads the same choice.
      const again = await api.signInWithPassword(owner);

      expect((await read(again, workspace)).choices.selectedTemplate).toBe("quick-fixes");
    });

    it("are independent for a second repository", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("patch", PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ selectedTemplate: "quick-fixes" })
        .expect(200);

      const second = bodyOf<OnboardingResource>(
        await api
          .as(owner)("get", "/api/v1/onboarding?repo=acme-robotics%2Fhelios-console")
          .set(TENANT_HEADER, workspace.slug)
          .expect(200),
      );

      expect(second.choices.selectedTemplate).toBeNull();
    });

    it("let a viewer dismiss but not pick", async () => {
      const owner = await api.signIn();
      const viewer = await api.signIn();
      const workspace = await api.workspace(owner);

      await api.join(workspace.id, viewer, "viewer");

      await api
        .as(viewer)("patch", PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ selectedTemplate: "quick-fixes" })
        .expect(403);
      await api
        .as(viewer)("patch", PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ dismissed: true })
        .expect(200);
    });
  });

  describe("the completion guard", () => {
    it("refuses step 3 without an instantiated workflow, with a stated reason", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await connect(workspace);
      await api
        .as(owner)("patch", PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ selectedTemplate: "quick-fixes" })
        .expect(200);

      const response = await api
        .as(owner)("post", COMPLETE)
        .set(TENANT_HEADER, workspace.slug)
        .send({ step: 3 })
        .expect(409);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: "onboarding_step_incomplete",
        message: "No workflow has been created from the quick-fixes template yet.",
        details: { step: 3, blockingStep: 3 },
      });
    });
  });

  describe("the import-skip", () => {
    it("marks the wizard bypassed and does not claim to have imported configuration", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const result = bodyOf<OnboardingSkipResource>(
        await api.as(owner)("post", SKIP).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(result).toMatchObject({ settingsPath: "/settings", configurationImported: false });
      expect(result.onboarding.choices.bypassedAt).not.toBeNull();
      expect(await storedRow(workspace)).toMatchObject({ dismissed: false });
    });
  });

  describe("surfacing", () => {
    it("offers the wizard to a fresh organization, and dismissal sticks", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      expect((await read(owner, workspace)).surfacing).toEqual({
        offer: true,
        reason: "fresh_organization",
      });

      await api
        .as(owner)("patch", PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ dismissed: true })
        .expect(200);

      expect((await read(owner, workspace)).surfacing).toEqual({
        offer: false,
        reason: "wizard_finished",
      });
    });
  });

  describe("isolation", () => {
    it("keeps one workspace's wizard unreachable from another", async () => {
      const alice = await api.signIn();
      const bob = await api.signIn();
      const aliceSpace = await api.workspace(alice);
      const bobSpace = await api.workspace(bob);
      const { sourceId } = await connect(aliceSpace);
      const aliceTicket = await ticket(aliceSpace, sourceId);

      await api
        .as(alice)("patch", PATH)
        .set(TENANT_HEADER, aliceSpace.slug)
        .send({ selectedTemplate: "quick-fixes" })
        .expect(200);

      // Bob's read of the same repository sees none of Alice's choices or subsystems.
      const bobs = await read(bob, bobSpace);

      expect(bobs.choices.selectedTemplate).toBeNull();
      expect(bobs.steps[0].status).toBe("active");

      // Bob cannot pick Alice's ticket, and cannot read Alice's workspace at all.
      const refused = await api
        .as(bob)("patch", PATH)
        .set(TENANT_HEADER, bobSpace.slug)
        .send({ pickedTicketId: aliceTicket })
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("onboarding_ticket_not_found");
      await api.as(bob)("get", PATH).set(TENANT_HEADER, aliceSpace.slug).expect(404);
    });
  });
});
