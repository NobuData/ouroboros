/**
 * The OpenAPI document and what the launch and defaults routes send
 * ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5). `openapi.spec.ts` sees these
 * routes only unauthenticated, so this is where real payloads — the launcher's receipt in each
 * outcome, and the defaults of both deployments — are held to `OnboardingLaunchReceipt` and
 * `OnboardingDefaults`, both `additionalProperties: false`.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import type { QueueSelectionBody } from "../backlog/queue.dto";
import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { queueItemSummary } from "../dashboard/resources";
import type { QueueItem } from "../db/schema";
import type { BacklogHealthRepository } from "../planning/health.repository";
import type { DryRunPolicyResource } from "../policies/org-policy.service";
import { SmartDefaultsService } from "./defaults.service";
import type { LaunchRepository, MirroredPickRow, PickRunRow } from "./launch.repository";
import { FirstRunLauncherService } from "./launch.service";
import { FakeOnboarding, ISSUE_ID, ORG, REPO } from "./onboarding.fixture";
import { OnboardingService } from "./onboarding.service";

const QUEUE_ID = "5eed0007-0000-4000-8000-000000000488";
const RUN_ID = "5eed0051-0000-4000-8000-000000000488";

const PICK: MirroredPickRow = {
  id: ISSUE_ID,
  number: 488,
  title: "Typo sweep in operator manual + pairing guide",
  cycleMin: 3,
  cycleMax: 6,
};

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns A function answering Ajv's complaint, or undefined when the value validates.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The dry-run policy read, for a stored answer (or none). */
function policyRead(stored: boolean | undefined): () => Promise<DryRunPolicyResource> {
  return () =>
    Promise.resolve({
      dryRun: stored ?? false,
      explicit: stored !== undefined,
      reason: stored === true ? "dry-run policy active" : null,
      updatedAt: null,
      updatedBy: null,
    });
}

/** A queue row for `#488`, as M.3's write stores it. */
function queueRow(): QueueItem {
  const at = new Date("2026-09-30T10:00:00.000Z");

  return {
    id: QUEUE_ID,
    organization_id: ORG,
    github_repo_id: "repo-1",
    issue_number: 488,
    issue_title: PICK.title,
    effort: "xs",
    workflow_tag: "quick-fixes",
    workflow_version: 1,
    workflow_pin_reason: "explicit",
    playbook_id: null,
    position: 1,
    est_minutes: 15,
    enqueued_at: at,
    created_at: at,
    updated_at: at,
  };
}

describe("the launch route and the document", () => {
  const valid = validatorFor("OnboardingLaunchReceipt");

  /**
   * A launcher over the in-memory wizard.
   *
   * @param options - A run of the pick that already exists, and the stored dry-run answer.
   * @returns The launcher.
   */
  function launcher(options: { run?: PickRunRow; dryRun?: boolean } = {}) {
    const wizard = new FakeOnboarding().readyToLaunch();
    let held: QueueItem | undefined;

    if (options.run !== undefined) {
      wizard.runs.add(488);
    }

    return new FirstRunLauncherService(
      new OnboardingService(wizard.asRepository(), { adoptDefault: () => Promise.resolve(true) }),
      {
        mirroredPick: () => Promise.resolve(PICK),
        queueItem: () => Promise.resolve(held),
        latestRun: () => Promise.resolve(options.run),
      } as unknown as LaunchRepository,
      {
        queueSelection: (_org: string, _body: QueueSelectionBody) => {
          held = queueRow();
          wizard.queued.add(488);

          return Promise.resolve({ items: [queueItemSummary(held)], estMinutes: 15 });
        },
      },
      { read: policyRead(options.dryRun ?? true) },
    );
  }

  it("sends what OnboardingLaunchReceipt describes — queued, then already queued", async () => {
    const service = launcher();

    const first = await service.launch(ORG, REPO);
    const second = await service.launch(ORG, REPO);

    expect(first.outcome).toBe("queued");
    expect(valid(wire(first))).toBeUndefined();
    expect(second.outcome).toBe("already_queued");
    expect(valid(wire(second))).toBeUndefined();
  });

  it("sends what OnboardingLaunchReceipt describes — already started, dry-run off", async () => {
    const receipt = await launcher({
      run: { id: RUN_ID, workflowTag: "quick-fixes" },
      dryRun: false,
    }).launch(ORG, REPO);

    expect(receipt.outcome).toBe("already_started");
    expect(receipt.queue).toBeNull();
    expect(valid(wire(receipt))).toBeUndefined();
  });

  it("is refused by the document when a field is added that it does not describe", async () => {
    const receipt = wire(await launcher().launch(ORG, REPO)) as Record<string, unknown>;

    expect(valid({ ...receipt, averageFirstLoop: "4m 10s" })).toContain("additional properties");
  });
});

describe("the defaults route and the document", () => {
  const valid = validatorFor("OnboardingDefaults");

  /**
   * The defaults service for a deployment.
   *
   * @param env - Environment variables on top of the development defaults.
   * @param wizard - The wizard's subsystems.
   * @param dryRun - The stored dry-run answer, or undefined.
   * @returns The service.
   */
  function defaults(
    env: NodeJS.ProcessEnv,
    wizard: FakeOnboarding = new FakeOnboarding().readyToLaunch(),
    dryRun?: boolean,
  ): SmartDefaultsService {
    const configuration = testConfiguration(env);

    return new SmartDefaultsService(
      new OnboardingService(wizard.asRepository(), { adoptDefault: () => Promise.resolve(true) }),
      { mirroredPick: () => Promise.resolve(PICK) } as unknown as LaunchRepository,
      {
        lastRun: () =>
          Promise.resolve({
            startedAt: new Date("2026-09-30T02:14:00.000Z"),
            finishedAt: new Date("2026-09-30T02:19:00.000Z"),
            status: "succeeded",
            found: 9,
            queued: 9,
            inFlight: 0,
          }),
      } as unknown as BacklogHealthRepository,
      new AppConfigService({
        getOrThrow: (key: string) => configuration[key as keyof typeof configuration],
        get: (key: string) => configuration[key as keyof typeof configuration],
      } as never),
      { read: policyRead(dryRun) },
    );
  }

  it("sends what OnboardingDefaults describes — self-hosted", async () => {
    expect(valid(wire(await defaults({}).read(ORG, REPO)))).toBeUndefined();
  });

  it("sends what OnboardingDefaults describes — SaaS-flagged, with and without a trial credit", async () => {
    const pools = { OURO_MANAGED_KEY_POOL: "true", OURO_HOSTED_RUNNER_POOL: "true" };

    expect(valid(wire(await defaults(pools).read(ORG, REPO)))).toBeUndefined();
    expect(
      valid(
        wire(await defaults({ ...pools, OURO_MANAGED_KEY_TRIAL_CENTS: "500" }).read(ORG, REPO)),
      ),
    ).toBeUndefined();
  });

  it("sends what OnboardingDefaults describes — nothing connected, nothing picked, dry-run off", async () => {
    expect(
      valid(wire(await defaults({}, new FakeOnboarding(), false).read(ORG, REPO))),
    ).toBeUndefined();
  });

  it("sends what OnboardingDefaults describes — an App installation", async () => {
    const wizard = new FakeOnboarding().readyToLaunch();
    wizard.appInstalledFlag = true;

    expect(valid(wire(await defaults({}, wizard, true).read(ORG, REPO)))).toBeUndefined();
  });
});
