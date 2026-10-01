/**
 * The right column's selection rules ([#388](https://github.com/NobuData/ouroboros/issues/388),
 * BB.5): which rows a deployment gets (O6), which claims a workspace gets (O9), and that no
 * statistic is in either (O8).
 */

import {
  BUILD_FARM_PATH,
  defaultRows,
  dryRunAtLaunch,
  formatCredit,
  POLICIES_PATH,
  PROVIDERS_PATH,
  reassureClaims,
  smartDefaultsResource,
  SOURCES_PATH,
  type DefaultRowVariant,
  type SmartDefaultsFacts,
} from "./defaults.resources";

/** The nightly job as it reads after a completed run. */
const ESTIMATOR: SmartDefaultsFacts["estimator"] = {
  schedule: { hourUtc: 2, jitterMinutes: 30, batchLimit: 200 },
  lastRun: {
    startedAt: "2026-09-30T02:14:00.000Z",
    finishedAt: "2026-09-30T02:19:00.000Z",
    status: "succeeded",
    found: 9,
    queued: 9,
    inFlight: 0,
  },
};

/** Variants that promise infrastructure only a SaaS operator runs. */
const MANAGED_VARIANTS: readonly DefaultRowVariant[] = ["managed_keys", "hosted_runner"];

/**
 * The facts of one deployment, with whatever a test changes.
 *
 * @param overrides - The fields to change.
 * @returns The self-hosted default: no pools, a token connection, dry-run never answered.
 */
function facts(overrides: Partial<SmartDefaultsFacts> = {}): SmartDefaultsFacts {
  return {
    repo: "acme-robotics/helios-firmware",
    capabilities: { managedKeyPool: false, hostedRunnerPool: false },
    trialCents: undefined,
    estimator: ESTIMATOR,
    connection: { kind: "token", login: "acme-robotics" },
    dryRun: { active: false, explicit: false },
    pick: { issueKey: "#488", cycle: { min: 3, max: 6 } },
    ...overrides,
  };
}

/** The SaaS fixture BD.2 (#397) will make real: both pools, a $5 trial. */
const SAAS = facts({
  capabilities: { managedKeyPool: true, hostedRunnerPool: true },
  trialCents: 500,
});

describe("the smart-defaults rows", () => {
  describe("a self-hosted deployment — the default (O6)", () => {
    const payload = smartDefaultsResource(facts());

    it("contains no managed-key or hosted-runner row", () => {
      expect(payload.deployment).toBe("self_hosted");
      expect(payload.capabilities).toEqual({ managedKeyPool: false, hostedRunnerPool: false });
      expect(payload.rows.some((row) => MANAGED_VARIANTS.includes(row.variant))).toBe(false);
    });

    it("promises neither pool anywhere in its text", () => {
      const text = JSON.stringify(payload);

      expect(text).not.toMatch(/managed keys/i);
      expect(text).not.toMatch(/hosted runner/i);
      expect(text).not.toMatch(/trial/i);
      expect(text).not.toContain("$");
    });

    it("gives different rows, not disabled ones: bring your own keys, enroll a runner", () => {
      expect(payload.rows.slice(0, 2)).toEqual([
        {
          key: "models",
          variant: "bring_your_own_keys",
          status: "ready",
          text: "Models: bring your own keys",
          link: { label: "Providers", path: PROVIDERS_PATH },
        },
        {
          key: "build",
          variant: "enroll_runner",
          status: "ready",
          text: "Build: enroll a runner",
          link: { label: "Build Farm", path: BUILD_FARM_PATH },
        },
      ]);
    });
  });

  describe("a SaaS-flagged deployment (forward-compatible with #397)", () => {
    const payload = smartDefaultsResource(SAAS);

    it("produces the managed rows, with the deployment's own trial credit", () => {
      expect(payload.deployment).toBe("saas");
      expect(payload.rows.slice(0, 2)).toEqual([
        {
          key: "models",
          variant: "managed_keys",
          status: "ready",
          text: "Models: managed keys with $5 trial credit",
          link: { label: "bring your own keys anytime", path: PROVIDERS_PATH },
          trialCredit: { cents: 500, display: "$5" },
        },
        {
          key: "build",
          variant: "hosted_runner",
          status: "ready",
          text: "Build: hosted runner for your first loops",
          link: { label: "enroll your own farm later", path: BUILD_FARM_PATH },
        },
      ]);
    });

    it("names no figure when the deployment declares no trial credit", () => {
      const [models] = defaultRows({ ...SAAS, trialCents: undefined });

      expect(models.text).toBe("Models: managed keys");
      expect(models).not.toHaveProperty("trialCredit");
      expect(JSON.stringify(models)).not.toContain("$");
    });
  });

  it("selects each row by its own flag", () => {
    const keysOnly = smartDefaultsResource(
      facts({ capabilities: { managedKeyPool: true, hostedRunnerPool: false } }),
    );
    const runnerOnly = smartDefaultsResource(
      facts({ capabilities: { managedKeyPool: false, hostedRunnerPool: true } }),
    );

    expect(keysOnly.rows.map((row) => row.variant).slice(0, 2)).toEqual([
      "managed_keys",
      "enroll_runner",
    ]);
    expect(runnerOnly.rows.map((row) => row.variant).slice(0, 2)).toEqual([
      "bring_your_own_keys",
      "hosted_runner",
    ]);
    expect(keysOnly.deployment).toBe("saas");
    expect(runnerOnly.deployment).toBe("saas");
  });

  it("always lists four rows in card order", () => {
    for (const payload of [smartDefaultsResource(facts()), smartDefaultsResource(SAAS)]) {
      expect(payload.rows.map((row) => row.key)).toEqual(["models", "build", "estimator", "slack"]);
    }
  });

  it("carries the real nightly job's schedule and last run on the estimator row", () => {
    const estimator = defaultRows(facts())[2];

    expect(estimator).toEqual({
      key: "estimator",
      variant: "nightly_estimator",
      status: "ready",
      text: "Estimator pre-sizes your backlog overnight",
      link: null,
      estimator: ESTIMATOR,
    });
  });

  it("says so when the nightly job has never run", () => {
    const never = { schedule: ESTIMATOR.schedule, lastRun: null };

    expect(defaultRows(facts({ estimator: never }))[2].estimator).toEqual(never);
  });

  it("keeps Slack dim and unlinked — there is no Slack surface to send anyone to", () => {
    expect(defaultRows(facts())[3]).toEqual({
      key: "slack",
      variant: "slack_future",
      status: "optional",
      text: "Slack: connect after your first PR (optional)",
      link: null,
      arrivesWith: "ChatOps",
    });
  });

  it.each([
    [500, "$5"],
    [550, "$5.50"],
    [1, "$0.01"],
    [100000, "$1000"],
  ])("prints %i cents as %s", (cents, display) => {
    expect(formatCredit(cents)).toBe(display);
  });
});

describe("the reassure claims (O9)", () => {
  it("traces every claim to a mechanism, with the issue that delivered it", () => {
    const claims = reassureClaims(facts({ dryRun: { active: true, explicit: true } }));

    expect(claims.map((claim) => [claim.key, claim.mechanism.key, claim.mechanism.issue])).toEqual([
      ["draft_only", "dry_run_policy", 382],
      ["uninstall", "source_pause", 141],
      ["vault", "vault_envelope_encryption", 222],
    ]);
    for (const claim of claims) {
      expect(claim.text).not.toBe("");
      expect(claim.mechanism.description).not.toBe("");
    }
  });

  describe("draft-only", () => {
    it("holds while dry-run is on, and points at the policy", () => {
      const [claim] = reassureClaims(facts({ dryRun: { active: true, explicit: true } }));

      expect(claim.text).toBe("Nothing is written to main.");
      expect(claim.mechanism.path).toBe(POLICIES_PATH);
      expect(claim.mechanism.description).toMatch(/^The dry-run policy is on/);
    });

    it("holds for a workspace that never answered, because launching turns dry-run on", () => {
      const [claim] = reassureClaims(facts({ dryRun: { active: false, explicit: false } }));

      expect(claim.key).toBe("draft_only");
      expect(claim.mechanism.description).toMatch(/^Running your first loop turns the dry-run/);
    });

    it("is left out when the workspace turned dry-run off", () => {
      const claims = reassureClaims(facts({ dryRun: { active: false, explicit: true } }));

      expect(claims.map((claim) => claim.key)).toEqual(["uninstall", "vault"]);
    });
  });

  describe("uninstall, by how the repository reaches GitHub", () => {
    it("says the app can be uninstalled only where an App installation is recorded", () => {
      const claim = reassureClaims(
        facts({ connection: { kind: "app", login: "acme-robotics" } }),
      )[1];

      expect(claim.text).toBe("The app can be uninstalled in one click.");
      expect(claim.mechanism).toMatchObject({ key: "github_app_uninstall", issue: 122 });
      expect(claim.mechanism.description).toContain("acme-robotics");
    });

    it("says a token connection can be paused — a different, true claim", () => {
      const claim = reassureClaims(facts())[1];

      expect(claim.text).toBe("The GitHub connection can be paused in one click.");
      expect(claim.mechanism).toMatchObject({ key: "source_pause", path: SOURCES_PATH });
      expect(claim.text).not.toMatch(/app|uninstall/i);
    });

    it("is left out when nothing is connected", () => {
      const claims = reassureClaims(facts({ connection: null }));

      expect(claims.map((claim) => claim.key)).toEqual(["draft_only", "vault"]);
    });
  });

  it("always carries the vault claim — every deployment has the vault", () => {
    const claims = reassureClaims(
      facts({ connection: null, dryRun: { active: false, explicit: true } }),
    );

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      key: "vault",
      text: "Your keys are sealed in the tenant vault and never leave the control plane.",
      mechanism: { key: "vault_envelope_encryption", path: PROVIDERS_PATH },
    });
  });

  it("assembles the strip's line from the claims that hold, and only those", () => {
    expect(smartDefaultsResource(facts()).reassure.line).toBe(
      "Nothing is written to main. The GitHub connection can be paused in one click. " +
        "Your keys are sealed in the tenant vault and never leave the control plane.",
    );
    expect(
      smartDefaultsResource(facts({ connection: null, dryRun: { active: false, explicit: true } }))
        .reassure.line,
    ).toBe("Your keys are sealed in the tenant vault and never leave the control plane.");
  });
});

describe("the payload as a whole", () => {
  it.each([
    ["self-hosted", facts()],
    ["SaaS", SAAS],
    [
      "App-connected, dry-run on",
      facts({
        connection: { kind: "app", login: "acme" },
        dryRun: { active: true, explicit: true },
      }),
    ],
  ])("carries no aggregate statistic — %s (O8)", (_name, deployment) => {
    const text = JSON.stringify(smartDefaultsResource(deployment));

    expect(text).not.toMatch(/\d\s*%/);
    expect(text).not.toMatch(/4m 10s/);
    expect(text).not.toMatch(/average|across teams|of teams/i);
  });

  it("projects the timeline for the picked issue, under the dry-run the launch will run with", () => {
    const { timeline } = smartDefaultsResource(facts());

    expect(timeline.kind).toBe("projected");
    expect(timeline.dryRun).toBe(true);
    expect(timeline.rows[0].text).toBe("loop starts on #488");
    expect(timeline.rows[2].atMinutes).toBe(4);
  });

  it("projects a generic timeline when nothing is picked", () => {
    const { timeline } = smartDefaultsResource(facts({ pick: null }));

    expect(timeline.basis).toBe("none");
    expect(timeline.rows[0].text).toBe("loop starts on your first issue");
  });

  it.each([
    [{ active: true, explicit: true }, true],
    [{ active: false, explicit: false }, true],
    [{ active: false, explicit: true }, false],
  ])("reads dry-run %j at launch as %s", (dryRun, expected) => {
    expect(dryRunAtLaunch(dryRun)).toBe(expected);
  });
});
