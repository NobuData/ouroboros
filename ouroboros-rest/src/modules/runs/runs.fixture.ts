/**
 * Rows, as the repositories return them, for the runs module's unit suites.
 *
 * The values are mockup 10's `#482` — *Fix flaky CAN-bus telemetry test*, `Loop #1847`,
 * `standard-fix v14`, twelve minutes forty seconds in — so a mapper test that asserts a figure
 * is asserting the figure the page draws. Every builder takes overrides, and every instant is an
 * offset from {@link STARTED}, the way `R__dev_seed_run_console.sql` writes them.
 *
 * Nothing here ships: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type {
  Run,
  RunCommit,
  RunEvent,
  RunFile,
  RunGuardrailsLatest,
  RunStage,
} from "../db/schema";

/** `runs.id` of the fixture run. */
export const RUN_ID = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

/** When the fixture run began — the mockup's `14:00:00`. */
export const STARTED = new Date("2026-08-08T14:00:00.000Z");

/**
 * An instant a number of seconds into the run.
 *
 * @param seconds - Seconds after {@link STARTED}.
 * @returns The instant.
 */
export function into(seconds: number): Date {
  return new Date(STARTED.getTime() + seconds * 1000);
}

/**
 * One `runs` row. The shape is V008's plus every column V045–V050 added.
 *
 * @param over - Columns to replace.
 * @returns The row.
 */
export function runRow(over: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    organization_id: "acme-robotics-id",
    github_repo_id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    issue_number: 482,
    issue_title: "Fix flaky CAN-bus telemetry test",
    workflow_tag: "standard-fix",
    model: "claude-fable-5",
    status: "coding",
    stage_label: "Implementing",
    stage_index: 4,
    stage_total: 6,
    started_at: new Date("2026-08-13T14:25:01.000Z"),
    finished_at: null,
    pr_number: null,
    checks_passed: null,
    checks_total: null,
    created_at: new Date("2026-08-13T14:25:01.000Z"),
    updated_at: new Date("2026-08-13T14:25:01.000Z"),
    loop_seq: 1847,
    branch_name: "loop/482-canbus-flake",
    workflow_version_pin: 14,
    simulated: false,
    event_seq: 9,
    event_bytes: "862",
    event_cap: 20000,
    event_byte_cap: "33554432",
    events_elided_at: null,
    merge_strategy: "squash",
    reserved_build_job_id: null,
    event_hint: 0,
    change_set_seq: 0,
    ...over,
  };
}

/**
 * One `run_stages` row.
 *
 * @param over - Columns to replace; `stage_key`, `position` and `attempt` are the usual ones.
 * @returns The row.
 */
export function stageRow(over: Partial<RunStage> = {}): RunStage {
  return {
    id: `stage-${over.stage_key ?? "implement"}-${String(over.attempt ?? 1)}`,
    run_id: RUN_ID,
    stage_key: "implement",
    stage_label: "Implementing",
    position: 4,
    attempt: 1,
    status: "pending",
    started_at: null,
    finished_at: null,
    max_attempts: null,
    token_budget: null,
    returned_from_stage_key: null,
    returned_from_kind: null,
    return_reason: null,
    note: null,
    created_at: STARTED,
    updated_at: STARTED,
    ...over,
  };
}

/**
 * The mockup's stepper, as `R__dev_seed_dashboard.sql` writes it for `#482`: three stages done
 * (`0m 04s`, `1m 12s`, `2m 05s`), `implement` failed once and active on attempt 2 of 3 with the
 * gate's note, and two stages not yet entered. Deliberately out of order, so a mapper that relied
 * on the statement's `order by` would be caught.
 *
 * @returns The rows.
 */
export function mockupStages(): RunStage[] {
  return [
    stageRow({ stage_key: "build", stage_label: "Build farm", position: 5 }),
    stageRow({
      stage_key: "implement",
      position: 4,
      attempt: 2,
      status: "active",
      started_at: into(475),
      max_attempts: 3,
      token_budget: 400_000,
      returned_from_stage_key: "checks-green",
      returned_from_kind: "gate",
      return_reason: "failed_tests",
      note: "attempt 1 failed tests — loop returned from gate ↺",
    }),
    stageRow({
      stage_key: "queued",
      stage_label: "Queued",
      position: 1,
      status: "succeeded",
      started_at: into(0),
      finished_at: into(4),
    }),
    stageRow({
      stage_key: "analyze",
      stage_label: "Analyze",
      position: 2,
      status: "succeeded",
      started_at: into(4),
      finished_at: into(76),
      max_attempts: 3,
      token_budget: 400_000,
    }),
    stageRow({
      stage_key: "plan",
      stage_label: "Plan",
      position: 3,
      status: "succeeded",
      started_at: into(76),
      finished_at: into(201),
      max_attempts: 3,
      token_budget: 400_000,
    }),
    stageRow({
      stage_key: "implement",
      position: 4,
      attempt: 1,
      status: "failed",
      started_at: into(201),
      finished_at: into(460),
      max_attempts: 3,
      token_budget: 400_000,
    }),
    stageRow({ stage_key: "review", stage_label: "Self-review", position: 6 }),
  ];
}

/**
 * One `run_files` row.
 *
 * @param over - Columns to replace.
 * @returns The row.
 */
export function fileRow(over: Partial<RunFile> = {}): RunFile {
  return {
    id: `file-${over.path ?? "drivers/can/telemetry_buf.c"}`,
    run_id: RUN_ID,
    path: "drivers/can/telemetry_buf.c",
    additions: 38,
    deletions: 12,
    status: "modified",
    last_reported_at: into(590),
    created_at: into(300),
    ...over,
  };
}

/**
 * One `run_commits` row.
 *
 * @param over - Columns to replace.
 * @returns The row.
 */
export function commitRow(over: Partial<RunCommit> = {}): RunCommit {
  return {
    id: `commit-${String(over.seq ?? 1)}`,
    run_id: RUN_ID,
    sha: "a41c9e2",
    message: "can: replace telemetry k_fifo with k_msgq + frame seq",
    seq: 1,
    committed_at: into(300),
    reported_at: into(301),
    ...over,
  };
}

/**
 * One `run_events` row.
 *
 * @param over - Columns to replace.
 * @returns The row.
 */
export function eventRow(over: Partial<RunEvent> = {}): RunEvent {
  return {
    id: `event-${String(over.seq ?? 1)}`,
    run_id: RUN_ID,
    seq: 1,
    ts: into(131),
    actor: "plan",
    stage_key: "plan",
    attempt: 1,
    tool_tag: null,
    model_id: null,
    body: "Root cause: test asserts on frame order; CAN driver ISR can reorder under load.",
    payload: null,
    simulated: true,
    elided_events: null,
    elided_bytes: null,
    elided_from: null,
    elided_to: null,
    received_at: into(132),
    ...over,
  };
}

/**
 * One `v_run_guardrails_latest` row.
 *
 * @param over - Columns to replace.
 * @returns The row.
 */
export function guardrailRow(over: Partial<RunGuardrailsLatest> = {}): RunGuardrailsLatest {
  return {
    id: `guardrail-${over.check ?? "allowed_paths"}`,
    run_id: RUN_ID,
    check: "allowed_paths",
    verdict: "pass",
    evidence: null,
    ruleset_version: null,
    policy_ref: 14,
    evaluated_at: into(590),
    change_set_seq: 1,
    ...over,
  };
}

/**
 * The mockup's Guardrails card: three passes and the `○` review row.
 *
 * @returns The four rows, deliberately out of the card's order.
 */
export function mockupGuardrails(): RunGuardrailsLatest[] {
  return [
    guardrailRow({ check: "review_required", verdict: "not_applicable", change_set_seq: null }),
    guardrailRow({ check: "secrets", ruleset_version: "v3" }),
    guardrailRow({ check: "allowed_paths" }),
    guardrailRow({ check: "ci_config" }),
  ];
}
