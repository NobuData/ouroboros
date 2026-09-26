/**
 * The hint matrix — every rule of `triage.rules.ts` firing and not firing (AT.4,
 * [#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * One row per case the rules have to answer: the context, which rule should be the hint (or
 * none), and each rule's verdict. `triage.rules.spec.ts` replays it; a rule whose behaviour
 * changes turns a named row red rather than a count.
 */

import type { HintContext, HintRuleId } from "./triage.rules";

/** A failing case with nothing about it that any rule reads as a signal. */
export const QUIET: HintContext = {
  status: "failed",
  retryOutcomes: ["failed"],
  failure: { message: "expected 3 frames, got 2", path: "tests/telemetry/test_frame_order.c" },
  priorPassOnRetry: 0,
  job: { status: "failed", runnerStatus: "online" },
  previous: "failed",
  changedPaths: ["drivers/can/telemetry_buf.c"],
};

/** One row of the matrix. */
export interface MatrixRow {
  readonly name: string;
  readonly context: HintContext;
  /** The hint's rule, or null for no hint. */
  readonly hint: HintRuleId | null;
  /** Which rules fire, in precedence order. */
  readonly fired: readonly HintRuleId[];
}

export const HINT_MATRIX: readonly MatrixRow[] = [
  {
    name: "nothing fires on a repeat failure outside the diff",
    context: QUIET,
    hint: null,
    fired: [],
  },
  {
    name: "a pass on a sanctioned retry in this attempt is a flake",
    context: { ...QUIET, status: "flaky", retryOutcomes: ["failed", "passed", "passed"] },
    hint: "flake.pass_on_retry",
    fired: ["flake.pass_on_retry"],
  },
  {
    name: "a pass on retry in the case's history is a flake",
    context: { ...QUIET, priorPassOnRetry: 2 },
    hint: "flake.pass_on_retry",
    fired: ["flake.pass_on_retry"],
  },
  {
    name: "a build dispatch retried for infrastructure is infra",
    context: { ...QUIET, job: { status: "retried", runnerStatus: "online" } },
    hint: "infra.rig_error",
    fired: ["infra.rig_error"],
  },
  {
    name: "a runner that has gone offline is infra",
    context: { ...QUIET, job: { status: "failed", runnerStatus: "offline" } },
    hint: "infra.rig_error",
    fired: ["infra.rig_error"],
  },
  {
    name: "a removed runner is infra",
    context: { ...QUIET, job: { status: "failed", runnerStatus: "removed" } },
    hint: "infra.rig_error",
    fired: ["infra.rig_error"],
  },
  {
    name: "a rig-offline failure message is infra",
    context: {
      ...QUIET,
      status: "error",
      failure: { message: "rig helios-rig-02 unreachable after power cycle" },
    },
    hint: "infra.rig_error",
    fired: ["infra.rig_error"],
  },
  {
    name: "a brown-out in the log excerpt is infra",
    context: {
      ...QUIET,
      failure: { message: "trial 2 aborted", log_excerpt: "PSU brownout at 11.2 V" },
    },
    hint: "infra.rig_error",
    fired: ["infra.rig_error"],
  },
  {
    name: "a refused connection is infra, with no job at all",
    context: { ...QUIET, job: null, failure: { message: "connect ECONNREFUSED 10.0.4.2:3333" } },
    hint: "infra.rig_error",
    fired: ["infra.rig_error"],
  },
  {
    name: "a missing probe is infra",
    context: { ...QUIET, failure: { message: "J-Link probe not found" } },
    hint: "infra.rig_error",
    fired: ["infra.rig_error"],
  },
  {
    name: "a full disk on the runner is infra",
    context: { ...QUIET, failure: { log_excerpt: "write failed: No space left on device" } },
    hint: "infra.rig_error",
    fired: ["infra.rig_error"],
  },
  {
    name: "a draining runner is not infra — it finished the job it held",
    context: { ...QUIET, job: { status: "failed", runnerStatus: "draining" } },
    hint: null,
    fired: [],
  },
  {
    name: "a new failure in a file the run changed is a product bug",
    context: {
      ...QUIET,
      previous: "passed",
      failure: { message: "overshoot 2.4% > 2.0%", path: "drivers/can/telemetry_buf.c" },
    },
    hint: "product.new_failure_in_diff",
    fired: ["product.new_failure_in_diff"],
  },
  {
    name: "a new failure beside a file the run changed is a product bug",
    context: {
      ...QUIET,
      previous: "passed",
      failure: { message: "frame order", path: "./drivers/can/isr_fastpath.c" },
    },
    hint: "product.new_failure_in_diff",
    fired: ["product.new_failure_in_diff"],
  },
  {
    name: "a case absent from the previous attempt counts as new",
    context: { ...QUIET, previous: "absent", failure: { path: "drivers/can/telemetry_buf.c" } },
    hint: "product.new_failure_in_diff",
    fired: ["product.new_failure_in_diff"],
  },
  {
    name: "a new failure outside the diff is not a product-bug hint",
    context: { ...QUIET, previous: "passed" },
    hint: null,
    fired: [],
  },
  {
    name: "a new failure with no path is not a product-bug hint",
    context: { ...QUIET, previous: "passed", failure: { message: "assertion failed" } },
    hint: null,
    fired: [],
  },
  {
    name: "a first attempt has nothing to be new against",
    context: { ...QUIET, previous: null, failure: { path: "drivers/can/telemetry_buf.c" } },
    hint: null,
    fired: [],
  },
  {
    name: "a failure that also failed last time is not new",
    context: { ...QUIET, previous: "error", failure: { path: "drivers/can/telemetry_buf.c" } },
    hint: null,
    fired: [],
  },
  {
    name: "a file at the root overlaps only itself",
    context: {
      ...QUIET,
      previous: "passed",
      failure: { path: "Makefile" },
      changedPaths: ["CMakeLists.txt"],
    },
    hint: null,
    fired: [],
  },
  {
    name: "a flake outranks infra and a diff overlap",
    context: {
      ...QUIET,
      status: "flaky",
      retryOutcomes: ["error", "passed"],
      previous: "passed",
      job: { status: "retried", runnerStatus: "offline" },
      failure: { message: "rig offline", path: "drivers/can/telemetry_buf.c" },
    },
    hint: "flake.pass_on_retry",
    fired: ["flake.pass_on_retry", "infra.rig_error"],
  },
  {
    name: "infra outranks a diff overlap",
    context: {
      ...QUIET,
      previous: "passed",
      job: { status: "failed", runnerStatus: "offline" },
      failure: { path: "drivers/can/telemetry_buf.c" },
    },
    hint: "infra.rig_error",
    fired: ["infra.rig_error", "product.new_failure_in_diff"],
  },
];
