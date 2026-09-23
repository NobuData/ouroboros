import type request from "supertest";

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { readMockup, type MockupRun } from "./console.mockup.fixture";
import type { RunConsoleResource, RunEventsPage } from "./console.resources";
import { seedConsole, type SeededConsole } from "./console.seed.fixture";

/**
 * **The console against its design source** — AP.6
 * ([#308](https://github.com/NobuData/ouroboros/issues/308)).
 *
 * > Fixtures derive from the mockup's values, so a drift from the design source is a test
 * > failure.
 *
 * `console.integration-spec.ts` asserts the seeded `#482` against literals copied from mockup 10.
 * This suite asserts the same page against values **parsed out of
 * `docs/mockups/10-run-detail.html` at test time** (`console.mockup.fixture.ts`), so the page, the
 * seed and the mockup are three things that have to agree — an edit to any one of them that the
 * other two do not follow turns this red.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/**
 * **The one place the seed and mockup 10 knowingly disagree** — the stepper from the active
 * node on.
 *
 * Run `#482` is drawn by two mockups. Mockup 01's dashboard card prints `Implementing · 4/6`, and
 * `R__dev_seed_dashboard.sql` writes the run's stage history to match it: six stages, labelled
 * `Implementing`, `Build farm`, `Self-review`. Mockup 10's stepper draws eight, labelled
 * `Implement` … `Open PR`. The seed cannot satisfy both, and the dashboard suite asserts the
 * first.
 *
 * Pinned here in both directions rather than skipped: an edit to either side changes one of these
 * lists and fails the suite, so the disagreement stays the one that was reviewed and never
 * quietly grows. Reconciling the two mockups is a design decision, not this suite's.
 */
const STEPPER_DIVERGENCE = {
  mockup: ["Implement", "Build", "Test", "Review", "Open PR"],
  seed: ["Implementing", "Build farm", "Self-review"],
} as const;

describe("the run console against mockup 10", () => {
  let api: ApiHarness;
  let mockup: MockupRun;

  beforeAll(async () => {
    api = await ApiHarness.start();
    mockup = readMockup();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Read as somebody, in the seeded workspace. */
  function read(seeded: SeededConsole, person: Person, suffix: string): request.Test {
    return api
      .as(person)("get", `/api/v1/runs/${seeded.runId}${suffix}`)
      .set(TENANT_HEADER, seeded.workspace.slug);
  }

  it("draws the page head, stepper and three cards the mockup draws", async () => {
    const seeded = await seedConsole(api);
    const page = bodyOf<RunConsoleResource>(await read(seeded, seeded.owner, "").expect(200));

    // --- page head --------------------------------------------------------------------------
    expect(page.head.loopSeq).toBe(mockup.loopSeq);
    expect(page.run.issueNumber).toBe(mockup.issueNumber);
    expect(page.run.issueTitle).toBe(mockup.issueTitle);
    expect(page.run.status).toBe(mockup.status);
    expect(page.run.workflowTag).toBe(mockup.workflowTag);
    expect(page.head.workflowVersion).toBe(mockup.workflowVersion);
    expect(page.run.model).toBe(mockup.model);
    expect(page.head.branchName).toBe(mockup.branchName);
    // Measured to `asOf`, so it is at least the mockup's and within a slow CI minute or two.
    expect(page.resources.wallClock.elapsedSeconds).toBeGreaterThanOrEqual(mockup.elapsedSeconds);
    expect(page.resources.wallClock.elapsedSeconds).toBeLessThan(mockup.elapsedSeconds + 120);

    // --- stepper ----------------------------------------------------------------------------
    // Up to and including the active node, the seed and the mockup agree node for node.
    const active = mockup.stages.findIndex((stage) => stage.state === "active");
    const stages = page.timeline.stages;

    mockup.stages.slice(0, active + 1).forEach((expected, index) => {
      const stage = stages[index];
      const status = expected.state === "done" ? "succeeded" : "active";

      expect(`${expected.label}: ${stage.status}`).toBe(`${expected.label}: ${status}`);

      if (expected.durationSeconds !== undefined) {
        expect(`${expected.label}: ${stage.label} ${String(stage.durationSeconds)}`).toBe(
          `${expected.label}: ${expected.label} ${String(expected.durationSeconds)}`,
        );
      }

      if (expected.attempt !== undefined) {
        expect(stage).toMatchObject({
          attempt: expected.attempt.current,
          maxAttempts: expected.attempt.max,
        });
      }

      if (expected.note !== undefined) {
        expect(stage.note).toBe(expected.note);
      }
    });

    // From the active node on, the labels are the one known divergence, pinned both ways.
    expect(mockup.stages.slice(active).map((stage) => stage.label)).toEqual(
      STEPPER_DIVERGENCE.mockup,
    );
    expect(stages.slice(active).map((stage) => stage.label)).toEqual(STEPPER_DIVERGENCE.seed);
    expect(stages.slice(active + 1).every((stage) => stage.status === "pending")).toBe(true);
    expect(mockup.stages.slice(active + 1).every((stage) => stage.state === "pending")).toBe(true);

    // --- changes ----------------------------------------------------------------------------
    expect(
      page.changes.files.map(({ path, additions, deletions }) => ({ path, additions, deletions })),
    ).toEqual(mockup.files);
    expect(page.changes.commits.map(({ shortSha, subject }) => ({ shortSha, subject }))).toEqual(
      mockup.commits,
    );
    expect(page.changes.mergeStrategy).toBe(mockup.mergeStrategy);

    // --- resources --------------------------------------------------------------------------
    // The mockup rounds to the thousand (`212k`), so the page is held to the same rounding.
    expect(Math.round(page.resources.tokens.used / 1000) * 1000).toBe(mockup.tokens.used);
    expect(page.resources.tokens.budget).toBe(mockup.tokens.budget);
    expect(Math.round(Number(page.resources.cost.costCents))).toBe(mockup.cost.costCents);
    expect(page.resources.cost.capCents).toBe(mockup.cost.capCents);
    expect(page.resources.farm?.runnerName).toBe(mockup.farmRunner);

    // --- guardrails -------------------------------------------------------------------------
    expect(page.guardrails.status).toBe(mockup.guardrailStatus);
    expect(page.guardrails.checks.map(({ check, verdict }) => ({ check, verdict }))).toEqual(
      mockup.guardrails,
    );
    expect(page.guardrails.policy).toEqual(mockup.policy);
  });

  it("types the transcript the way the mockup's chips read", async () => {
    const seeded = await seedConsole(api);
    const page = bodyOf<RunEventsPage>(await read(seeded, seeded.owner, "/events").expect(200));

    expect(
      page.entries.map((entry) => ({
        actor: entry.actor,
        ...(entry.actor === "model" && entry.modelId !== undefined
          ? { modelId: entry.modelId }
          : {}),
        ...(entry.actor === "tool" && entry.toolTag !== undefined
          ? { toolTag: entry.toolTag }
          : {}),
      })),
    ).toEqual(mockup.transcript);
  });
});
