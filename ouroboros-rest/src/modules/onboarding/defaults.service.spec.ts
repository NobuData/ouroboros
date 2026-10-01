/**
 * The right column, read ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5) — from
 * a real environment through the real configuration and the real wizard service, so *a
 * self-hosted deployment is promised no pool* is asserted from the variable down to the payload.
 */

import { AppConfigService } from "../config/config.service";
import {
  DEFAULT_REESTIMATION_BATCH,
  DEFAULT_REESTIMATION_JITTER_MINUTES,
} from "../config/configuration";
import { testConfiguration } from "../config/configuration.fixture";
import type { BacklogHealthRepository, LastRunRow } from "../planning/health.repository";
import type { DryRunPolicyResource } from "../policies/org-policy.service";
import { connectionOf, SmartDefaultsService } from "./defaults.service";
import type { LaunchRepository, MirroredPickRow } from "./launch.repository";
import { emptyRow, FakeOnboarding, ISSUE_ID, ORG, REPO } from "./onboarding.fixture";
import { OnboardingService } from "./onboarding.service";

const LAST_RUN: LastRunRow = {
  startedAt: new Date("2026-09-30T02:14:00.000Z"),
  finishedAt: new Date("2026-09-30T02:19:00.000Z"),
  status: "succeeded",
  found: 9,
  queued: 9,
  inFlight: 0,
};

const PICK: MirroredPickRow = {
  id: ISSUE_ID,
  number: 488,
  title: "Typo sweep in operator manual + pairing guide",
  cycleMin: 3,
  cycleMax: 6,
};

/** What a deployment and a workspace look like to one test. */
interface Bench {
  /** Environment variables on top of the development defaults. */
  env?: NodeJS.ProcessEnv;
  /** The stored dry-run answer; undefined is a workspace that never answered. */
  dryRun?: boolean;
  lastRun?: LastRunRow;
  pick?: MirroredPickRow;
}

/**
 * Build the service for a deployment.
 *
 * @param wizard - The wizard's subsystems.
 * @param bench - The deployment's environment and the workspace's policy and backlog.
 * @returns The service and the repository mock it reads the pick through.
 */
function harness(wizard: FakeOnboarding, bench: Bench = {}) {
  const configuration = testConfiguration(bench.env);
  const config = new AppConfigService({
    getOrThrow: (key: string) => configuration[key as keyof typeof configuration],
    get: (key: string) => configuration[key as keyof typeof configuration],
  } as never);
  const read = jest.fn((): Promise<DryRunPolicyResource> =>
    Promise.resolve({
      dryRun: bench.dryRun ?? false,
      explicit: bench.dryRun !== undefined,
      reason: bench.dryRun === true ? "dry-run policy active" : null,
      updatedAt: null,
      updatedBy: null,
    }),
  );
  const mirroredPick = jest.fn().mockResolvedValue(bench.pick);
  const service = new SmartDefaultsService(
    new OnboardingService(wizard.asRepository(), { adoptDefault: jest.fn() }),
    { mirroredPick } as unknown as LaunchRepository,
    { lastRun: jest.fn().mockResolvedValue(bench.lastRun) } as unknown as BacklogHealthRepository,
    config,
    { read },
  );

  return { service, mirroredPick, read };
}

describe("the smart-defaults service", () => {
  let wizard: FakeOnboarding;

  beforeEach(() => {
    wizard = new FakeOnboarding().readyToLaunch();
  });

  describe("a deployment that declares nothing — self-hosted (O6)", () => {
    it("is promised no managed-key or hosted-runner row", async () => {
      const { service } = harness(wizard);

      const payload = await service.read(ORG, REPO);

      expect(payload.deployment).toBe("self_hosted");
      expect(payload.capabilities).toEqual({ managedKeyPool: false, hostedRunnerPool: false });
      expect(payload.rows.map((row) => row.variant)).toEqual([
        "bring_your_own_keys",
        "enroll_runner",
        "nightly_estimator",
        "slack_future",
      ]);
      expect(JSON.stringify(payload)).not.toMatch(/managed keys|hosted runner|trial/i);
    });

    it("says the same with both flags written out as false", async () => {
      const { service } = harness(wizard, {
        env: { OURO_MANAGED_KEY_POOL: "false", OURO_HOSTED_RUNNER_POOL: "false" },
      });

      expect((await service.read(ORG, REPO)).deployment).toBe("self_hosted");
    });
  });

  describe("a SaaS-flagged deployment (forward-compatible with #397)", () => {
    it("produces the managed rows from the deployment's own declaration", async () => {
      const { service } = harness(wizard, {
        env: {
          OURO_MANAGED_KEY_POOL: "true",
          OURO_MANAGED_KEY_TRIAL_CENTS: "500",
          OURO_HOSTED_RUNNER_POOL: "true",
        },
      });

      const payload = await service.read(ORG, REPO);

      expect(payload.deployment).toBe("saas");
      expect(payload.rows.map((row) => row.variant).slice(0, 2)).toEqual([
        "managed_keys",
        "hosted_runner",
      ]);
      expect(payload.rows[0]).toMatchObject({
        text: "Models: managed keys with $5 trial credit",
        trialCredit: { cents: 500, display: "$5" },
      });
    });

    it("prints no trial figure the deployment did not declare", async () => {
      const { service } = harness(wizard, { env: { OURO_MANAGED_KEY_POOL: "true" } });

      const [models, build] = (await service.read(ORG, REPO)).rows;

      expect(models.text).toBe("Models: managed keys");
      expect(models).not.toHaveProperty("trialCredit");
      // One flag does not imply the other.
      expect(build.variant).toBe("enroll_runner");
    });
  });

  describe("the estimator row", () => {
    it("reflects the real nightly job's schedule and last run", async () => {
      const { service } = harness(wizard, {
        env: { OURO_REESTIMATION_HOUR_UTC: "3" },
        lastRun: LAST_RUN,
      });

      const estimator = (await service.read(ORG, REPO)).rows[2];

      expect(estimator.estimator).toEqual({
        schedule: {
          hourUtc: 3,
          jitterMinutes: DEFAULT_REESTIMATION_JITTER_MINUTES,
          batchLimit: DEFAULT_REESTIMATION_BATCH,
        },
        lastRun: {
          startedAt: "2026-09-30T02:14:00.000Z",
          finishedAt: "2026-09-30T02:19:00.000Z",
          status: "succeeded",
          found: 9,
          queued: 9,
          inFlight: 0,
        },
      });
    });

    it("says the job has never run rather than inventing a time", async () => {
      const { service } = harness(wizard);

      expect((await service.read(ORG, REPO)).rows[2].estimator?.lastRun).toBeNull();
    });
  });

  describe("the reassure claims", () => {
    it("pauses, not uninstalls, a token connection; and holds draft-only before launch", async () => {
      const { service } = harness(wizard);

      const { reassure } = await service.read(ORG, REPO);

      expect(reassure.claims.map((claim) => claim.mechanism.key)).toEqual([
        "dry_run_policy",
        "source_pause",
        "vault_envelope_encryption",
      ]);
    });

    it("says the app can be uninstalled where the account records an installation", async () => {
      wizard.appInstalledFlag = true;
      const { service } = harness(wizard);

      const { reassure } = await service.read(ORG, REPO);

      expect(reassure.claims[1]).toMatchObject({
        text: "The app can be uninstalled in one click.",
        mechanism: { key: "github_app_uninstall" },
      });
    });

    it("drops the claims this workspace has no mechanism for", async () => {
      wizard.sources = [];
      const { service } = harness(wizard, { dryRun: false });

      const { reassure } = await service.read(ORG, REPO);

      expect(reassure.claims.map((claim) => claim.key)).toEqual(["vault"]);
      expect(reassure.line).not.toMatch(/main|uninstall|paused/);
    });
  });

  describe("the timeline", () => {
    it("is projected for the picked issue from its estimate in force", async () => {
      const { service, mirroredPick } = harness(wizard, { pick: PICK });

      const { timeline } = await service.read(ORG, "Acme-Robotics/Helios-Firmware");

      expect(mirroredPick).toHaveBeenCalledWith(ORG, "repo-1", 488);
      expect(timeline).toMatchObject({ kind: "projected", basis: "issue_estimate", dryRun: true });
      expect(timeline.rows[0].text).toBe("loop starts on #488");
      expect(timeline.rows[2].atMinutes).toBe(4);
    });

    it("names the pick and claims no time when the backlog holds no estimate for it", async () => {
      const { service } = harness(wizard, { pick: { ...PICK, cycleMin: null, cycleMax: null } });
      const unmirrored = harness(wizard);

      for (const each of [service, unmirrored.service]) {
        const { timeline } = await each.read(ORG, REPO);

        expect(timeline.basis).toBe("none");
        expect(timeline.rows[0].text).toBe("loop starts on #488");
      }
    });

    it("is generic, and reads no backlog, when nothing is picked", async () => {
      wizard.rows.set(REPO, { ...emptyRow(), selected_template: "quick-fixes" });
      const { service, mirroredPick } = harness(wizard, { pick: PICK });

      const { timeline } = await service.read(ORG, REPO);

      expect(mirroredPick).not.toHaveBeenCalled();
      expect(timeline.rows[0].text).toBe("loop starts on your first issue");
    });

    it("drops the dry-run wording when the workspace turned dry-run off", async () => {
      const { service } = harness(wizard, { dryRun: false, pick: PICK });

      expect((await service.read(ORG, REPO)).timeline.dryRun).toBe(false);
    });
  });

  it("carries no aggregate statistic in either deployment's payload (O8)", async () => {
    const saas = harness(wizard, {
      env: {
        OURO_MANAGED_KEY_POOL: "true",
        OURO_MANAGED_KEY_TRIAL_CENTS: "500",
        OURO_HOSTED_RUNNER_POOL: "true",
      },
      lastRun: LAST_RUN,
      pick: PICK,
    });
    const selfHosted = harness(wizard, { lastRun: LAST_RUN, pick: PICK });

    for (const { service } of [saas, selfHosted]) {
      const text = JSON.stringify(await service.read(ORG, REPO));

      expect(text).not.toMatch(/\d\s*%/);
      expect(text).not.toMatch(/4m 10s/);
      expect(text).not.toMatch(/average|across teams|of teams/i);
    }
  });

  it("writes nothing", async () => {
    const { service } = harness(wizard, { pick: PICK });

    await service.read(ORG, REPO);

    expect(wizard.writes).toEqual([]);
  });

  it("reads a connection as App, token or none", () => {
    const source = {
      displayName: "GitHub · acme-robotics",
      login: "acme-robotics",
      status: "active" as const,
      statusReason: null,
    };

    expect(connectionOf(null)).toBeNull();
    expect(connectionOf({ ...source, appInstalled: true })).toEqual({
      kind: "app",
      login: "acme-robotics",
    });
    expect(connectionOf({ ...source, appInstalled: false })).toEqual({
      kind: "token",
      login: "acme-robotics",
    });
  });
});
