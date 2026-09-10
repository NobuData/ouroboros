/**
 * The stand-ins L.3's suites share ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * Four kinds of thing, together because five suites want the same ones: an issue as the
 * repository reads it, an estimate as the engine answers it, the collaborators the orchestrator
 * takes, and a promise a spec can settle by hand.
 *
 * **The estimate is mockup 03's own `#485`** — `M`, 92%, `standard-fix`, `claude-fable-5` — so a
 * spec that fails prints numbers a reader can compare against the design they came from. It is
 * built in *this service's* `camelCase`, because that is what `EngineClient.estimate()` returns;
 * the `snake_case` version of the same answer is `engine/engine.fixture.ts`'s
 * `ENGINE_ESTIMATE_BODY`, and the two are deliberately separate — one is the wire and one is
 * what the wire parses into.
 *
 * **{@link deferred} is what makes concurrency assertable without timing anything.** A spec that
 * wanted to prove *"at most four at once"* by starting work and sleeping would be asserting how
 * fast a machine is; one that hands out promises it resolves itself is asserting the bound.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { Estimate, EstimationContext } from "../engine/engine.contract";
import type { EstimableIssueRow } from "./estimation.repository";

/** The workspace every unit suite here estimates for. */
export const FIXTURE_WORKSPACE = "org-estimation";

/** The issue row's id — what an estimate is versioned against. */
export const FIXTURE_ISSUE_ID = "e1000000-0000-0000-0000-000000000485";

/** `owner/name`, as the L.1 contract's `issue.repo` wants it. */
export const FIXTURE_SLUG = "acme-robotics/helios-firmware";

/**
 * The vocabularies a request offers — the shape `EstimationContextService` resolves.
 *
 * Two model keys, because that is what {@link MODEL_DEFAULT_KINDS} produces on a workspace that
 * routes both `implement` and `docs`, and because a map with one key would let a spec pass
 * without ever exercising the case the engine actually looks a key up in.
 */
export const FIXTURE_CONTEXT: EstimationContext = {
  workflowTags: ["standard-fix", "docs-loop", "feature-loop", "deps-refresh"],
  modelDefaults: { default: "claude-fable-5", docs: "claude-haiku-4-5" },
};

/**
 * One issue, as `EstimationRepository.issue()` returns it.
 *
 * @param overrides - What differs from mockup 03's `#485`.
 * @returns The row.
 */
export function issueRow(overrides: Partial<EstimableIssueRow> = {}): EstimableIssueRow {
  return {
    issueId: FIXTURE_ISSUE_ID,
    organizationId: FIXTURE_WORKSPACE,
    number: 485,
    title: "I2C bus lockup after IMU sleep/wake cycle",
    body: "After entering low-power sleep and waking the BMI270, the I2C bus locks up.",
    labels: ["bug", "i2c", "watchdog"],
    repo: FIXTURE_SLUG,
    sizingStatus: "unsized",
    ...overrides,
  };
}

/**
 * One estimate, as `EngineClient.estimate()` answers it.
 *
 * @param overrides - What differs from the mockup's `#485`. `confidence` is the one most specs
 *   move, because it is the whole of the `sized` / `needs_human` decision.
 * @returns The estimate, in this service's names.
 */
export function estimate(overrides: Partial<Estimate> = {}): Estimate {
  return {
    effort: "m",
    confidence: 92,
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-fable-5",
    breakdown: {
      files: ["drivers/i2c_recovery.c", "drivers/imu_bmi270.c"],
      estTokens: 180_000,
      cycleMin: 12,
      cycleMax: 18,
      estMinutes: 23,
    },
    risk: "low",
    riskNote: "Isolated to the I²C driver path; full HIL coverage exists for bus recovery.",
    trace: {
      estimator: "heuristic-v0",
      tokensUsed: 0,
      signals: [
        "label: bug -> m",
        'routed-model: model_defaults["default"] -> resolved, not invoked',
      ],
    },
    ...overrides,
  };
}

/** A promise, and the handles to settle it from outside. */
export interface Deferred<T> {
  /** What the code under test awaits. */
  readonly promise: Promise<T>;
  /** Settle it successfully. */
  resolve(value: T): void;
  /** Settle it as a failure. */
  reject(error: unknown): void;
}

/**
 * A promise a spec finishes when it chooses to.
 *
 * How the concurrency bound is asserted: start more work than the bound allows, count what
 * started, resolve one, count again. No timers, and therefore no machine-speed dependency.
 *
 * @returns The promise and its two handles.
 */
export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;

  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });

  return { promise, resolve, reject };
}

/**
 * Let every microtask that is already queued run.
 *
 * The queue starts work without awaiting it — that is what makes the bound a bound — so a spec
 * that admitted a job and asserted immediately would be asserting against a job that has not
 * reached its first `await`. One turn of the event loop is what closes that gap, and
 * `setImmediate` is the turn that runs after promise callbacks rather than among them.
 *
 * @returns When the current round of pending work has had a chance to start.
 */
export async function drainMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
