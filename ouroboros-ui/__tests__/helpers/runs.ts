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
