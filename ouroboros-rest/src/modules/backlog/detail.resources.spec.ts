import type { IssueDetailRow, IssueEstimateRow } from "./detail.repository";
import { issueDetail } from "./detail.resources";

/**
 * The mapping, which is the contract — and the three properties it exists to state.
 *
 *   * **An issue has a latest estimate or it has none.** `listing.resources.spec.ts` asserts the
 *     same thing about a row; here the shape is bigger and the rule is identical, and the
 *     issue-only answer is the ticket's own acceptance criterion — *"no nulls masquerading as an
 *     estimate"*.
 *   * **Latest wins, and it is computed rather than taken from the end of the list.** The seeded
 *     `#487` carries two versions whose every visible field differs, so a reader that published
 *     the superseded one is wrong in a way an assertion can see — and one that trusted the
 *     statement's `order by` would keep passing after somebody reversed it.
 *   * **The two stored documents change case here and only here.** `est_tokens` and `sized_at`
 *     are the bytes V026's CHECK functions look up by name; `estTokens` and `sizedAt` are what
 *     this API publishes. A key that stopped being translated would reach a client as the
 *     database spells it.
 */

/** The issue id `#485` is seeded with, so a fixture and an integration suite name the same row. */
const ISSUE = "5eed0018-0000-4000-8000-000000000485";

/**
 * Mockup 03's `#485`, as the issue statement returns it.
 *
 * @param overrides - What differs.
 * @returns The row.
 */
function issue(overrides: Partial<IssueDetailRow> = {}): IssueDetailRow {
  return {
    id: ISSUE,
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    labels: ["bug", "i2c", "watchdog", "priority-high"],
    state: "open",
    sizingStatus: "sized",
    queued: false,
    githubRepoId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    repository: "acme-robotics/helios-firmware",
    body: "Unit 07 in the Fremont pilot rebooted 14 times overnight.",
    authorLogin: "field-support",
    ghCreatedAt: new Date("2026-09-08T15:41:12.000Z"),
    ghUrl: "https://github.com/acme-robotics/helios-firmware/issues/485",
    ...overrides,
  };
}

/**
 * `#485`'s estimate, as the estimates statement returns it.
 *
 * @param overrides - What differs — a version, an estimator, a whole document.
 * @returns The row.
 */
function estimate(overrides: Partial<IssueEstimateRow> = {}): IssueEstimateRow {
  return {
    version: 1,
    effort: "m",
    confidence: 92,
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-fable-5",
    breakdown: {
      files: ["drivers/i2c_recovery.c", "drivers/imu_bmi270.c", "tests/unit/test_i2c_lockup.c"],
      est_tokens: 180_000,
      cycle_min: 12,
      cycle_max: 18,
      est_minutes: 45,
    },
    risk: "low",
    riskNote: "Isolated to the I²C driver path; full HIL coverage exists for bus recovery.",
    trace: {
      estimator: "heuristic-v0",
      sized_at: "2026-09-10T15:39:12.000Z",
      tokens_used: 0,
      signals: [],
    },
    createdAt: new Date("2026-09-10T15:39:12.000Z"),
    ...overrides,
  };
}

describe("the issue half of the panel", () => {
  it("is the row's cells plus the four the panel draws and the table does not", () => {
    expect(issueDetail(issue(), []).issue).toEqual({
      id: ISSUE,
      number: 485,
      title: "Watchdog reset on I²C bus lockup",
      labels: ["bug", "i2c", "watchdog", "priority-high"],
      state: "open",
      sizingStatus: "sized",
      queued: false,
      githubRepoId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      repository: "acme-robotics/helios-firmware",
      body: "Unit 07 in the Fremont pilot rebooted 14 times overnight.",
      authorLogin: "field-support",
      ghCreatedAt: "2026-09-08T15:41:12.000Z",
      ghUrl: "https://github.com/acme-robotics/helios-firmware/issues/485",
    });
  });

  it("carries the queued pill the table's row carries, since the panel queues too", () => {
    // M.3 added `queued` to `BacklogRow` and this shape inherits it — which is the point the
    // extension is making: **Queue for loop** is one of the three buttons that write the queue,
    // and the panel needs to know whether it already has.
    expect(issueDetail(issue({ queued: true }), []).issue.queued).toBe(true);
  });

  it("publishes the body raw, because the client is what truncates it", () => {
    // The ticket's own word. A server-side cut would decide a line count for a panel whose width
    // it cannot see, and would make *read more* a second request.
    const long = "x".repeat(4_000);

    expect(issueDetail(issue({ body: long }), []).issue.body).toBe(long);
  });

  it("carries a null body rather than an empty string", () => {
    // The seeded `#488` — a documentation sweep opened with no description at all. An empty
    // string would be a body somebody wrote and left blank, which is a different fact.
    expect(issueDetail(issue({ body: null }), []).issue.body).toBeNull();
  });

  it("carries a null author, because GitHub returns one for a deleted account", () => {
    expect(issueDetail(issue({ authorLogin: null }), []).issue.authorLogin).toBeNull();
  });

  it("publishes the opening instant rather than the phrase the panel renders", () => {
    // *"opened 2d ago"* is a rendering that is wrong one minute after it is sent.
    expect(issueDetail(issue(), []).issue.ghCreatedAt).toBe("2026-09-08T15:41:12.000Z");
  });

  it("carries no update timestamp, because the panel has nowhere to print one", () => {
    expect(Object.keys(issueDetail(issue(), []).issue)).not.toContain("ghUpdatedAt");
  });

  it("keeps the labels in the order they are stored", () => {
    // Decision K3: a mirror, never edited here. Re-sorting them would be an edit.
    expect(issueDetail(issue({ labels: ["watchdog", "bug"] }), []).issue.labels).toEqual([
      "watchdog",
      "bug",
    ]);
  });
});

describe("the estimate half of the panel", () => {
  it("publishes the estimate in full, with both documents in this API's names", () => {
    expect(issueDetail(issue(), [estimate()]).estimate).toEqual({
      version: 1,
      effort: "m",
      confidence: 92,
      suggestedWorkflow: "standard-fix",
      routedModel: "claude-fable-5",
      breakdown: {
        files: ["drivers/i2c_recovery.c", "drivers/imu_bmi270.c", "tests/unit/test_i2c_lockup.c"],
        estTokens: 180_000,
        cycleMin: 12,
        cycleMax: 18,
        estMinutes: 45,
      },
      risk: "low",
      riskNote: "Isolated to the I²C driver path; full HIL coverage exists for bus recovery.",
      trace: {
        estimator: "heuristic-v0",
        sizedAt: "2026-09-10T15:39:12.000Z",
        tokensUsed: 0,
        signals: [],
      },
    });
  });

  it("leaves none of the database's spellings in the answer", () => {
    // The keys V026's CHECK functions look up by name are stored bytes; a key that stopped being
    // translated would reach a client as the column spells it.
    const mapped = issueDetail(issue(), [estimate()]).estimate!;

    expect(Object.keys(mapped.breakdown)).toEqual([
      "files",
      "estTokens",
      "cycleMin",
      "cycleMax",
      "estMinutes",
    ]);
    expect(Object.keys(mapped.trace)).toEqual(["estimator", "sizedAt", "tokensUsed", "signals"]);
  });

  it("carries the trace's own instant rather than the row's", () => {
    // `db/schema.ts` keeps `trace.sized_at` and `created_at` apart: the same for a synchronous
    // estimate and deliberately different for O.2's escalate-and-poll.
    const sized = estimate({
      trace: {
        estimator: "claude-sonnet-5",
        sized_at: "2026-09-10T15:00:00.000Z",
        tokens_used: 41_000,
        signals: ["3 similar closed issues", "driver map"],
      },
      createdAt: new Date("2026-09-10T15:02:30.000Z"),
    });
    const detail = issueDetail(issue(), [sized]);

    expect(detail.estimate!.trace.sizedAt).toBe("2026-09-10T15:00:00.000Z");
    expect(detail.history[0].createdAt).toBe("2026-09-10T15:02:30.000Z");
  });

  it("publishes an empty file list and an empty signal list as they are", () => {
    // The seeded `#488` names no file, and `heuristic-v0` produces no signal. Both are real
    // answers, and V026 makes the empty list valid on purpose.
    const bare = estimate({
      breakdown: { files: [], est_tokens: 25_000, cycle_min: 3, cycle_max: 6, est_minutes: 15 },
    });

    expect(issueDetail(issue(), [bare]).estimate!.breakdown.files).toEqual([]);
    expect(issueDetail(issue(), [bare]).estimate!.trace.signals).toEqual([]);
  });

  it("carries an `estMinutes` outside the cycle range, because it is a different number", () => {
    // `#485` is *12–18 min* of cycle time and 45 minutes of work: the range is how long one loop
    // takes, and this is what the whole issue costs.
    const breakdown = issueDetail(issue(), [estimate()]).estimate!.breakdown;

    expect(breakdown.estMinutes).toBeGreaterThan(breakdown.cycleMax);
  });
});

describe("an issue with no estimate", () => {
  it("answers the issue-only shape rather than an object full of nulls", () => {
    // The ticket's second criterion, and the seeded `#483`: `estimating`, with no
    // `issue_estimates` row at all, because that is what `estimating` means.
    const detail = issueDetail(issue({ number: 483, sizingStatus: "estimating" }), []);

    expect(detail.estimate).toBeNull();
    expect(detail.history).toEqual([]);
    expect(detail.issue.number).toBe(483);
    expect(detail.issue.title).toBe("Watchdog reset on I²C bus lockup");
  });

  it("keeps the status and the estimate as separate answers", () => {
    // The seeded `#490`: sized by the pipeline and then held for a human. A panel that derived
    // one from the other would lose the row that is both.
    const detail = issueDetail(issue({ sizingStatus: "needs_human" }), [
      estimate({ effort: "xl", confidence: 61 }),
    ]);

    expect(detail.issue.sizingStatus).toBe("needs_human");
    expect(detail.estimate!.effort).toBe("xl");
  });
});

describe("the version in force", () => {
  /** The seeded `#487`, superseded first — the order the statement returns. */
  const twice = [
    estimate({
      version: 1,
      effort: "s",
      confidence: 55,
      routedModel: "ollama/qwen3-coder",
      risk: "low",
      createdAt: new Date("2026-09-09T04:00:00.000Z"),
    }),
    estimate({
      version: 2,
      effort: "l",
      confidence: 71,
      suggestedWorkflow: "feature-loop",
      risk: "high",
      createdAt: new Date("2026-09-10T05:00:00.000Z"),
    }),
  ];

  it("is the highest version, not the last row", () => {
    expect(issueDetail(issue(), twice).estimate).toMatchObject({
      version: 2,
      effort: "l",
      confidence: 71,
      suggestedWorkflow: "feature-loop",
      risk: "high",
    });
  });

  it("is still the highest version when the rows arrive in the other order", () => {
    // Decision K4 is stated once, here, rather than resting on a statement's `order by`. A
    // reversed clause would otherwise publish the superseded estimate and nothing would fail.
    expect(issueDetail(issue(), [...twice].reverse()).estimate!.version).toBe(2);
  });

  it("is the one whose version the history's last entry names", () => {
    const detail = issueDetail(issue(), twice);

    expect(detail.history.at(-1)!.version).toBe(detail.estimate!.version);
  });
});

describe("the history summary", () => {
  it("lists every version with what produced it and when the row was written", () => {
    // The ticket's fifth criterion. Oldest first, which is how a history reads and which puts
    // the entry in force last, beside the `estimate` above it.
    const detail = issueDetail(issue(), [
      estimate({ version: 1, createdAt: new Date("2026-09-09T04:00:00.000Z") }),
      estimate({
        version: 2,
        trace: {
          estimator: "claude-sonnet-5",
          sized_at: "2026-09-10T05:00:00.000Z",
          tokens_used: 41_000,
          signals: [],
        },
        createdAt: new Date("2026-09-10T05:00:00.000Z"),
      }),
    ]);

    expect(detail.history).toEqual([
      { version: 1, estimator: "heuristic-v0", createdAt: "2026-09-09T04:00:00.000Z" },
      { version: 2, estimator: "claude-sonnet-5", createdAt: "2026-09-10T05:00:00.000Z" },
    ]);
  });

  it("carries no breakdown, because a summary that did would not be cheap to include", () => {
    const [entry] = issueDetail(issue(), [estimate()]).history;

    expect(Object.keys(entry)).toEqual(["version", "estimator", "createdAt"]);
  });

  it("names the estimator from the version's own trace", () => {
    // Decision K10: an estimate that cannot say what produced it does not get to exist, and this
    // is the field the ticket's fourth criterion is about.
    const detail = issueDetail(issue(), [
      estimate({
        trace: {
          estimator: "heuristic-v0",
          sized_at: "2026-09-10T15:39:12.000Z",
          tokens_used: 0,
          signals: [],
        },
      }),
    ]);

    expect(detail.history[0].estimator).toBe("heuristic-v0");
    expect(detail.history[0].estimator).toBe(detail.estimate!.trace.estimator);
  });
});
