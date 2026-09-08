import { GITHUB_FAILURES, GITHUB_MESSAGES } from "../github/github.errors";
import {
  SYNC_NO_REPOSITORIES,
  SYNC_PAUSES,
  SYNC_PAUSE_MESSAGES,
  cycleTotals,
  type RepoSyncOutcome,
  type SyncCycleReport,
} from "./sync.report";

/**
 * The closed set of words a paused sync is allowed to say, and the totals a log line quotes.
 *
 * The vocabulary is a contract rather than a convenience: M.4
 * ([#113](https://github.com/NobuData/ouroboros/issues/113)) renders these and N.6
 * ([#120](https://github.com/NobuData/ouroboros/issues/120)) writes a sentence for each, so a
 * reason with no message is a card with nothing on it.
 */

/**
 * One repository's outcome, mostly zeroes.
 *
 * @param overrides - What differs.
 * @returns The outcome.
 */
function outcome(overrides: Partial<RepoSyncOutcome> = {}): RepoSyncOutcome {
  return {
    organizationId: "org-backlog",
    githubRepoId: "dfff0000-0000-0000-0000-00000000000a",
    repository: "acme-robotics/helios-firmware",
    imported: 0,
    updated: 0,
    unchanged: 0,
    pullRequests: 0,
    unusable: 0,
    enqueued: 0,
    capped: false,
    ...overrides,
  };
}

describe("the pause vocabulary", () => {
  it("is K.3's five reasons plus the one that is not about GitHub", () => {
    expect(SYNC_PAUSES).toEqual([...Object.values(GITHUB_FAILURES), SYNC_NO_REPOSITORIES]);
  });

  it("has a sentence for every reason a card can render", () => {
    for (const pause of SYNC_PAUSES) {
      expect(SYNC_PAUSE_MESSAGES[pause]).toEqual(expect.any(String));
      expect(SYNC_PAUSE_MESSAGES[pause].length).toBeGreaterThan(0);
    }
  });

  it("keeps K.3's sentences rather than rewording them", () => {
    // One reason, one sentence, wherever it is read. A second wording is a second answer.
    expect(SYNC_PAUSE_MESSAGES[GITHUB_FAILURES.notConfigured]).toBe(
      GITHUB_MESSAGES[GITHUB_FAILURES.notConfigured],
    );
  });

  it("sends the two `off` states to different places", () => {
    // One is fixed with a token in settings, the other with a repository toggled on. A single
    // *"sync is off"* would send half the readers to the wrong screen.
    expect(SYNC_PAUSE_MESSAGES[SYNC_NO_REPOSITORIES]).toContain("repository");
    expect(SYNC_PAUSE_MESSAGES[GITHUB_FAILURES.notConfigured]).toContain("token");
  });
});

describe("a cycle's totals", () => {
  it("counts only what was actually polled", () => {
    const report: SyncCycleReport = {
      startedAt: new Date("2026-09-08T10:00:00.000Z"),
      organizations: [
        {
          organizationId: "org-backlog",
          repositories: [
            outcome({ imported: 3, updated: 1, unchanged: 9, enqueued: 3 }),
            outcome({ pause: GITHUB_FAILURES.notFound }),
          ],
        },
        { organizationId: "org-quiet", pause: SYNC_NO_REPOSITORIES, repositories: [] },
      ],
      pending: false,
    };

    expect(cycleTotals(report)).toEqual({
      repositories: 1,
      imported: 3,
      updated: 1,
      unchanged: 9,
      enqueued: 3,
      paused: 2,
    });
  });

  it("answers a cycle that found nothing with zeroes rather than with nothing", () => {
    const report: SyncCycleReport = {
      startedAt: new Date("2026-09-08T10:00:00.000Z"),
      organizations: [],
      pending: false,
    };

    expect(cycleTotals(report)).toEqual({
      repositories: 0,
      imported: 0,
      updated: 0,
      unchanged: 0,
      enqueued: 0,
      paused: 0,
    });
  });
});
