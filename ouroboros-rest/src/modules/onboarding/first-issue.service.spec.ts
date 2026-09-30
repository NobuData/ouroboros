/**
 * The safe-first-issue picker's states ([#387](https://github.com/NobuData/ouroboros/issues/387),
 * BB.4): the seeded pick, the cold states answered honestly, nothing picked below the bar, and
 * the alternatives ranked with their own reasoning.
 */

import type { AppConfigService } from "../config/config.service";
import type { BacklogHealthRepository, LastRunRow } from "../planning/health.repository";
import { candidate, NOW, SEEDED_BACKLOG, SEEDED_CANDIDATES } from "./first-issue.fixture";
import type { BacklogCounts, CandidateRow, FirstIssueRepository } from "./first-issue.repository";
import { PLANNING_PATH } from "./first-issue.resources";
import { SAFETY_WEIGHTS } from "./first-issue.score";
import { DEFAULT_ALTERNATIVES_LIMIT, FirstIssueService, stateOf } from "./first-issue.service";
import type { OnboardingRepository } from "./onboarding.repository";

const WORKSPACE = "org-1";
const REPO = "Acme-Robotics/Helios-Firmware";
const REF = "acme-robotics/helios-firmware";
const CONFIG = {
  reestimationHourUtc: 2,
  reestimationJitterMinutes: 30,
  reestimationBatch: 200,
} as AppConfigService;
const LAST_RUN: LastRunRow = {
  startedAt: new Date("2026-09-29T02:14:00.000Z"),
  finishedAt: null,
  status: "running",
  found: 4,
  queued: 4,
  inFlight: 0,
};

/** Everything the service is built from. */
function harness(
  options: {
    backlog?: BacklogCounts;
    rows?: readonly CandidateRow[];
    globs?: string[];
    mirrored?: boolean;
    lastRun?: LastRunRow;
  } = {},
) {
  const picker = {
    backlog: jest.fn().mockResolvedValue(options.backlog ?? SEEDED_BACKLOG),
    candidates: jest.fn().mockResolvedValue(options.rows ?? SEEDED_CANDIDATES),
    protectedPaths: jest.fn().mockResolvedValue(options.globs ?? []),
  } as unknown as jest.Mocked<FirstIssueRepository>;
  const onboarding = {
    repository: jest
      .fn()
      .mockResolvedValue(
        options.mirrored === false
          ? undefined
          : { id: "repo-1", enabled: true, account_enabled: true },
      ),
  } as unknown as jest.Mocked<OnboardingRepository>;
  const health = {
    lastRun: jest.fn().mockResolvedValue(options.lastRun),
  } as unknown as jest.Mocked<BacklogHealthRepository>;
  const service = new FirstIssueService(picker, onboarding, health, CONFIG);

  return { service, picker, onboarding, health };
}

describe("the safe-first-issue picker", () => {
  describe("the pick", () => {
    it("picks #488 from the seeded backlog with the mockup's line and no cost", async () => {
      const { service, picker, onboarding } = harness();

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(onboarding.repository).toHaveBeenCalledWith(
        WORKSPACE,
        "acme-robotics",
        "helios-firmware",
      );
      expect(picker.candidates).toHaveBeenCalledWith(WORKSPACE, "repo-1");
      expect(picker.protectedPaths).toHaveBeenCalledWith(WORKSPACE, REF);
      expect(card).toMatchObject({
        repo: REF,
        state: "picked",
        weightsVersion: "safety-v1",
        safetyBar: SAFETY_WEIGHTS.safetyBar,
        backlog: SEEDED_BACKLOG,
        planning: null,
        excluded: { protectedPath: 0, tooLarge: 2, belowBar: 3 },
      });
      expect(card.pick).toMatchObject({
        number: 488,
        title: "Typo sweep in operator manual + pairing guide",
        effort: "xs",
        suggestedWorkflow: "docs-loop",
        clearsBar: true,
        estimate: { version: 1, cycleMin: 3, cycleMax: 6, loopMinutes: 4, estTokens: 25000 },
        reasoning: { line: "no code paths touched · est. 4 min" },
      });
      expect(card.pick).not.toHaveProperty("cost");
      expect(card.pick?.reasoning.components.map((c) => c.key)).toEqual([
        "effort",
        "workflow",
        "paths",
        "freshness",
      ]);
    });

    it("passes the estimator's status through while seeded issues still wait to be sized", async () => {
      const { service, health } = harness({ lastRun: LAST_RUN });

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(health.lastRun).toHaveBeenCalledWith(WORKSPACE);
      expect(card.estimator).toEqual({
        schedule: { hourUtc: 2, jitterMinutes: 30, batchLimit: 200 },
        lastRun: {
          startedAt: "2026-09-29T02:14:00.000Z",
          finishedAt: null,
          status: "running",
          found: 4,
          queued: 4,
          inFlight: 0,
        },
      });
    });

    it("carries the cost when the pick's model is priced", async () => {
      const priced = candidate({ price: { billingMode: "token", inputCentsPer1m: "120" } });
      const { service } = harness({ rows: [priced] });

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(card.pick?.cost).toEqual({ cents: 3, display: "$0.03" });
      expect(card.pick?.reasoning.line).toBe("no code paths touched · est. 4 min · est. $0.03");
    });

    it("never picks a candidate touching a protected path, even the best one", async () => {
      const { service } = harness({
        rows: [candidate({ files: ["keys/dev.pem"] }), SEEDED_CANDIDATES[6]],
        globs: ["boot/**", "keys/**"],
      });

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(card.pick?.number).toBe(491);
      expect(card.excluded.protectedPath).toBe(1);
    });
  });

  describe("cold states", () => {
    it("answers an unsized backlog with the nightly job's real status, not an empty pick", async () => {
      const { service } = harness({
        backlog: { open: 4, sized: 0, sizing: 4, needsHuman: 0 },
        rows: [],
        lastRun: LAST_RUN,
      });

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(card.state).toBe("sizing");
      expect(card.pick).toBeNull();
      expect(card.estimator?.lastRun?.status).toBe("running");
      expect(card.planning).toBeNull();
    });

    it("says the job has never run rather than inventing a run", async () => {
      const { service } = harness({
        backlog: { open: 2, sized: 0, sizing: 2, needsHuman: 0 },
        rows: [],
      });

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(card.state).toBe("sizing");
      expect(card.estimator?.lastRun).toBeNull();
    });

    it("points an empty backlog at planning", async () => {
      const { service, health } = harness({
        backlog: { open: 0, sized: 0, sizing: 0, needsHuman: 0 },
        rows: [],
      });

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(card).toMatchObject({
        state: "empty",
        pick: null,
        estimator: null,
        planning: { path: PLANNING_PATH },
      });
      expect(health.lastRun).not.toHaveBeenCalled();
    });

    it("treats a repository the workspace does not mirror as empty, without reading further", async () => {
      const { service, picker } = harness({ mirrored: false });

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(card.state).toBe("empty");
      expect(picker.candidates).not.toHaveBeenCalled();
      expect(picker.backlog).not.toHaveBeenCalled();
    });

    it("says nothing is safe enough instead of returning the least-bad candidate", async () => {
      const { service } = harness({
        backlog: { open: 3, sized: 3, sizing: 0, needsHuman: 0 },
        rows: [SEEDED_CANDIDATES[0], SEEDED_CANDIDATES[1], SEEDED_CANDIDATES[2]],
      });

      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(card).toMatchObject({
        state: "none_safe",
        pick: null,
        estimator: null,
        excluded: { protectedPath: 0, tooLarge: 1, belowBar: 2 },
      });
    });
  });

  describe("alternatives", () => {
    it("ranks every qualifying candidate, each with its own reasoning", async () => {
      const { service } = harness();

      const alternatives = await service.alternatives(WORKSPACE, REPO, undefined, NOW);

      expect(alternatives.candidates.map((c) => c.number)).toEqual([488, 491, 485, 489, 484]);
      expect(alternatives.candidates.map((c) => c.clearsBar)).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
      expect(alternatives.candidates[1].reasoning.line).toBe("2 code paths touched · est. 11 min");
      expect(alternatives.excluded).toEqual({ protectedPath: 0, tooLarge: 2, belowBar: 3 });
      expect(alternatives.weightsVersion).toBe("safety-v1");
    });

    it("honours the limit, safest first", async () => {
      const { service } = harness();

      const alternatives = await service.alternatives(WORKSPACE, REPO, 2, NOW);

      expect(alternatives.candidates.map((c) => c.number)).toEqual([488, 491]);
      expect(DEFAULT_ALTERNATIVES_LIMIT).toBe(10);
    });

    it("follows a weight change", async () => {
      const { service } = harness();
      service.weights = { ...SAFETY_WEIGHTS, effort: { xs: 0, s: 60, m: 5 } };

      const alternatives = await service.alternatives(WORKSPACE, REPO, undefined, NOW);
      const card = await service.pick(WORKSPACE, REPO, NOW);

      expect(alternatives.candidates.map((c) => c.number)).toEqual([491, 488, 485, 489, 484]);
      expect(card.pick?.number).toBe(491);
    });
  });

  describe("stateOf", () => {
    it("calls a backlog of needs-human issues and nothing else none_safe, not sizing", () => {
      expect(stateOf({ open: 1, sized: 0, sizing: 0, needsHuman: 1 }, null)).toBe("none_safe");
    });

    it("calls a partly sized backlog with nothing safe none_safe", () => {
      expect(stateOf({ open: 3, sized: 1, sizing: 2, needsHuman: 0 }, null)).toBe("none_safe");
    });
  });
});
