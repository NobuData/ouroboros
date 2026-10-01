/**
 * **The dry-run round trip: from the wizard's promise to the PR plane's enforcement** — BB.6
 * ([#389](https://github.com/NobuData/ouroboros/issues/389)).
 *
 * Mockup 13's safety card says *"your first loop starts in dry-run"*, and the reassure strip
 * says *"nothing is written to main"*. Neither sentence is enforced anywhere near the wizard: the
 * launcher only turns a policy on, and what makes the policy mean anything lives in the PR plane
 * — the PR opener, the arm and merge routes, the executor's re-check. Someone editing the merge
 * executor who has never seen the onboarding page can remove the guarantee without a single
 * onboarding test noticing. This suite is that test.
 *
 * One workspace, on the application's own services, with the PR plane's scene
 * (`pr-plane.integration.fixture.ts`: mockup 12's PR on the in-memory git host) and the wizard
 * mid-way in the same workspace:
 *
 * ```
 * before     policy never answered · a PR opens ready-for-review · the plan arms
 * launch     POST /onboarding/launch  ─▶  receipt says dry-run is on, read back from the table
 * enforced   the armed plan's turn comes   → refused at execution, disarmed with the reason,
 *                                            nothing merged on the host
 *            arm · merge                   → 409 dry_run_policy_active
 *            a PR opened non-draft         → the host holds a draft
 *            the plan                      → auto-merge requested, overridden, not effective
 *            the pinned workflow documents → byte-for-byte what they were
 * flip       PATCH /policies/dry-run off  ─▶  auto-merge effective again · PRs open ready ·
 *                                            the same PR arms and merges on the host
 * ```
 *
 * **Mutation checks** (run for #389) — deleting each enforcement point turns a case red:
 *   * `PrSyncService.create` no longer forcing `draft` → *forces a PR opened non-draft…*.
 *   * `MergeExecutorService.arm` without `assertNotDryRun` → the round trip, at the refused arm.
 *   * `MergeExecutorService.merge` without `assertNotDryRun` → *refuses a direct merge before
 *     anything is written*.
 *   * `recheckAndMerge` without its dry-run read → the round trip: the host shows a merge.
 *   * the plan resource no longer overriding auto-merge → the round trip, at the plan.
 *   * `OnboardingService.completeStep` without `adoptDefault` → the round trip, at the receipt.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/onboarding/dry-run.roundtrip
 * ```
 */

import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { DryRunPolicyResource } from "../policies/org-policy.service";
import { MergeExecutorService } from "../pull-requests/merge/merge.executor";
import type { MergePlanResource } from "../pull-requests/merge/merge.resources";
import {
  PrPlaneHosts,
  one,
  prPlaneScene,
  verdict,
  type PrPlaneScene,
} from "../pull-requests/pr-plane.integration.fixture";
import { PrSyncService } from "../pull-requests/pr-sync.service";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  type InMemoryPrHost,
} from "../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
} from "../ticket-sources/providers/in-memory.provider.fixture";
import type { LaunchReceiptResource } from "./launch.resources";
import {
  inWorkspace,
  launchFirstLoop,
  pickIssue,
  selectTemplate,
  shipTemplates,
  wizardIn,
  type WizardBench,
} from "./onboarding.integration.fixture";

const POLICY = "/api/v1/policies/dry-run";

/** The PR plane's scene and the wizard, in one workspace. */
interface RoundTrip {
  readonly pr: PrPlaneScene;
  readonly wizard: WizardBench;
}

describe("dry-run, from the wizard's launch to the PR plane and back", () => {
  const hosts = new PrPlaneHosts();
  let api: ApiHarness;
  let engine: EngineStub;
  let host: InMemoryPrHost;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start(
      { OURO_ENGINE_URL: engine.url, OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" },
      hosts.overrides(),
    );
  });

  afterAll(async () => {
    await shipTemplates(api);
    await api.close();
    await engine.stop();
  });

  beforeEach(async () => {
    host = hosts.reset();
    engine.reset();
    await shipTemplates(api);
  });

  // Let every scheduled merge finish before the database is emptied under it.
  afterEach(async () => {
    await executor().settled();
    await api.truncate();
  });

  /** @returns The application's merge executor. */
  function executor(): MergeExecutorService {
    return api.nest.get(MergeExecutorService);
  }

  /**
   * Mockup 12's PR verifying on the host — build green, test suite pending — and, in the same
   * workspace, the wizard one press from launching: `quick-fixes` instantiated, `#488` picked.
   *
   * @returns Both.
   */
  async function scene(): Promise<RoundTrip> {
    const pr = await prPlaneScene(api, host);
    const wizard = await wizardIn(api, pr.owner, pr.bench.workspace);

    await selectTemplate(api, wizard).expect(200);
    await pickIssue(api, wizard).expect(200);

    return { pr, wizard };
  }

  /** A request as the workspace's owner. */
  function owner(at: RoundTrip) {
    return inWorkspace(api, at.pr.owner, at.pr.bench.workspace);
  }

  /** The dry-run policy, as every surface reads it. */
  async function policy(at: RoundTrip): Promise<DryRunPolicyResource> {
    return bodyOf<DryRunPolicyResource>(await owner(at)("get", POLICY).expect(200));
  }

  /** `GET /pull-requests/{id}/merge-plan`. */
  async function mergePlan(at: RoundTrip): Promise<MergePlanResource> {
    const response = await owner(at)(
      "get",
      `/api/v1/pull-requests/${at.pr.prId}/merge-plan`,
    ).expect(200);

    return bodyOf<MergePlanResource>(response);
  }

  /** `POST …/merge-plan/arm` against revision 1, status left to the caller. */
  function arm(at: RoundTrip) {
    return owner(at)("post", `/api/v1/pull-requests/${at.pr.prId}/merge-plan/arm`).send({
      revisionId: at.pr.revisionId,
    });
  }

  /** `POST …/merge-plan/merge`, status left to the caller. */
  function merge(at: RoundTrip) {
    return owner(at)("post", `/api/v1/pull-requests/${at.pr.prId}/merge-plan/merge`);
  }

  /** What the gate engine's listener does after an evaluation: give the armed plan its turn. */
  async function fire(at: RoundTrip): Promise<void> {
    executor().schedule(at.pr.org, at.pr.prId);
    await executor().settled();
  }

  /** The stored plan row, or undefined when none was ever materialized. */
  function storedPlan(at: RoundTrip) {
    return one<{ armed: boolean; disarm_reason: string | null; merged: boolean }>(
      api,
      `select armed, disarm_reason, merged_result is not null as merged
         from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1`,
      [at.pr.prId],
    );
  }

  /** The PR's mirrored state. */
  async function prState(at: RoundTrip): Promise<string> {
    return (
      await one<{ state: string }>(
        api,
        `select state from ${SCHEMA_NAME}.pull_requests where id = $1`,
        [at.pr.prId],
      )
    ).state;
  }

  /**
   * Open a PR through the PR plane's opener, asking for it *not* to be a draft, and read what
   * the host holds.
   *
   * @param at - The scene.
   * @param branch - A branch to open it from; pushed first.
   * @returns Whether the opener answered a draft, and whether the host holds one.
   */
  async function openReady(
    at: RoundTrip,
    branch: string,
  ): Promise<{ answered: boolean | undefined; held: boolean }> {
    host.push(branch, [{ path: "docs/operator-manual.md", additions: 3, deletions: 3 }]);

    const ref = await api.nest.get(PrSyncService).create(at.pr.org, at.pr.sourceId, {
      branch,
      base: IN_MEMORY_DEFAULT_BRANCH,
      title: `docs: typo sweep (${branch})`,
      body: null,
      draft: false,
    });

    return {
      answered: ref?.draft,
      held: host.pull(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, ref?.number ?? 0).draft,
    };
  }

  /**
   * Every published workflow document of the workspace, as stored — the run's pinned
   * `standard-fix` and the wizard's `quick-fixes` — to hold "overridden, never mutated" to.
   */
  async function workflowDocuments(at: RoundTrip): Promise<unknown[]> {
    const { rows } = await api.sql.query<Record<string, unknown>>(
      `select w.slug, w.current_version, w.status, v.version, v.definition
         from ${SCHEMA_NAME}.workflows w
         join ${SCHEMA_NAME}.workflow_versions v on v.workflow_id = w.id
        where w.organization_id = $1
        order by w.slug, v.version`,
      [at.pr.org],
    );

    return rows;
  }

  /** The designed refusal, as the routes answer it. */
  const DRY_RUN_REFUSAL = {
    code: "dry_run_policy_active",
    details: { reason: "dry_run_policy_active", policy: "dry_run" },
  };

  it("holds the wizard's promise in the PR plane, and restores prior behaviour on the flip", async () => {
    const at = await scene();
    const documents = await workflowDocuments(at);

    // ---- before: the workspace never answered, and the PR plane behaves as it always has ----
    expect(await policy(at)).toMatchObject({ dryRun: false, explicit: false });
    expect((await mergePlan(at)).dryRun).toEqual({
      active: false,
      reason: null,
      autoMerge: { requested: true, effective: true, overridden: false },
    });
    expect(await openReady(at, "loop/before-launch")).toEqual({ answered: false, held: false });

    await arm(at).expect(200);
    await executor().settled();
    expect(await storedPlan(at)).toMatchObject({ armed: true, merged: false });

    // ---- the launch: the wizard completes, and dry-run is on because of it -------------------
    const receipt = bodyOf<LaunchReceiptResource>(
      await launchFirstLoop(api, at.wizard).expect(200),
    );

    expect(receipt.dryRun).toMatchObject({ active: true, reason: "dry-run policy active" });
    expect(await policy(at)).toMatchObject({ dryRun: true, explicit: true, updatedBy: null });

    // ---- enforced: the plan armed before the launch gets its turn, and is refused -----------
    await verdict(api, at.pr.gates.test_suite, at.pr.revisionId, "green", "63/63 after attempt 4");
    await fire(at);

    expect(host.ledger().merged).toEqual([]);
    expect(host.ledger().closedIssues).toEqual([]);
    expect(await storedPlan(at)).toMatchObject({
      armed: false,
      merged: false,
      disarm_reason: expect.stringMatching(
        /^dry_run_policy_active: dry-run policy active/,
      ) as unknown,
    });
    expect(await prState(at)).toBe("verifying");

    // Arming again and merging directly are both refused with the designed reason…
    expect(bodyOf<ErrorEnvelope>(await arm(at).expect(409))).toMatchObject(DRY_RUN_REFUSAL);
    expect(bodyOf<ErrorEnvelope>(await merge(at).expect(409))).toMatchObject(DRY_RUN_REFUSAL);
    expect(host.ledger().merged).toEqual([]);

    // …a PR asked for as ready-for-review is opened as a draft…
    expect(await openReady(at, "loop/under-dry-run")).toEqual({ answered: true, held: true });

    // …and the workflow's auto-merge is overridden where it is evaluated, never rewritten.
    expect((await mergePlan(at)).dryRun).toEqual({
      active: true,
      reason: "dry-run policy active",
      autoMerge: { requested: true, effective: false, overridden: true },
    });
    expect(await workflowDocuments(at)).toEqual(documents);

    // ---- the flip: an owner turns dry-run off, and everything is as it was -------------------
    const flipped = bodyOf<DryRunPolicyResource>(
      await owner(at)("patch", POLICY).send({ dryRun: false }).expect(200),
    );

    expect(flipped).toMatchObject({ dryRun: false, explicit: true, updatedBy: at.pr.owner.id });
    expect((await mergePlan(at)).dryRun).toEqual({
      active: false,
      reason: null,
      autoMerge: { requested: true, effective: true, overridden: false },
    });
    expect(await openReady(at, "loop/after-flip")).toEqual({ answered: false, held: false });

    // The same PR, the same gates: it arms, and — already green — merges on the host.
    await arm(at).expect(200);
    await executor().settled();

    expect(host.ledger().merged).toEqual([at.pr.prNumber]);
    expect(await storedPlan(at)).toMatchObject({ merged: true });
    expect(await prState(at)).toBe("merged");
    // Restored exactly: not one workflow document changed across the whole round trip.
    expect(await workflowDocuments(at)).toEqual(documents);
  });

  it("refuses a direct merge before anything is written: no plan is materialized for it", async () => {
    const at = await scene();

    await launchFirstLoop(api, at.wizard).expect(200);
    await verdict(api, at.pr.gates.test_suite, at.pr.revisionId, "green", "63/63 after attempt 4");

    // Every gate is green and the caller is the owner: only the policy stands in the way.
    expect(bodyOf<ErrorEnvelope>(await merge(at).expect(409))).toMatchObject(DRY_RUN_REFUSAL);
    expect(await storedPlan(at)).toBeUndefined();
    expect(host.ledger().merged).toEqual([]);
    expect(await prState(at)).toBe("verifying");
  });

  it("forces a PR opened non-draft into a draft from the moment the wizard completes", async () => {
    const at = await scene();

    expect(await openReady(at, "loop/first")).toEqual({ answered: false, held: false });

    await launchFirstLoop(api, at.wizard).expect(200);

    expect(await openReady(at, "loop/second")).toEqual({ answered: true, held: true });
  });

  it("leaves a workspace that chose dry-run off alone: its launch enforces nothing", async () => {
    const at = await scene();

    await owner(at)("patch", POLICY).send({ dryRun: false }).expect(200);

    const receipt = bodyOf<LaunchReceiptResource>(
      await launchFirstLoop(api, at.wizard).expect(200),
    );

    // The receipt says so in words, and the PR plane agrees with it.
    expect(receipt.dryRun.active).toBe(false);
    expect(receipt.dryRun.note).toContain("Dry-run is off");
    expect(await openReady(at, "loop/chose-off")).toEqual({ answered: false, held: false });
    await verdict(api, at.pr.gates.test_suite, at.pr.revisionId, "green", "63/63 after attempt 4");
    await arm(at).expect(200);
    await executor().settled();

    expect(host.ledger().merged).toEqual([at.pr.prNumber]);
  });
});
