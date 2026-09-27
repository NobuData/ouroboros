import type { AppConfigService } from "../config/config.service";
import { CANDIDATE_LIMIT, FlakeScorerService, failureMessage } from "./flake-scorer.service";
import { ScriptedFlakesStore, candidateRow } from "./flakes.store.fixture";

/**
 * The flake scorer's orchestration (AT.3, #331): the parse-time half stamps the current formula,
 * and the nightly pass is bounded, observable and survives one workspace's failure. The formula
 * itself is V054's, and `flakes.integration-spec.ts` checks it.
 */

/**
 * A scorer over a scripted store.
 *
 * @param cap - The nightly cap.
 * @returns The scorer and its store.
 */
function harness(cap = 2000) {
  const store = new ScriptedFlakesStore();
  const config = { flakeRescoreCap: cap } as unknown as AppConfigService;

  return { store, scorer: new FlakeScorerService(store, config) };
}

describe("FlakeScorerService.scoreAttempt", () => {
  it("scores the attempt under the latest formula and says which", async () => {
    const { store, scorer } = harness();

    store.formula = 2;
    store.totals.org = { scored: 3, stateChanges: 1 };

    await expect(scorer.scoreAttempt("org", "t3")).resolves.toEqual({
      scored: 3,
      stateChanges: 1,
      formulaVersion: 2,
    });
    expect(store.calls).toEqual([["scoreAttempt", "org", "t3", 2]]);
  });
});

describe("FlakeScorerService.rescoreAll", () => {
  it("does nothing, and records nothing, when no workspace has an active case", async () => {
    const { store, scorer } = harness();

    await expect(scorer.rescoreAll()).resolves.toEqual({
      formulaVersion: 1,
      cap: 2000,
      workspaces: [],
    });
    expect(store.calls).toEqual([["workspacesToRescore", 1]]);
  });

  it("re-scores each workspace under the cap, bracketed by its bookkeeping row", async () => {
    const { store, scorer } = harness(25);

    store.workspaces = ["org-a", "org-b"];
    store.totals = {
      "org-a": { scored: 25, stateChanges: 2 },
      "org-b": { scored: 1, stateChanges: 0 },
    };
    store.candidateRows = { "org-a": [candidateRow("a".repeat(64), 0.5028)] };

    const report = await scorer.rescoreAll();

    expect(store.calls).toEqual([
      ["workspacesToRescore", 1],
      ["startRun", "org-a", 1],
      ["rescoreActive", "org-a", 1, 25],
      ["candidates", "org-a", CANDIDATE_LIMIT],
      ["finishRun", "run-org-a", { scored: 25, stateChanges: 2 }],
      ["startRun", "org-b", 1],
      ["rescoreActive", "org-b", 1, 25],
      ["candidates", "org-b", CANDIDATE_LIMIT],
      ["finishRun", "run-org-b", { scored: 1, stateChanges: 0 }],
    ]);
    expect(report.cap).toBe(25);
    expect(report.workspaces).toEqual([
      {
        organizationId: "org-a",
        runId: "run-org-a",
        status: "complete",
        casesScored: 25,
        stateChanges: 2,
        candidates: [candidateRow("a".repeat(64), 0.5028)],
      },
      {
        organizationId: "org-b",
        runId: "run-org-b",
        status: "complete",
        casesScored: 1,
        stateChanges: 0,
        candidates: [],
      },
    ]);
  });

  it("records a workspace's failure on its row and moves on to the next", async () => {
    const { store, scorer } = harness();

    store.workspaces = ["org-a", "org-b"];
    store.totals = { "org-a": new Error("canceling statement due to statement timeout") };

    const report = await scorer.rescoreAll();

    expect(store.calls).toContainEqual([
      "failRun",
      "run-org-a",
      "Error: canceling statement due to statement timeout",
    ]);
    expect(store.calls).toContainEqual(["finishRun", "run-org-b", { scored: 0, stateChanges: 0 }]);
    expect(report.workspaces.map((w) => [w.organizationId, w.status])).toEqual([
      ["org-a", "error"],
      ["org-b", "complete"],
    ]);
    expect(report.workspaces[0]).toMatchObject({
      casesScored: 0,
      candidates: [],
      error: "Error: canceling statement due to statement timeout",
    });
  });
});

describe("failureMessage", () => {
  it("is the error's one-line name and message", () => {
    expect(failureMessage(new TypeError("bad\n  thing"))).toBe("TypeError: bad thing");
  });

  it("is never blank — V054 refuses a blank error", () => {
    expect(failureMessage("   ")).toBe("the re-score failed without a message");
    expect(failureMessage(undefined)).toBe("undefined");
  });
});
