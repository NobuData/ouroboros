import type { RunConsole, RunControl, RunEventsPage } from "@/app/api/runs";

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

/** One timeline stage, as the payload carries it. */
export type RunTimelineStage = RunConsole["timeline"]["stages"][number];

/** The warn note the seed stores on implement's second attempt — the mockup's words. */
export const SEEDED_NOTE = "attempt 1 failed tests — loop returned from gate ↺";

/**
 * One stage of the seeded timeline.
 *
 * @param stageKey The DSL node id.
 * @param label The node's title.
 * @param position Its place in the pinned order.
 * @param over The rest.
 * @returns The stage.
 */
export function timelineStage(
  stageKey: string,
  label: string,
  position: number,
  over: Partial<RunTimelineStage> = {},
): RunTimelineStage {
  return {
    stageKey,
    label,
    position,
    status: "pending",
    attempt: 1,
    maxAttempts: null,
    durationSeconds: null,
    note: null,
    attempts: [],
    ...over,
  };
}

/**
 * Mockup 10's stepper as the timeline payload (#311): three done with `0m 04s`, `1m 12s` and
 * `2m 05s`; Implement active on `attempt 2/3` with the gate-return note; four pending.
 *
 * @returns The stages, in the pinned order.
 */
export function seededStages(): RunTimelineStage[] {
  return [
    timelineStage("issue-queued", "Queued", 1, { status: "succeeded", durationSeconds: 4 }),
    timelineStage("analyze", "Analyze", 2, { status: "succeeded", durationSeconds: 72 }),
    timelineStage("plan", "Plan", 3, { status: "succeeded", durationSeconds: 125 }),
    timelineStage("implement", "Implement", 4, {
      status: "active",
      attempt: 2,
      maxAttempts: 3,
      note: SEEDED_NOTE,
    }),
    timelineStage("build", "Build", 5),
    timelineStage("test", "Test", 6),
    timelineStage("review", "Review", 7),
    timelineStage("open-pr", "Open PR", 8),
  ];
}

/** What a test may override on the seed. */
export interface RunConsoleOverrides {
  readonly stages?: RunTimelineStage[];
  readonly run?: Partial<RunConsole["run"]>;
  readonly head?: Partial<RunConsole["head"]>;
  readonly wallClock?: Partial<RunConsole["resources"]["wallClock"]>;
  readonly asOf?: string;
  readonly changes?: Partial<RunConsole["changes"]>;
  readonly resources?: Partial<Omit<RunConsole["resources"], "wallClock">>;
  readonly guardrails?: Partial<RunConsole["guardrails"]>;
}

/** The seeded files — the mockup's three, with its counts. */
export function seededFiles(): RunConsole["changes"]["files"] {
  return [
    { path: "drivers/can/telemetry_buf.c", status: "modified", additions: 38, deletions: 12 },
    { path: "drivers/can/isr_fastpath.c", status: "modified", additions: 9, deletions: 3 },
    { path: "tests/telemetry/test_frame_order.c", status: "added", additions: 21, deletions: 0 },
  ];
}

/** The seeded commits — the mockup's two, in the writer's order. */
export function seededCommits(): RunConsole["changes"]["commits"] {
  return [
    {
      sha: "a41c9e2f0b7d3c5e8a1f6b2d4c9e7a3f5b8d1c0e",
      shortSha: "a41c9e2",
      subject: "can: replace telemetry k_fifo with k_msgq + frame seq",
      committedAt: "2026-09-19T12:04:40.000Z",
    },
    {
      sha: "7f03b8d1e6c2a9f4b0d5e3c8a7f1b6d2e9c4a0f3",
      shortSha: "7f03b8d",
      subject: "can: assign frame seq in ISR before enqueue",
      committedAt: "2026-09-19T12:09:30.000Z",
    },
  ];
}

/** AP.3's secrets disclosure, as the service states it. */
export const SEEDED_SECRETS: RunConsole["guardrails"]["secrets"] = {
  version: "v3",
  ruleCount: 152,
  recallClass: "~70%",
  summary:
    "Secrets ruleset v3: 152 known credential formats plus keyword proximity, scanned over added diff lines.",
  limitation:
    "A pass means no known credential format was found — not that the diff holds no secrets. " +
    "High-entropy secrets with no recognisable format (roughly 30% of real-world leaks) are " +
    "not detected; verified scanning arrives with AR.5.",
};

/**
 * One guardrail verdict.
 *
 * @param check Which check.
 * @param verdict Its answer.
 * @param evidence Where, and by which rule.
 * @returns The verdict.
 */
export function guardrailCheck(
  check: RunConsole["guardrails"]["checks"][number]["check"],
  verdict: RunConsole["guardrails"]["checks"][number]["verdict"],
  evidence?: RunConsole["guardrails"]["checks"][number]["evidence"],
): RunConsole["guardrails"]["checks"][number] {
  return {
    check,
    verdict,
    ...(evidence === undefined ? {} : { evidence }),
    rulesetVersion: check === "secrets" ? "v3" : null,
    evaluatedAt: "2026-09-19T12:09:31.000Z",
    changeSetSeq: check === "review_required" ? null : 2,
  };
}

/** The seeded verdicts — the mockup's three ticks and its `○`. */
export function seededChecks(): RunConsole["guardrails"]["checks"] {
  return [
    guardrailCheck("allowed_paths", "pass"),
    guardrailCheck("ci_config", "pass"),
    guardrailCheck("secrets", "pass"),
    guardrailCheck("review_required", "not_applicable"),
  ];
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
    timeline: {
      workflowTag: "standard-fix",
      workflowVersion: 14,
      currentStageKey: "implement",
      stages: over.stages ?? seededStages(),
    },
    changes: {
      files: seededFiles(),
      totals: { files: 3, additions: 68, deletions: 15 },
      commits: seededCommits(),
      mergeStrategy: "squash",
      ...over.changes,
    },
    resources: {
      tokens: { used: 212_000, tokensIn: 180_000, tokensOut: 32_000, budget: 400_000, budgetStageKey: "implement" },
      cost: { costCents: "114.0000", unpricedEvents: 0, capCents: 250, routeTag: "implement-primary" },
      farm: { buildJobId: "5eed0008-0000-4000-8000-000000000001", jobNumber: 12, jobStatus: "queued", runnerName: "forge-02" },
      ...over.resources,
      wallClock: {
        startedAt: SEEDED_STARTED_AT,
        finishedAt: null,
        elapsedSeconds: SEEDED_ELAPSED_SECONDS,
        ...over.wallClock,
      },
    },
    guardrails: {
      status: "clean",
      checks: seededChecks(),
      policy: { workflowTag: "standard-fix", workflowVersion: 14, tenant: "acme-robotics" },
      secrets: SEEDED_SECRETS,
      ...over.guardrails,
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
    retryStage: false,
    ...over,
  };
}

/** One transcript entry, as the events page carries it. */
export type RunEventEntry = RunEventsPage["entries"][number];

/**
 * An instant `seconds` into the seeded run.
 *
 * @param seconds How far in.
 * @returns The ISO instant.
 */
export function atSecond(seconds: number): string {
  return new Date(Date.parse(SEEDED_STARTED_AT) + seconds * 1000).toISOString();
}

/**
 * Mockup 10's nine transcript entries, as `R__dev_seed_run_console.sql` writes them (#312).
 *
 * @returns The entries, in `seq` order.
 */
export function seededEntries(): RunEventEntry[] {
  return [
    { seq: 1, ts: atSecond(131), actor: "plan", stageKey: "plan", attempt: 1, simulated: false,
      body: "Root cause: test asserts on frame order; CAN driver ISR can reorder under load." },
    { seq: 2, ts: atSecond(206), actor: "tool", stageKey: "implement", attempt: 1, toolTag: "read_file",
      simulated: false, body: "drivers/can/telemetry_buf.c" },
    { seq: 3, ts: atSecond(242), actor: "model", stageKey: "implement", attempt: 1, modelId: "claude-fable-5",
      simulated: false,
      body: "The buffer uses a bare k_fifo shared between the RX ISR and the telemetry thread." },
    { seq: 4, ts: atSecond(280), actor: "tool", stageKey: "implement", attempt: 1, toolTag: "edit_file",
      simulated: false, body: "drivers/can/telemetry_buf.c",
      payload: { hunks: [
        { kind: "ctx", text: "/* telemetry frame path */" },
        { kind: "del", text: "static struct k_fifo tel_fifo;" },
        { kind: "add", text: "K_MSGQ_DEFINE(tel_msgq, sizeof(struct tel_frame), CONFIG_TEL_QUEUE_DEPTH, 4);" },
      ] } },
    { seq: 5, ts: atSecond(312), actor: "tool", stageKey: "implement", attempt: 1, toolTag: "run_tests",
      simulated: false, body: "twister -T tests/telemetry",
      payload: { severity: "warn", result: "2 passed, 1 flaked → retrying under load profile" } },
    { seq: 6, ts: atSecond(468), actor: "gate", stageKey: "checks-green", attempt: 1, simulated: false,
      body: "test flake reproduced — returning to implement (attempt 2) ↺" },
    { seq: 7, ts: atSecond(495), actor: "model", stageKey: "implement", attempt: 2, modelId: "claude-fable-5",
      simulated: false,
      body: "The reorder window is in the ISR fast path; sequence numbers must be assigned before the enqueue." },
    { seq: 8, ts: atSecond(570), actor: "tool", stageKey: "implement", attempt: 2, toolTag: "edit_file",
      simulated: false, body: "drivers/can/isr_fastpath.c",
      payload: { hunks: [
        { kind: "del", text: "k_msgq_put(&tel_msgq, &frame, K_NO_WAIT);" },
        { kind: "add", text: "frame.seq = atomic_inc(&tel_seq);   /* assign before enqueue */" },
      ] } },
    { seq: 9, ts: atSecond(739), actor: "tool", stageKey: "implement", attempt: 2, toolTag: "run_tests",
      simulated: false, body: "twister -T tests/telemetry --load-profile",
      payload: { state: "running", progress: { done: 47, total: 63 } } },
  ];
}

/**
 * One page of the transcript's tail.
 *
 * @param over The parts to replace.
 * @returns The page — by default the whole seeded transcript from the start, live.
 */
export function eventsPage(over: Partial<RunEventsPage> = {}): RunEventsPage {
  const entries = over.entries ?? seededEntries();
  const after = over.after ?? 0;
  const nextAfter = over.nextAfter ?? (entries.at(-1)?.seq ?? after);

  return {
    runId: SEEDED_RUN_ID,
    after,
    entries,
    nextAfter,
    latestSeq: nextAfter,
    hasMore: false,
    live: true,
    elided: false,
    pollAfter: 5,
    ...over,
  };
}
