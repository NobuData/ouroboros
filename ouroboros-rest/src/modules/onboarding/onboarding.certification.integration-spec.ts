/**
 * **The picker, the page's statistics and the deployment's promises, certified** — BB.6
 * ([#389](https://github.com/NobuData/ouroboros/issues/389)).
 *
 * Three of mockup 13's cards make claims a refactor can quietly falsify, and each is held here
 * against real rows and a real request:
 *
 *   * **The picker** (BB.4) — a weight change reorders the *same* seeded backlog; a backlog with
 *     nothing safe enough answers `none_safe` and never its least-bad candidate; an unpriced
 *     model carries no cost anywhere in the ranking.
 *   * **The caption statistic scan** (decision **O8**) — no tile, in any state the wizard can
 *     serve it, carries a digit or a percent sign; the database refuses to store the mockup's
 *     invented caption; and no onboarding payload states an aggregate across teams. The scan is
 *     first run against the mockup's own two invented lines, so it is known to fail on them.
 *   * **Deployment variants** (decision **O6**) — one workspace read under three deployments:
 *     self-hosted has no managed-pool row at all, a SaaS-flagged one has them, and a trial credit
 *     prints only where the deployment declared a figure.
 *
 * **Mutation checks** (run for #389):
 *   * `FirstIssueService.pick` answering `ranked[0]` whatever its bar → *answers none_safe* red.
 *   * a tile served with the mockup's `92% of teams start here` as its caption → all three
 *     scan cases red.
 *   * `modelsRow` ignoring the capability flag → both SaaS-flagged deployment cases red.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/onboarding/onboarding.certification
 * ```
 */

import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { DefaultRowResource, SmartDefaultsResource } from "./defaults.resources";
import type { FirstIssueAlternativesResource, FirstIssueResource } from "./first-issue.resources";
import { SAFETY_WEIGHTS, type SafetyWeights } from "./first-issue.score";
import { FirstIssueService } from "./first-issue.service";
import type { LaunchReceiptResource } from "./launch.resources";
import {
  inWorkspace,
  launchFirstLoop,
  pickIssue,
  selectTemplate,
  shipTemplates,
  wizardBench,
  wizardRoute,
  type WizardBench,
} from "./onboarding.integration.fixture";
import {
  FABRICATED_STATISTIC,
  type TemplateTileResource,
  type TemplateTilesResource,
} from "./templates.resources";

/** Mockup 13's two invented lines — the statistics decision O8 removed from the page. */
const MOCKUP_FABRICATIONS = ["92% of teams start here", "average first-loop time 4m 10s"];

/**
 * The shapes a cross-tenant aggregate takes in a sentence: a share *of* something, teams as a
 * population, an average, or a measured duration. A workspace's own figures — `est. 4 min`,
 * `3 of 10 merged loops`, a language's share of a repository — match none of them.
 */
const AGGREGATE_CLAIMS: readonly RegExp[] = [
  /\d\s*%\s+of\b/i,
  /\b(of|most|other|across) teams\b/i,
  /\bteams (start|choose|pick|use)\b/i,
  /\b(on )?average\b/i,
  /\b\d+m \d+s\b/,
];

/**
 * Every string anywhere in a payload that states an aggregate across teams.
 *
 * @param payload - Any JSON value.
 * @returns The offending strings; empty when the payload states none.
 */
function aggregateClaims(payload: unknown): string[] {
  if (typeof payload === "string") {
    return AGGREGATE_CLAIMS.some((shape) => shape.test(payload)) ? [payload] : [];
  }

  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  return Object.values(payload).flatMap(aggregateClaims);
}

/**
 * The tiles whose caption carries the shape of a statistic.
 *
 * @param tiles - Step 3's tiles.
 * @returns `slug: caption` for each offender; empty when every caption is qualitative.
 */
function statisticCaptions(tiles: readonly Pick<TemplateTileResource, "slug" | "caption">[]) {
  return tiles
    .filter((tile) => tile.caption !== null && FABRICATED_STATISTIC.test(tile.caption))
    .map((tile) => `${tile.slug}: ${String(tile.caption)}`);
}

describe("the onboarding page's claims", () => {
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

  afterAll(async () => {
    await shipTemplates(api);
    await api.close();
    await engine.stop();
  });

  beforeEach(async () => {
    engine.reset();
    await shipTemplates(api);
  });

  afterEach(() => api.truncate());

  /** `GET` an onboarding route of the bench's repository on a harness. */
  async function get<T>(at: WizardBench, tail: string, on: ApiHarness = api): Promise<T> {
    const response = await inWorkspace(
      on,
      at.owner,
      at.workspace,
    )("get", wizardRoute(at.repo, tail)).expect(200);

    return bodyOf<T>(response);
  }

  describe("the safe-first-issue picker", () => {
    /** The ranking, safest first. */
    async function ranking(at: WizardBench): Promise<FirstIssueAlternativesResource> {
      return get<FirstIssueAlternativesResource>(at, "/first-issue/alternatives");
    }

    /**
     * Run a case under other weights, restoring the shipped ones however it ends.
     *
     * @param weights - The weights in force for the case.
     * @param run - The case.
     */
    async function under(weights: SafetyWeights, run: () => Promise<void>): Promise<void> {
      const picker = api.nest.get(FirstIssueService);

      picker.weights = weights;

      try {
        await run();
      } finally {
        picker.weights = SAFETY_WEIGHTS;
      }
    }

    it("reorders the same backlog when a weight changes, and names the weights that did it", async () => {
      const at = await wizardBench(api);
      const shipped = await ranking(at);

      expect(shipped.weightsVersion).toBe("safety-v1");
      expect(shipped.candidates.map((candidate) => candidate.number)).toEqual([
        488, 491, 485, 489, 484,
      ]);

      // Size S now outscores XS: #491 (S, two code paths) overtakes #488 (XS, docs only).
      await under(
        { ...SAFETY_WEIGHTS, version: "safety-s-first", effort: { xs: 0, s: 60, m: 5 } },
        async () => {
          const reweighted = await ranking(at);
          const card = await get<FirstIssueResource>(at, "/first-issue");

          expect(reweighted.weightsVersion).toBe("safety-s-first");
          expect(reweighted.candidates.map((candidate) => candidate.number)).toEqual([
            491, 488, 485, 489, 484,
          ]);
          expect(card).toMatchObject({
            state: "picked",
            weightsVersion: "safety-s-first",
            pick: { number: 491 },
          });
        },
      );

      // The shipped weights are back, and so is the mockup's pick.
      expect((await get<FirstIssueResource>(at, "/first-issue")).pick?.number).toBe(488);
    });

    it("moves the bar without moving the order: a higher bar leaves #488 the only safe pick", async () => {
      const at = await wizardBench(api);

      await under({ ...SAFETY_WEIGHTS, safetyBar: 60 }, async () => {
        const reweighted = await ranking(at);

        expect(reweighted.safetyBar).toBe(60);
        expect(reweighted.candidates.map((c) => [c.number, c.clearsBar])).toEqual([
          [488, true],
          [491, false],
          [485, false],
          [489, false],
          [484, false],
        ]);
        expect(reweighted.excluded.belowBar).toBe(4);
      });
    });

    it("answers none_safe — never the least-bad candidate — when nothing clears the bar", async () => {
      const at = await wizardBench(api);

      // The two issues that clear the bar are closed: three sized candidates remain, all below it.
      await api.sql.query(
        `update ${SCHEMA_NAME}.github_issues set state = 'closed'
          where organization_id = $1 and number in (488, 491)`,
        [at.workspace.id],
      );

      const card = await get<FirstIssueResource>(at, "/first-issue");
      const alternatives = await ranking(at);

      expect(card).toMatchObject({
        state: "none_safe",
        pick: null,
        planning: null,
        backlog: { open: 7, sized: 5, sizing: 1, needsHuman: 1 },
        excluded: { protectedPath: 0, tooLarge: 2, belowBar: 3 },
      });
      // One issue is still being sized, so the card says more may be coming.
      expect(card.estimator).not.toBeNull();
      // "Or pick your own" still lists them — each marked as not clearing the bar.
      expect(alternatives.candidates.map((c) => [c.number, c.clearsBar])).toEqual([
        [485, false],
        [489, false],
        [484, false],
      ]);
    });

    it("carries no cost anywhere in the ranking while nothing prices the routed models", async () => {
      const at = await wizardBench(api);

      const { candidates } = await ranking(at);

      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        expect(candidate).not.toHaveProperty("cost");
        expect(candidate.reasoning.line).not.toContain("$");
      }
    });
  });

  describe("the caption statistic scan (O8)", () => {
    it("fails on the mockup's own invented lines — the scan has teeth", () => {
      expect(statisticCaptions([{ slug: "quick-fixes", caption: MOCKUP_FABRICATIONS[0] }])).toEqual(
        [`quick-fixes: ${MOCKUP_FABRICATIONS[0]}`],
      );
      expect(aggregateClaims({ tiles: [{ caption: MOCKUP_FABRICATIONS[0] }] })).toEqual([
        MOCKUP_FABRICATIONS[0],
      ]);
      expect(aggregateClaims({ timeline: { note: MOCKUP_FABRICATIONS[1] } })).toEqual([
        MOCKUP_FABRICATIONS[1],
      ]);
      // …and passes on a workspace's own figures, which are not aggregates.
      expect(
        aggregateClaims([
          "no code paths touched · est. 4 min",
          "3 of 10 merged loops",
          "C 92% · Zephyr RTOS 4.1",
        ]),
      ).toEqual([]);
    });

    it("finds no statistic in any tile's caption, in every state the wizard serves a tile", async () => {
      const at = await wizardBench(api);
      const fresh = await get<TemplateTilesResource>(at, "/templates");

      // Not vacuous: the shipped tiles do carry captions.
      expect(fresh.tiles).toHaveLength(4);
      expect(fresh.tiles.some((tile) => tile.caption !== null)).toBe(true);
      expect(statisticCaptions(fresh.tiles)).toEqual([]);

      // Selected and instantiated; and the advanced tile, locked with its real progress.
      await selectTemplate(api, at).expect(200);

      const selected = await get<TemplateTilesResource>(at, "/templates");

      expect(selected.tiles.find((tile) => tile.selected)?.workflow).not.toBeNull();
      expect(selected.tiles.find((tile) => tile.unlock?.locked === true)?.slug).toBe(
        "deep-refactor",
      );
      expect(statisticCaptions(selected.tiles)).toEqual([]);

      // An organization's own override of a tile is held to the same rule.
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.workflow_templates
                (organization_id, slug, version, name, description, stage_dots, effort_range,
                 caption, definition, tier, unlock_rule, sort_order)
         select $1, slug, 1, name, description, stage_dots, effort_range, 'our house default',
                definition, tier, unlock_rule, sort_order
           from ${SCHEMA_NAME}.workflow_templates
          where organization_id is null and slug = 'docs-chores'`,
        [at.workspace.id],
      );

      const overridden = await get<TemplateTilesResource>(at, "/templates");

      expect(overridden.tiles.find((tile) => tile.slug === "docs-chores")).toMatchObject({
        scope: "organization",
        caption: "our house default",
      });
      expect(statisticCaptions(overridden.tiles)).toEqual([]);
    });

    it("cannot be handed a fabricated caption: the database refuses to store one", async () => {
      const at = await wizardBench(api);
      const fabricated = (caption: string) =>
        api.sql.query(
          `insert into ${SCHEMA_NAME}.workflow_templates
                  (organization_id, slug, version, name, description, stage_dots, effort_range,
                   caption, definition, tier, unlock_rule, sort_order)
           select $1, slug, 1, name, description, stage_dots, effort_range, $2, definition, tier,
                  unlock_rule, sort_order
             from ${SCHEMA_NAME}.workflow_templates
            where organization_id is null and slug = 'quick-fixes'`,
          [at.workspace.id, caption],
        );

      await expect(fabricated(MOCKUP_FABRICATIONS[0])).rejects.toMatchObject({
        constraint: "workflow_templates_caption_qualitative",
      });
      await expect(fabricated("chosen by 9 in 10 workspaces")).rejects.toMatchObject({
        constraint: "workflow_templates_caption_qualitative",
      });
      expect(statisticCaptions((await get<TemplateTilesResource>(at, "/templates")).tiles)).toEqual(
        [],
      );
    });

    it("states no aggregate across teams in any payload of the page, before or after launch", async () => {
      const at = await wizardBench(api);

      await selectTemplate(api, at).expect(200);
      await pickIssue(api, at).expect(200);

      const before = [
        await get<unknown>(at, ""),
        await get<unknown>(at, "/templates"),
        await get<unknown>(at, "/first-issue"),
        await get<unknown>(at, "/first-issue/alternatives"),
        await get<unknown>(at, "/defaults"),
      ];
      const receipt = bodyOf<LaunchReceiptResource>(await launchFirstLoop(api, at).expect(200));

      expect(before.flatMap(aggregateClaims)).toEqual([]);
      expect(aggregateClaims(receipt)).toEqual([]);
      expect(aggregateClaims(await get<unknown>(at, "/defaults"))).toEqual([]);
    });
  });

  describe("deployment variants (O6)", () => {
    let saas: ApiHarness;
    let keysOnly: ApiHarness;

    beforeAll(async () => {
      saas = await ApiHarness.start({
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
        OURO_MANAGED_KEY_POOL: "true",
        OURO_HOSTED_RUNNER_POOL: "true",
        OURO_MANAGED_KEY_TRIAL_CENTS: "500",
      });
      keysOnly = await ApiHarness.start({
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
        OURO_MANAGED_KEY_POOL: "true",
      });
    });

    afterAll(async () => {
      await saas.close();
      await keysOnly.close();
    });

    /** The right column of one bench, as a deployment serves it. */
    function defaults(at: WizardBench, on: ApiHarness): Promise<SmartDefaultsResource> {
      return get<SmartDefaultsResource>(at, "/defaults", on);
    }

    /** A row's variant and sentence. */
    function summary(rows: readonly DefaultRowResource[]): [string, string][] {
      return rows.map((row) => [row.variant, row.text]);
    }

    it("promises a self-hosted deployment no managed-pool row at all", async () => {
      const at = await wizardBench(api);

      const payload = await defaults(at, api);

      expect(payload).toMatchObject({
        deployment: "self_hosted",
        capabilities: { managedKeyPool: false, hostedRunnerPool: false },
      });
      expect(summary(payload.rows)).toEqual([
        ["bring_your_own_keys", "Models: bring your own keys"],
        ["enroll_runner", "Build: enroll a runner"],
        ["nightly_estimator", "Estimator pre-sizes your backlog overnight"],
        ["slack_future", "Slack: connect after your first PR (optional)"],
      ]);
      expect(payload.rows.some((row) => "trialCredit" in row)).toBe(false);
      expect(JSON.stringify(payload)).not.toMatch(/managed keys|hosted runner|trial|\$/i);
    });

    it("gives a SaaS-flagged deployment the managed rows, for the same workspace", async () => {
      const at = await wizardBench(api);

      const payload = await defaults(at, saas);
      const selfHosted = await defaults(at, api);

      expect(payload).toMatchObject({
        deployment: "saas",
        capabilities: { managedKeyPool: true, hostedRunnerPool: true },
      });
      expect(summary(payload.rows)).toEqual([
        ["managed_keys", "Models: managed keys with $5 trial credit"],
        ["hosted_runner", "Build: hosted runner for your first loops"],
        ["nightly_estimator", "Estimator pre-sizes your backlog overnight"],
        ["slack_future", "Slack: connect after your first PR (optional)"],
      ]);
      expect(payload.rows[0].trialCredit).toEqual({ cents: 500, display: "$5" });
      // Only the deployment differs: the workspace's own claims and projection are the same.
      expect(payload.reassure).toEqual(selfHosted.reassure);
      expect(payload.timeline).toEqual(selfHosted.timeline);
    });

    it("prints no trial figure a deployment did not declare, and selects each row on its own flag", async () => {
      const at = await wizardBench(api);

      const payload = await defaults(at, keysOnly);

      expect(payload).toMatchObject({
        deployment: "saas",
        capabilities: { managedKeyPool: true, hostedRunnerPool: false },
      });
      expect(summary(payload.rows).slice(0, 2)).toEqual([
        ["managed_keys", "Models: managed keys"],
        ["enroll_runner", "Build: enroll a runner"],
      ]);
      expect(payload.rows[0]).not.toHaveProperty("trialCredit");
      expect(JSON.stringify(payload)).not.toMatch(/trial|\$/i);
    });

    it("refuses to boot a deployment that declares a trial credit on a pool it does not run", async () => {
      await expect(ApiHarness.start({ OURO_MANAGED_KEY_TRIAL_CENTS: "500" })).rejects.toThrow(
        /OURO_MANAGED_KEY_TRIAL_CENTS/,
      );
    });
  });
});
