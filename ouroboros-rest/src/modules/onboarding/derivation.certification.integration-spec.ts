/**
 * **Step derivation, certified on real rows** — BB.6
 * ([#389](https://github.com/NobuData/ouroboros/issues/389)).
 *
 * `onboarding.derivation.spec.ts` proves the rail is right for facts handed to it. This suite
 * proves the facts are the subsystems' own: every state a subsystem can be in is written to *its*
 * tables — `ticket_sources`, `github_orgs`/`github_repos`, `workflows`, `queue_items`/`runs` — and
 * the wizard is read back over HTTP. That join is where the risk is: a change to how a source
 * reports its health breaks the rail without touching a line of onboarding code, and only a suite
 * that writes the source's row sees it.
 *
 *   * **The matrix** — each subsystem state × its step. A finished wizard is arranged, one
 *     subsystem is moved, and the next read shows that step (and only what really depends on it)
 *     changed, with its stated reason, and **the wizard's own row untouched**.
 *   * **The traversal** — a fresh workspace walked forward one subsystem at a time; at every
 *     stage every step's `complete-step` is tried, and is refused with the first blocking step's
 *     reason exactly when a step up to it is not done.
 *   * **Nothing stored** — the wizard's table has no column a step status could live in, and no
 *     second table exists for one.
 *
 * **Mutation checks** (run for #389):
 *   * `OnboardingService.compose` reading the source through a status-blind query → the
 *     *paused* and *failing* rows red.
 *   * `completeStep` skipping `blockingStep` → every refusal of the traversal red.
 *   * a `step_status` column added to `onboarding_state` → *has nowhere to store a step status*
 *     red.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/onboarding/derivation.certification
 * ```
 */

import { PRIMARY_REPO, SECOND_REPO, workspaceWithRepo } from "../../testing/dashboard.fixture";
import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { DryRunPolicyResource } from "../policies/org-policy.service";
import { ONBOARDING_STEPS, type OnboardingStepNumber } from "./onboarding.derivation";
import {
  FIRST_ISSUE_NUMBER,
  connectGithub,
  inWorkspace,
  mirrorTicket,
  repoRef,
  shipTemplates,
  wizardRoute,
  wizardRow,
} from "./onboarding.integration.fixture";
import type { OnboardingResource, OnboardingStepResource } from "./resources";

/** A workspace, as far as this suite names one. */
type Tenant = Pick<Workspace, "id" | "slug">;

/** A workspace whose wizard is finished, and the rows that made it so. */
interface World {
  readonly owner: Person;
  /** The workspace; its GitHub account is named after its slug. */
  readonly workspace: Tenant;
  /** `owner/name`. */
  readonly repo: string;
  readonly repoId: string;
  readonly sourceId: string;
  readonly ticketId: string;
}

/** One row of the matrix: a subsystem moved, and what its step must then say. */
interface MatrixCase {
  /** The state, as the subsystem would describe it. */
  readonly label: string;
  /** The step that state belongs to. */
  readonly step: OnboardingStepNumber;
  /** Move the subsystem — through its own tables, unless {@link wizardWrite} says otherwise. */
  readonly arrange: (world: World) => Promise<void>;
  /** The step's evidence line when done. */
  readonly evidence?: (world: World) => string;
  /** The step's stated reason when not done. */
  readonly reason?: (world: World) => string;
  /** Other steps that really depend on the row that moved, and so are not done either. */
  readonly alsoNotDone?: readonly OnboardingStepNumber[];
  /** True when the state is the wizard's own choice, so its row is expected to change. */
  readonly wizardWrite?: boolean;
}

describe("step derivation, on the subsystems' own rows", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(async () => {
    await shipTemplates(api);
    await api.close();
  });

  // The offered-template check reads V068's rows, which the last truncate emptied.
  beforeEach(() => shipTemplates(api));
  afterEach(() => api.truncate());

  /** Run one statement on the suite's own connection. */
  async function sql(text: string, values: unknown[]): Promise<void> {
    await api.sql.query(text, values);
  }

  /** Step 3's subsystem truth: a workflow carrying the template's provenance (BB.3's write). */
  async function instantiate(workspace: Tenant): Promise<void> {
    await sql(
      `insert into ${SCHEMA_NAME}.workflows
              (organization_id, slug, name, template_slug, template_version)
       values ($1, 'quick-fixes', 'Quick fixes', 'quick-fixes', 1)`,
      [workspace.id],
    );
  }

  /** Step 4's subsystem truth: the picked issue in the queue (M.3's write). */
  async function enqueue(workspace: Tenant, repoId: string): Promise<void> {
    await sql(
      `insert into ${SCHEMA_NAME}.queue_items
              (organization_id, github_repo_id, issue_number, issue_title, effort, workflow_tag,
               position)
       values ($1, $2, $3, 'Typo sweep in operator manual + pairing guide', 'xs', 'quick-fixes', 1)`,
      [workspace.id, repoId, FIRST_ISSUE_NUMBER],
    );
  }

  /** Step 4's other truth: a run of the picked issue. */
  async function startRun(workspace: Tenant, repoId: string): Promise<void> {
    await sql(
      `insert into ${SCHEMA_NAME}.runs
              (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
               status, stage_label, stage_index, stage_total, started_at)
       values ($1, $2, $3, 'Typo sweep in operator manual + pairing guide', 'quick-fixes',
               'claude-fable-5', 'coding', 'Code', 3, 6, now())`,
      [workspace.id, repoId, FIRST_ISSUE_NUMBER],
    );
  }

  /** Step 2's evidence line reads *auto-detected below* once the repository was scanned. */
  async function recordScan(workspace: Tenant, repo: string): Promise<void> {
    await sql(
      `insert into ${SCHEMA_NAME}.repo_detection_scans
              (organization_id, repo_ref, scan_seq, duration_ms)
       values ($1, $2, 1, 38000)`,
      [workspace.id, repo],
    );
  }

  /**
   * Every step done by its own subsystem, the choices stored and the wizard stamped completed —
   * the state mockup 13's user is in after *Run my first loop*.
   *
   * @returns The world.
   */
  async function finished(): Promise<World> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);
    const repo = repoRef(workspace);
    const sourceId = await connectGithub(api, workspace);
    const ticketId = await mirrorTicket(api, workspace, sourceId, { number: FIRST_ISSUE_NUMBER });

    await recordScan(workspace, repo);
    await instantiate(workspace);
    await enqueue(workspace, workspace.repoId);
    await sql(
      `insert into ${SCHEMA_NAME}.onboarding_state
              (organization_id, repo_ref, selected_template, picked_ticket_id, completed_at)
       values ($1, $2, 'quick-fixes', $3, now())`,
      [workspace.id, repo, ticketId],
    );

    return { owner, workspace, repo, repoId: workspace.repoId, sourceId, ticketId };
  }

  /** Read the wizard over HTTP, as the page does. */
  async function read(world: Pick<World, "owner" | "workspace" | "repo">) {
    const response = await inWorkspace(
      api,
      world.owner,
      world.workspace,
    )("get", wizardRoute(world.repo)).expect(200);

    return bodyOf<OnboardingResource>(response);
  }

  /** `POST /complete-step`, status left to the caller. */
  function complete(world: Pick<World, "owner" | "workspace" | "repo">, step: number) {
    return inWorkspace(
      api,
      world.owner,
      world.workspace,
    )("post", wizardRoute(world.repo, "/complete-step")).send({ step });
  }

  /** The step numbers that are not done, in rail order. */
  function open(steps: readonly OnboardingStepResource[]): number[] {
    return steps.filter((step) => step.status !== "done").map((step) => step.step);
  }

  describe("a finished wizard", () => {
    it("reads all four steps done, each with the evidence its subsystem holds", async () => {
      const world = await finished();

      const wizard = await read(world);

      expect(wizard.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);
      expect(wizard.currentStep).toBeNull();
      expect(wizard.steps.map((step) => step.evidence)).toEqual([
        `${world.workspace.slug} · token`,
        `${PRIMARY_REPO} · auto-detected below`,
        "quick-fixes · from quick-fixes@v1",
        "#488 · queued",
      ]);
      expect(wizard.steps.map((step) => step.derivedFrom)).toEqual([
        "sources",
        "tenancy",
        "workflows",
        "intake",
      ]);
    });
  });

  describe("the matrix — each subsystem state × its step", () => {
    const cases: MatrixCase[] = [
      // ---- step 1 — sources -------------------------------------------------------------
      {
        label: "source active, App installed",
        step: 1,
        arrange: (world) =>
          sql(
            `update ${SCHEMA_NAME}.github_orgs set installed_at = now() where organization_id = $1`,
            [world.workspace.id],
          ),
        evidence: (world) => `${world.workspace.slug} · GitHub App installed`,
      },
      {
        label: "source paused",
        step: 1,
        arrange: (world) =>
          sql(`update ${SCHEMA_NAME}.ticket_sources set status = 'paused' where id = $1`, [
            world.sourceId,
          ]),
        reason: (world) =>
          `The GitHub source "GitHub · ${world.workspace.slug}" is paused, so ${world.repo} ` +
          "is not being read.",
      },
      {
        label: "source failing, with the sync loop's reason",
        step: 1,
        arrange: (world) =>
          sql(
            `update ${SCHEMA_NAME}.ticket_sources
                set status = 'error', status_reason = 'token revoked' where id = $1`,
            [world.sourceId],
          ),
        reason: (world) =>
          `The GitHub source "GitHub · ${world.workspace.slug}" is failing: token revoked.`,
      },
      {
        label: "source no longer lists the repository",
        step: 1,
        arrange: (world) =>
          sql(
            `update ${SCHEMA_NAME}.ticket_sources
                set config = jsonb_set(config, '{repos}', $2::jsonb) where id = $1`,
            [world.sourceId, JSON.stringify([SECOND_REPO])],
          ),
        reason: (world) =>
          `No GitHub source covers ${world.repo} yet — connect GitHub to continue.`,
      },
      {
        label: "a second, paused source beside the active one",
        step: 1,
        arrange: async (world) => {
          const second = await connectGithub(api, world.workspace, { displayName: "GitHub · old" });

          await sql(`update ${SCHEMA_NAME}.ticket_sources set status = 'paused' where id = $1`, [
            second,
          ]);
        },
        evidence: (world) => `${world.workspace.slug} · token`,
      },
      // ---- step 2 — tenancy -------------------------------------------------------------
      {
        label: "repository enabled, never scanned",
        step: 2,
        arrange: (world) =>
          sql(`delete from ${SCHEMA_NAME}.repo_detection_scans where organization_id = $1`, [
            world.workspace.id,
          ]),
        evidence: () => `${PRIMARY_REPO} · enabled`,
      },
      {
        label: "repository disabled",
        step: 2,
        arrange: (world) =>
          sql(`update ${SCHEMA_NAME}.github_repos set enabled = false where id = $1`, [
            world.repoId,
          ]),
        reason: (world) => `${world.repo} is not enabled — enable it to continue.`,
      },
      {
        label: "account disabled",
        step: 2,
        arrange: (world) =>
          sql(`update ${SCHEMA_NAME}.github_orgs set enabled = false where organization_id = $1`, [
            world.workspace.id,
          ]),
        reason: (world) =>
          `The GitHub account ${world.workspace.slug} is not enabled for this workspace.`,
      },
      {
        label: "repository no longer mirrored under that name",
        step: 2,
        arrange: (world) =>
          sql(`update ${SCHEMA_NAME}.github_repos set name = 'helios-fw' where id = $1`, [
            world.repoId,
          ]),
        reason: (world) => `${world.repo} is not a repository of this workspace's GitHub accounts.`,
        // The pick is an issue of a repository the workspace no longer mirrors by that name.
        alsoNotDone: [4],
      },
      // ---- step 3 — workflows -----------------------------------------------------------
      {
        label: "the template's workflow lost its provenance",
        step: 3,
        arrange: (world) =>
          sql(
            `update ${SCHEMA_NAME}.workflows
                set template_slug = null, template_version = null where organization_id = $1`,
            [world.workspace.id],
          ),
        reason: () => "No workflow has been created from the quick-fixes template yet.",
      },
      {
        label: "another template picked, nothing instantiated from it",
        step: 3,
        arrange: (world) =>
          sql(
            `update ${SCHEMA_NAME}.onboarding_state
                set selected_template = 'feature-builder' where organization_id = $1`,
            [world.workspace.id],
          ),
        reason: () => "No workflow has been created from the feature-builder template yet.",
        wizardWrite: true,
      },
      {
        label: "no template picked",
        step: 3,
        arrange: (world) =>
          sql(
            `update ${SCHEMA_NAME}.onboarding_state
                set selected_template = null where organization_id = $1`,
            [world.workspace.id],
          ),
        reason: () => "No starting workflow has been chosen yet.",
        wizardWrite: true,
      },
      // ---- step 4 — intake --------------------------------------------------------------
      {
        label: "picked issue has a run instead of a queue item",
        step: 4,
        arrange: async (world) => {
          await sql(`delete from ${SCHEMA_NAME}.queue_items where organization_id = $1`, [
            world.workspace.id,
          ]);
          await startRun(world.workspace, world.repoId);
        },
        evidence: () => "#488 · run started",
      },
      {
        label: "picked issue left the queue",
        step: 4,
        arrange: (world) =>
          sql(`delete from ${SCHEMA_NAME}.queue_items where organization_id = $1`, [
            world.workspace.id,
          ]),
        reason: () => "#488 has not been queued yet.",
      },
      {
        label: "picked issue now belongs to another repository",
        step: 4,
        arrange: (world) =>
          sql(
            `update ${SCHEMA_NAME}.tickets
                set meta = jsonb_set(meta, '{github,repo}', to_jsonb($2::text)) where id = $1`,
            [world.ticketId, SECOND_REPO],
          ),
        reason: (world) => `#488 is not an issue of ${world.repo}, so it cannot be its first run.`,
      },
      {
        label: "picked issue's ticket deleted at the source",
        step: 4,
        arrange: (world) =>
          sql(`delete from ${SCHEMA_NAME}.tickets where id = $1`, [world.ticketId]),
        reason: () => "No first issue has been picked yet.",
        // V067's `on delete set null` clears the pick — the database's write, not the wizard's.
        wizardWrite: true,
      },
    ];

    it.each(cases.map((entry) => [`step ${String(entry.step)} · ${entry.label}`, entry] as const))(
      "%s",
      async (_label, entry) => {
        const world = await finished();
        const before = await wizardRow(api, world.workspace.id, world.repo);

        await entry.arrange(world);

        const wizard = await read(world);
        const derived = wizard.steps[entry.step - 1];
        const notDone =
          entry.reason === undefined ? [] : [entry.step, ...(entry.alsoNotDone ?? [])].sort();

        if (entry.evidence !== undefined) {
          expect(derived).toMatchObject({
            status: "done",
            evidence: entry.evidence(world),
            reason: null,
            regressed: false,
          });
        } else {
          // Not done on a wizard that was completed: a regression with its reason, never
          // "active" and never silently un-ticked.
          expect(derived).toMatchObject({
            status: "todo",
            evidence: null,
            reason: entry.reason?.(world),
            regressed: true,
          });
        }

        // The state moved its own step, and only what really depends on the same row.
        expect(open(wizard.steps)).toEqual(notDone);
        expect(wizard.currentStep).toBe(notDone[0] ?? null);

        // Derived on the read: the subsystem moved, the wizard wrote nothing.
        if (entry.wizardWrite !== true) {
          expect(await wizardRow(api, world.workspace.id, world.repo)).toEqual(before);
        }
      },
    );

    it("states a distinct, non-empty reason for every not-done state", () => {
      const world: World = {
        owner: { id: "user", email: "", displayName: "", cookie: "" },
        workspace: { id: "org", slug: "acme-robotics" },
        repo: `acme-robotics/${PRIMARY_REPO}`,
        repoId: "repo",
        sourceId: "source",
        ticketId: "ticket",
      };
      const reasons = cases.flatMap((entry) => (entry.reason ? [entry.reason(world)] : []));

      expect(new Set(reasons).size).toBe(reasons.length);
      expect(reasons.every((reason) => reason.trim() !== "")).toBe(true);
    });
  });

  describe("a source that disconnects", () => {
    it("regresses step 1 on the very next read for each way a source can stop reading", async () => {
      const world = await finished();
      const before = await wizardRow(api, world.workspace.id, world.repo);

      expect((await read(world)).steps[0].status).toBe("done");

      for (const status of ["paused", "error"]) {
        await sql(`update ${SCHEMA_NAME}.ticket_sources set status = $2 where id = $1`, [
          world.sourceId,
          status,
        ]);

        expect((await read(world)).steps[0]).toMatchObject({ status: "todo", regressed: true });
      }

      // Reconnected: the step is done again, and nothing was ever written to bring it back.
      await sql(`update ${SCHEMA_NAME}.ticket_sources set status = 'active' where id = $1`, [
        world.sourceId,
      ]);

      expect((await read(world)).steps[0]).toMatchObject({ status: "done", regressed: false });
      expect(await wizardRow(api, world.workspace.id, world.repo)).toEqual(before);
    });

    it("regresses steps 1 and 4 when the source is deleted outright and takes its tickets with it", async () => {
      const world = await finished();

      await sql(`delete from ${SCHEMA_NAME}.ticket_sources where id = $1`, [world.sourceId]);

      const wizard = await read(world);

      expect(wizard.steps.map((step) => [step.status, step.regressed])).toEqual([
        ["todo", true],
        ["done", false],
        ["done", false],
        ["todo", true],
      ]);
      expect(wizard.steps[0].reason).toBe(
        `No GitHub source covers ${world.repo} yet — connect GitHub to continue.`,
      );
      expect(wizard.steps[3].reason).toBe("No first issue has been picked yet.");
      expect(wizard.currentStep).toBe(1);
    });
  });

  describe("a full traversal", () => {
    /**
     * Try `complete-step` for every step and hold each answer to the rail: `200` exactly when
     * every step up to it is done, otherwise `409` naming the first blocking step and its reason.
     *
     * @param world - The workspace and repository.
     * @returns The wizard as it stood for the attempts.
     */
    async function holdGuards(
      world: Pick<World, "owner" | "workspace" | "repo">,
    ): Promise<OnboardingResource> {
      const wizard = await read(world);

      // Step 4 is left to the traversal's end: with every step done it stamps completion.
      for (const step of ONBOARDING_STEPS.filter((candidate) => candidate !== 4)) {
        const blocking = wizard.steps.find(
          (candidate) => candidate.step <= step && candidate.status !== "done",
        );
        const response = await complete(world, step);

        if (blocking === undefined) {
          expect(response.status).toBe(200);
          continue;
        }

        expect(response.status).toBe(409);
        expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
          code: "onboarding_step_incomplete",
          message: blocking.reason,
          details: { step, blockingStep: blocking.step },
        });
      }

      return wizard;
    }

    it("turns each step done only when its subsystem says so, and guards every completion on the way", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const repo = repoRef(workspace);
      const world = { owner, workspace, repo };
      const call = inWorkspace(api, owner, workspace);
      const statuses = async () => (await holdGuards(world)).steps.map((step) => step.status);
      const reasonOf = async (step: number) => (await read(world)).steps[step - 1].reason;

      // Fresh: nothing connected, nothing regressed, nothing stored.
      expect(await statuses()).toEqual(["active", "todo", "todo", "todo"]);
      expect((await read(world)).steps.some((step) => step.regressed)).toBe(false);
      expect(await wizardRow(api, workspace.id, repo)).toBeUndefined();

      // Step 1 — a GitHub source covering the repository.
      const sourceId = await connectGithub(api, workspace);

      expect(await statuses()).toEqual(["done", "active", "todo", "todo"]);
      expect(await reasonOf(2)).toBe(
        `${repo} is not a repository of this workspace's GitHub accounts.`,
      );

      // Step 2 — mirrored, then its account enabled, then the repository itself.
      const account = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login)
         values ($1, $2) returning id`,
        [workspace.id, workspace.slug],
      );
      const repository = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.github_repos (org_id, name) values ($1, $2) returning id`,
        [account.rows[0].id, PRIMARY_REPO],
      );
      const repoId = repository.rows[0].id;

      expect(await statuses()).toEqual(["done", "active", "todo", "todo"]);
      expect(await reasonOf(2)).toBe(
        `The GitHub account ${workspace.slug} is not enabled for this workspace.`,
      );

      await sql(`update ${SCHEMA_NAME}.github_orgs set enabled = true where id = $1`, [
        account.rows[0].id,
      ]);

      expect(await reasonOf(2)).toBe(`${repo} is not enabled — enable it to continue.`);

      await sql(`update ${SCHEMA_NAME}.github_repos set enabled = true where id = $1`, [repoId]);

      expect(await statuses()).toEqual(["done", "done", "active", "todo"]);
      // Two steps done and guarded through: the wizard still has no row at all.
      expect(await wizardRow(api, workspace.id, repo)).toBeUndefined();

      // Step 3 — a template picked is a choice; the step waits for the workflow.
      await call("patch", wizardRoute(repo)).send({ selectedTemplate: "quick-fixes" }).expect(200);

      expect(await statuses()).toEqual(["done", "done", "active", "todo"]);
      expect(await reasonOf(3)).toBe(
        "No workflow has been created from the quick-fixes template yet.",
      );

      await instantiate(workspace);

      expect(await statuses()).toEqual(["done", "done", "done", "active"]);

      // Step 4 — a pick is a choice; the step waits for the queue.
      const ticketId = await mirrorTicket(api, workspace, sourceId, { number: FIRST_ISSUE_NUMBER });

      await call("patch", wizardRoute(repo)).send({ pickedTicketId: ticketId }).expect(200);

      expect(await statuses()).toEqual(["done", "done", "done", "active"]);

      const refused = await complete(world, 4).expect(409);

      expect(bodyOf<ErrorEnvelope>(refused)).toMatchObject({
        code: "onboarding_step_incomplete",
        message: "#488 has not been queued yet.",
        details: { step: 4, blockingStep: 4 },
      });
      // A refused completion stamps nothing and answers for no policy.
      expect(await wizardRow(api, workspace.id, repo)).toMatchObject({ completed_at: null });
      expect(
        bodyOf<DryRunPolicyResource>(await call("get", "/api/v1/policies/dry-run").expect(200)),
      ).toMatchObject({ dryRun: false, explicit: false });

      await enqueue(workspace, repoId);

      expect(await statuses()).toEqual(["done", "done", "done", "done"]);

      // The row holds the two choices and nothing about any step — before completion…
      const beforeCompletion = await wizardRow(api, workspace.id, repo);

      expect(beforeCompletion).toMatchObject({
        selected_template: "quick-fixes",
        picked_ticket_id: ticketId,
        completed_at: null,
        dismissed: false,
      });

      const done = bodyOf<OnboardingResource>(await complete(world, 4).expect(200));

      // …and after it, when the only thing added is the stamp.
      const afterCompletion = await wizardRow(api, workspace.id, repo);

      expect(done.choices.completedAt).not.toBeNull();
      expect(afterCompletion).toEqual({
        ...beforeCompletion,
        completed_at: expect.any(Date) as unknown,
        updated_at: expect.any(Date) as unknown,
      });
      expect(
        bodyOf<DryRunPolicyResource>(await call("get", "/api/v1/policies/dry-run").expect(200)),
      ).toMatchObject({ dryRun: true, explicit: true });

      // A second completion keeps the first stamp.
      await complete(world, 4).expect(200);

      expect((await wizardRow(api, workspace.id, repo))?.completed_at).toEqual(
        afterCompletion?.completed_at,
      );
    });

    it("refuses a viewer, and a step that is not on the rail", async () => {
      const world = await finished();
      const viewer = await api.signIn();

      await api.join(world.workspace.id, viewer, "viewer");

      await complete({ ...world, owner: viewer }, 1).expect(403);
      await complete(world, 0).expect(422);
      await complete(world, 5).expect(422);
    });
  });

  describe("storage", () => {
    it("has nowhere to store a step status: the wizard's table holds choices and stamps only", async () => {
      const { rows: columns } = await api.sql.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = $1 and table_name = 'onboarding_state'
          order by column_name`,
        [SCHEMA_NAME],
      );
      const { rows: tables } = await api.sql.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = $1 and table_name like 'onboarding%'
          order by table_name`,
        [SCHEMA_NAME],
      );

      expect(columns.map((column) => column.column_name)).toEqual([
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
      expect(tables.map((table) => table.table_name)).toEqual(["onboarding_state"]);
    });

    it("writes nothing on a read, however often the page polls", async () => {
      const world = await finished();
      const before = await wizardRow(api, world.workspace.id, world.repo);

      await read(world);
      await read(world);
      await complete(world, 3).expect(200);

      expect(await wizardRow(api, world.workspace.id, world.repo)).toEqual(before);
    });
  });
});
