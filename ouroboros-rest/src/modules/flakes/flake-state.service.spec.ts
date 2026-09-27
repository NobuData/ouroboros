import { NotFoundError } from "../errors/error.envelope";
import { CANDIDATE_LIMIT } from "./flake-scorer.service";
import { FLAKE_CASE_NOT_FOUND, FlakeStateService } from "./flake-state.service";
import { ScriptedFlakesStore, candidateRow } from "./flakes.store.fixture";

/**
 * The flake state reads (AT.3, #331): one case's state, and the summary that feeds the strip's
 * `watching` count (#335) — with the nightly job's last run, so it is observable from the API.
 */

const KEY = "b".repeat(64);

describe("FlakeStateService.caseState", () => {
  it("is a 404 for a case the workspace never observed", async () => {
    const service = new FlakeStateService(new ScriptedFlakesStore());
    const read = service.caseState("org", KEY);

    await expect(read).rejects.toBeInstanceOf(NotFoundError);
    await expect(read).rejects.toMatchObject({ code: FLAKE_CASE_NOT_FOUND });
  });

  it("is healthy with no score for an observed case never scored", async () => {
    const store = new ScriptedFlakesStore();

    store.cases[KEY] = { caseKey: KEY, githubRepoId: "repo", observed: 2, passOnRetry: 0 };

    await expect(new FlakeStateService(store).caseState("org", KEY)).resolves.toEqual({
      caseKey: KEY,
      githubRepoId: "repo",
      state: "healthy",
      quarantined: false,
      observed: 2,
      passOnRetry: 0,
      score: null,
    });
  });

  it("carries a scored case's score, state and formula", async () => {
    const store = new ScriptedFlakesStore();

    store.cases[KEY] = {
      caseKey: KEY,
      githubRepoId: "repo",
      observed: 4,
      passOnRetry: 2,
      score: {
        score: 0.5028,
        windowRuns: 4,
        state: "watching",
        formulaVersion: 1,
        lastScoredAt: new Date("2026-09-27T03:10:00.000Z"),
        stateChangedAt: new Date("2026-09-26T12:00:00.000Z"),
      },
    };

    await expect(new FlakeStateService(store).caseState("org", KEY)).resolves.toEqual({
      caseKey: KEY,
      githubRepoId: "repo",
      state: "watching",
      quarantined: false,
      observed: 4,
      passOnRetry: 2,
      score: {
        score: 0.5028,
        windowRuns: 4,
        state: "watching",
        formulaVersion: 1,
        lastScoredAt: "2026-09-27T03:10:00.000Z",
        stateChangedAt: "2026-09-26T12:00:00.000Z",
      },
    });
  });

  it("reports a quarantined case distinctly — a soft signal, never hidden", async () => {
    const store = new ScriptedFlakesStore();

    store.cases[KEY] = {
      caseKey: KEY,
      githubRepoId: "repo",
      observed: 4,
      passOnRetry: 2,
      score: {
        score: 0.5,
        windowRuns: 4,
        state: "quarantined",
        formulaVersion: 1,
        lastScoredAt: new Date(0),
        stateChangedAt: new Date(0),
      },
    };

    await expect(new FlakeStateService(store).caseState("org", KEY)).resolves.toMatchObject({
      state: "quarantined",
      quarantined: true,
    });
  });
});

describe("FlakeStateService.summary", () => {
  it("is the watching count, the candidates and the last nightly pass", async () => {
    const store = new ScriptedFlakesStore();

    store.counts = { watching: 1, quarantined: 0 };
    store.candidateRows.org = [candidateRow(KEY, 0.5028)];
    store.latestRun = {
      id: "run-1",
      formulaVersion: 1,
      status: "complete",
      startedAt: new Date("2026-09-27T03:10:00.000Z"),
      finishedAt: new Date("2026-09-27T03:10:01.250Z"),
      durationMs: 1250,
      casesScored: 7,
      stateChanges: 1,
      error: null,
    };

    const summary = await new FlakeStateService(store).summary("org");

    expect(store.calls).toContainEqual(["candidates", "org", CANDIDATE_LIMIT]);
    expect(summary).toEqual({
      formulaVersion: 1,
      watching: 1,
      quarantined: 0,
      candidates: [
        {
          caseKey: KEY,
          githubRepoId: "repo",
          repository: "helios-firmware",
          name: "ring buffer drains under burst",
          classname: "telemetry",
          suite: "telemetry integration",
          score: 0.5028,
          windowRuns: 4,
          state: "watching",
          formulaVersion: 1,
          lastScoredAt: "2026-09-27T03:10:00.000Z",
          stateChangedAt: "2026-09-26T12:00:00.000Z",
        },
      ],
      lastRun: {
        id: "run-1",
        formulaVersion: 1,
        status: "complete",
        startedAt: "2026-09-27T03:10:00.000Z",
        finishedAt: "2026-09-27T03:10:01.250Z",
        durationMs: 1250,
        casesScored: 7,
        stateChanges: 1,
        error: null,
      },
    });
  });

  it("has a null last run before the first night", async () => {
    await expect(new FlakeStateService(new ScriptedFlakesStore()).summary("org")).resolves.toEqual({
      formulaVersion: 1,
      watching: 0,
      quarantined: 0,
      candidates: [],
      lastRun: null,
    });
  });
});
