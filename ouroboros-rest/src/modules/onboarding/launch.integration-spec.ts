/**
 * *Run my first loop* and the smart defaults, against a real database and the engine stub
 * ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5).
 *
 * The acceptance criteria that are claims about real rows and real requests:
 *
 *   * **Launch queues the picked issue with the instantiated workflow pinned, visible on the
 *     dashboard queue** — the workflow is instantiated through the wizard's own route, the pick is
 *     stored by the picker's `issueId`, and the entry is read back through `GET /api/v1/queue`.
 *   * **Dry-run is defaulted on at completion and confirmed in the receipt** — read back through
 *     `GET /api/v1/policies/dry-run`; an explicit *off* is left alone and the receipt says so.
 *   * **Guards refuse with a stated reason**, and write nothing.
 *   * **A repeat is not a second launch.**
 *   * **A deployment that declares no pool is promised none** — the harness's own environment is
 *     the self-hosted default.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

import {
  PRIMARY_REPO,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../testing/dashboard.fixture";
import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { seedIntake } from "../../testing/intake.fixture";
import type { QueueItemSummary } from "../dashboard/resources";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { DryRunPolicyResource } from "../policies/org-policy.service";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { SmartDefaultsResource } from "./defaults.resources";
import type { LaunchReceiptResource } from "./launch.resources";
import { shipTemplates } from "./onboarding.integration.fixture";
import type { OnboardingResource } from "./resources";

/** A workspace mid-wizard, and the people in it. */
interface Bench {
  readonly owner: Person;
  readonly workspace: SeededWorkspace;
  /** `owner/name` of the mirrored repository. */
  readonly repo: string;
  /** `github_issues.id` of the seeded `#488`. */
  readonly issueId: string;
}

describe("the first-run launcher, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    // A day, so the application's own sync loop cannot poll in the middle of a test.
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
    });
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

  afterEach(() => api.truncate());

  /**
   * Steps 1 and 2 made true by their own subsystems, and the seeded backlog mirrored: a GitHub
   * source covering the enabled repository, its nine issues with their estimates, and the
   * canonical ticket a source would have read for `#488`.
   */
  async function bench(): Promise<Bench> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);

    await seedIntake(api, workspace);

    const source = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub', $2) returning id`,
      [workspace.id, JSON.stringify({ login: workspace.slug, repos: [PRIMARY_REPO] })],
    );

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.tickets
         (organization_id, source_id, external_id, external_key, external_url, title, state,
          source_created_at, source_updated_at, meta)
       values ($1, $2, '488', '#488', 'https://github.com/acme-robotics/helios-firmware/issues/488',
               'Typo sweep in operator manual + pairing guide', 'open', now(), now(), $3)`,
      [
        workspace.id,
        source.rows[0].id,
        JSON.stringify({ github: { owner: workspace.slug, repo: PRIMARY_REPO } }),
      ],
    );

    const issue = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.github_issues where organization_id = $1 and number = 488`,
      [workspace.id],
    );

    return {
      owner,
      workspace,
      repo: `${workspace.slug}/${PRIMARY_REPO}`,
      issueId: issue.rows[0].id,
    };
  }

  /** A request as somebody, in the bench's workspace. */
  function as(person: Person, { workspace }: Bench) {
    return (method: "get" | "post" | "patch", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /** An onboarding route for the bench's repository. */
  function route(at: Bench, path: string): string {
    return `/api/v1/onboarding${path}?repo=${encodeURIComponent(at.repo)}`;
  }

  /** Step 3 through the wizard's own route: instantiate and publish `quick-fixes`. */
  async function instantiate(at: Bench): Promise<void> {
    await as(at.owner, at)("post", route(at, "/select-template"))
      .send({ slug: "quick-fixes" })
      .expect(200);
  }

  /** Store the pick the way the first-issue card does: by the picker's `issueId`. */
  async function pick(at: Bench): Promise<OnboardingResource> {
    const response = await as(at.owner, at)("patch", route(at, ""))
      .send({ pickedIssueId: at.issueId })
      .expect(200);

    return bodyOf<OnboardingResource>(response);
  }

  /** Launch, expecting the receipt. */
  async function launch(at: Bench): Promise<LaunchReceiptResource> {
    const response = await as(at.owner, at)("post", route(at, "/launch")).expect(200);

    return bodyOf<LaunchReceiptResource>(response);
  }

  /** The workspace's queue, as the dashboard's drill-in reads it. */
  async function queue(at: Bench): Promise<QueueItemSummary[]> {
    const response = await as(at.owner, at)("get", "/api/v1/queue").expect(200);

    return bodyOf<{ items: QueueItemSummary[] }>(response).items;
  }

  /** The dry-run policy, as every surface reads it. */
  async function dryRun(at: Bench): Promise<DryRunPolicyResource> {
    const response = await as(at.owner, at)("get", "/api/v1/policies/dry-run").expect(200);

    return bodyOf<DryRunPolicyResource>(response);
  }

  /** The wizard's stored row. */
  async function storedRow(at: Bench): Promise<Record<string, unknown> | undefined> {
    const { rows } = await api.sql.query<Record<string, unknown>>(
      `select * from ${SCHEMA_NAME}.onboarding_state where organization_id = $1 and repo_ref = $2`,
      [at.workspace.id, at.repo.toLowerCase()],
    );

    return rows[0];
  }

  describe("a pick named by the picker's issue id", () => {
    it("stores the issue's canonical ticket, and the rail reads it as this repository's", async () => {
      const at = await bench();

      const wizard = await pick(at);

      expect(wizard.refs.pickedTicket).toMatchObject({ externalKey: "#488", source: "github" });
      expect(wizard.steps[3].reason).toBe("#488 has not been queued yet.");
    });

    it("answers 404 for another workspace's issue id", async () => {
      const other = await bench();
      const stranger = await api.signIn({ email: "second@example.com" });
      const workspace = await workspaceWithRepo(api, stranger);
      const here: Bench = {
        owner: stranger,
        workspace,
        repo: `${workspace.slug}/${PRIMARY_REPO}`,
        issueId: other.issueId,
      };

      const response = await as(stranger, here)("patch", route(here, ""))
        .send({ pickedIssueId: other.issueId })
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("onboarding_issue_not_found");
    });

    it("answers 422 for an issue no GitHub source has read into a ticket", async () => {
      const at = await bench();
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.github_issues where organization_id = $1 and number = 491`,
        [at.workspace.id],
      );

      const response = await as(at.owner, at)("patch", route(at, ""))
        .send({ pickedIssueId: rows[0].id })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: "onboarding_issue_ticket_missing",
        details: { issueNumber: 491 },
      });
    });
  });

  describe("a launch", () => {
    it("queues the pick with the instantiated workflow pinned, visible on the dashboard queue", async () => {
      const at = await bench();
      await instantiate(at);
      await pick(at);

      const receipt = await launch(at);

      expect(receipt).toMatchObject({
        outcome: "queued",
        issue: { id: at.issueId, number: 488 },
        workflow: {
          slug: "quick-fixes",
          version: 1,
          pinReason: "explicit",
          path: "/workflows/quick-fixes",
        },
        links: { dashboard: "/dashboard", queue: "/dashboard#dash-up-next-title", console: null },
        run: null,
      });

      const [entry, ...rest] = await queue(at);

      expect(rest).toEqual([]);
      expect(entry).toEqual(receipt.queue);
      expect(entry).toMatchObject({
        issueNumber: 488,
        position: 1,
        workflowTag: "quick-fixes",
        workflowVersion: 1,
        workflowPinReason: "explicit",
      });
    });

    it("completes the wizard and defaults dry-run ON for a workspace that never answered", async () => {
      const at = await bench();
      await instantiate(at);
      await pick(at);
      expect(await dryRun(at)).toMatchObject({ dryRun: false, explicit: false });

      const receipt = await launch(at);

      expect(receipt.dryRun).toMatchObject({ active: true, reason: "dry-run policy active" });
      expect(await dryRun(at)).toMatchObject({ dryRun: true, explicit: true, updatedBy: null });
      expect(receipt.onboarding.steps.map((step) => step.status)).toEqual([
        "done",
        "done",
        "done",
        "done",
      ]);
      expect(receipt.completedAt).not.toBeNull();
      expect((await storedRow(at))?.completed_at).not.toBeNull();
    });

    it("leaves an explicit dry-run off alone, and the receipt says so", async () => {
      const at = await bench();
      await instantiate(at);
      await pick(at);
      await as(at.owner, at)("patch", "/api/v1/policies/dry-run")
        .send({ dryRun: false })
        .expect(200);

      const receipt = await launch(at);

      expect(receipt.dryRun.active).toBe(false);
      expect(receipt.dryRun.note).toContain("Dry-run is off");
      expect(receipt.timeline.dryRun).toBe(false);
      expect(await dryRun(at)).toMatchObject({ dryRun: false, explicit: true });
    });

    it("labels the timeline as a projection, timed only by the issue's own estimate", async () => {
      const at = await bench();
      await instantiate(at);
      await pick(at);

      const { timeline } = await launch(at);

      expect(timeline.kind).toBe("projected");
      expect(timeline.rows.every((row) => row.kind === "projected")).toBe(true);
      // The seeded 3–6 minute cycle: the first-issue card's `est. 4 min`.
      expect(timeline.rows.map((row) => row.atMinutes)).toEqual([0, null, 4, null, null]);
    });

    it("is not a second launch when repeated", async () => {
      const at = await bench();
      await instantiate(at);
      await pick(at);

      const first = await launch(at);
      const second = await launch(at);

      expect(second.outcome).toBe("already_queued");
      expect(second.queue).toEqual(first.queue);
      expect(second.completedAt).toBe(first.completedAt);
      expect(await queue(at)).toHaveLength(1);
    });
  });

  describe("the guards", () => {
    it("refuses with step 3's reason before a workflow is instantiated, and writes nothing", async () => {
      const at = await bench();
      await pick(at);

      const response = await as(at.owner, at)("post", route(at, "/launch")).expect(409);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: "onboarding_step_incomplete",
        message: "No starting workflow has been chosen yet.",
        details: { step: 4, blockingStep: 3 },
      });
      expect(await queue(at)).toEqual([]);
      expect((await storedRow(at))?.completed_at).toBeNull();
      expect(await dryRun(at)).toMatchObject({ dryRun: false, explicit: false });
    });

    it("refuses with a stated reason when nothing is picked", async () => {
      const at = await bench();
      await instantiate(at);

      const response = await as(at.owner, at)("post", route(at, "/launch")).expect(409);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: "onboarding_pick_required",
        message: "No first issue has been picked yet.",
      });
      expect(await queue(at)).toEqual([]);
    });

    it("refuses a viewer and a stranger", async () => {
      const at = await bench();
      const viewer = await api.signIn({ email: "viewer@example.com" });
      await api.join(at.workspace.id, viewer, "viewer");

      await as(viewer, at)("post", route(at, "/launch")).expect(403);
      await api.anonymous("post", route(at, "/launch")).expect(401);
      await api.anonymous("get", route(at, "/defaults")).expect(401);
    });
  });

  describe("the smart defaults", () => {
    it("promises a deployment that declares no pool neither managed keys nor a hosted runner", async () => {
      const at = await bench();
      const viewer = await api.signIn({ email: "viewer@example.com" });
      await api.join(at.workspace.id, viewer, "viewer");

      const response = await as(viewer, at)("get", route(at, "/defaults")).expect(200);
      const payload = bodyOf<SmartDefaultsResource>(response);

      expect(payload.deployment).toBe("self_hosted");
      expect(payload.capabilities).toEqual({ managedKeyPool: false, hostedRunnerPool: false });
      expect(payload.rows.map((row) => row.variant)).toEqual([
        "bring_your_own_keys",
        "enroll_runner",
        "nightly_estimator",
        "slack_future",
      ]);
      expect(JSON.stringify(payload)).not.toMatch(/managed keys|hosted runner|trial/i);
      expect(JSON.stringify(payload)).not.toMatch(/\d\s*%|4m 10s|across teams/);
    });

    it("carries the real nightly job's last run on the estimator row", async () => {
      const at = await bench();
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.reestimation_runs (night, batch_limit, status, started_at)
         values (current_date, 200, 'running', now() - interval '5 minutes')`,
      );

      const response = await as(at.owner, at)("get", route(at, "/defaults")).expect(200);
      const estimator = bodyOf<SmartDefaultsResource>(response).rows[2];

      expect(estimator.estimator?.lastRun).toMatchObject({ status: "running", finishedAt: null });
    });

    it("assembles the reassure strip from this workspace's mechanisms, before and after a flip", async () => {
      const at = await bench();
      await pick(at);

      const before = bodyOf<SmartDefaultsResource>(
        await as(at.owner, at)("get", route(at, "/defaults")).expect(200),
      );

      expect(before.reassure.claims.map((claim) => claim.mechanism.key)).toEqual([
        "dry_run_policy",
        "source_pause",
        "vault_envelope_encryption",
      ]);
      expect(before.timeline.rows[0].text).toBe("loop starts on #488");

      await as(at.owner, at)("patch", "/api/v1/policies/dry-run")
        .send({ dryRun: false })
        .expect(200);

      const after = bodyOf<SmartDefaultsResource>(
        await as(at.owner, at)("get", route(at, "/defaults")).expect(200),
      );

      expect(after.reassure.claims.map((claim) => claim.key)).toEqual(["uninstall", "vault"]);
    });
  });
});
