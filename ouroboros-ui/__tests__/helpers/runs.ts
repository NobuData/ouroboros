import type { RunConsole, RunControl } from "@/app/api/runs";

/**
 * The run console's seed, as `docs/mockups/10-run-detail.html` draws it (#309): loop #1847 on
 * issue #482, `coding` under `standard-fix v14` with `claude-fable-5`, twelve minutes forty in,
 * on `loop/482-canbus-flake`.
 */

/** The seeded run's id. */
export const SEEDED_RUN_ID = "5eed0009-0000-4000-8000-000000000482";

/** When the seeded snapshot was taken — the elapsed anchor's `asOf`. */
export const SEEDED_AS_OF = "2026-09-19T12:12:40.000Z";

/** When the seeded run started: `asOf` less twelve minutes forty. */
export const SEEDED_STARTED_AT = "2026-09-19T12:00:00.000Z";

/** The seeded elapsed figure, in seconds — `12m 40s`. */
export const SEEDED_ELAPSED_SECONDS = 760;

/** What a test may override on the seed. */
export interface RunConsoleOverrides {
  readonly run?: Partial<RunConsole["run"]>;
  readonly head?: Partial<RunConsole["head"]>;
  readonly wallClock?: Partial<RunConsole["resources"]["wallClock"]>;
  readonly asOf?: string;
}

/**
 * A run console snapshot — the mockup's seed, with any part replaced.
 *
 * @param over The parts to replace.
 * @returns The snapshot.
 */
export function runConsole(over: RunConsoleOverrides = {}): RunConsole {
  return {
    asOf: over.asOf ?? SEEDED_AS_OF,
    run: {
      id: SEEDED_RUN_ID,
      issueNumber: 482,
      issueTitle: "Fix flaky CAN-bus telemetry test",
      workflowTag: "standard-fix",
      model: "claude-fable-5",
      status: "coding",
      stageLabel: "Implementing",
      stageIndex: 4,
      stageTotal: 8,
      startedAt: SEEDED_STARTED_AT,
      finishedAt: null,
      prNumber: null,
      checksPassed: null,
      checksTotal: null,
      ...over.run,
    },
    head: {
      loopSeq: 1847,
      workflowVersion: 14,
      branchName: "loop/482-canbus-flake",
      simulated: false,
      live: true,
      repository: { owner: "acme", name: "helios-firmware" },
      ...over.head,
    },
    timeline: { workflowTag: "standard-fix", workflowVersion: 14, currentStageKey: null, stages: [] },
    changes: {
      files: [],
      totals: { files: 0, additions: 0, deletions: 0 },
      commits: [],
      mergeStrategy: "squash",
    },
    resources: {
      tokens: { used: 0, tokensIn: 0, tokensOut: 0, budget: null, budgetStageKey: null },
      cost: { costCents: null, unpricedEvents: 0, capCents: null, routeTag: null },
      wallClock: {
        startedAt: SEEDED_STARTED_AT,
        finishedAt: null,
        elapsedSeconds: SEEDED_ELAPSED_SECONDS,
        ...over.wallClock,
      },
    },
    guardrails: {
      status: "unevaluated",
      checks: [],
      policy: { workflowTag: "standard-fix", workflowVersion: 14, tenant: "acme" },
      secrets: { version: "1", ruleCount: 0, recallClass: "", summary: "", limitation: "" },
    },
  };
}

/** What a test may override on a control. */
export type RunControlOverrides = Partial<RunControl>;

/** A counter for {@link runControl}'s ids, so two controls in one list never collide. */
let controlSeq = 0;

/**
 * One control on the seeded run's queue (#310) — a pause, queued and not yet fetched, unless
 * told otherwise.
 *
 * @param over The parts to replace.
 * @returns The control.
 */
export function runControl(over: RunControlOverrides = {}): RunControl {
  controlSeq += 1;

  return {
    id: `c0000000-0000-4000-8000-${String(controlSeq).padStart(12, "0")}`,
    runId: SEEDED_RUN_ID,
    kind: "pause",
    state: "pending",
    requestedBy: "5eed0001-0000-4000-8000-00000000000a",
    requestedAt: "2026-09-19T12:12:40.000Z",
    deliveredAt: null,
    ackedAt: null,
    expiresAt: "2026-09-19T12:14:40.000Z",
    detail: null,
    hasPayload: false,
    remember: false,
    ...over,
  };
}
