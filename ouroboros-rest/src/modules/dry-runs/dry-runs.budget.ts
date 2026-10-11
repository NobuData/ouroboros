/**
 * What a dry run may spend — the tighter of two caps (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * ```
 * budget = min(the workspace's dry-run cap, the draft's own spend guard)
 * ```
 *
 *   * **The workspace's cap** is `workspace_settings.dry_run_cap_cents` (V126), read through
 *     the effective view, so it always exists — `$10.00` for a workspace that never chose.
 *   * **The draft's spend guard** is the `$5/run` somebody set in conversation. DSL v1 has no
 *     guard construct, so it is not in the document: it is the copilot's `set_guard` on the
 *     reply's tool trace, recorded `proposed` (`copilot.exchange.ts`). The newest one wins; a
 *     draft nobody capped has none, and the workspace's cap stands alone.
 *
 * Pure: `dry-runs.repository.ts` reads the two inputs and this file does the arithmetic, so the
 * rule is asserted without a database.
 */

import type { CopilotToolTrace } from "../db/schema";
import type { EngineDryRunBudget } from "../engine/engine.dryruns";

/** The operation kind a guard proposal is recorded under (`copilot.operations.ts`' `GUARD_KIND`). */
const GUARD_OPERATION = "set_guard";

/** The org policy's spend rule — the only guard that caps what a run may spend. */
const SPEND_GUARD = "spend_guard";

/** Which cap decided the budget. */
export type DryRunBudgetSource = "workspace_cap" | "draft_guard";

/** A dry run's budget, with both inputs so the page can say why. */
export interface DryRunBudget {
  /** The most the run may spend, in cents — the lower of the two caps. */
  readonly capCents: number;
  /** Which cap that is. The workspace's on a tie. */
  readonly source: DryRunBudgetSource;
  /** The workspace's dry-run cap, in cents. */
  readonly workspaceCapCents: number;
  /** The draft's per-run spend guard in cents, or `null` when it carries none. */
  readonly draftGuardCents: number | null;
}

/**
 * Whether a value is a positive whole number of cents.
 *
 * @param value - Anything a tool trace might hold.
 * @returns `true` for a positive safe integer.
 */
function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * The per-run cap one recorded guard proposal names, if it names one.
 *
 * Two shapes are read, because two writers exist: the copilot's own call
 * (`{guard: "spend_guard", params: {per_run_cap_cents}}`, the engine's `SetGuardArguments`) and
 * the flat form the development seed records (`{spend_cap_cents, per: "run"}`).
 *
 * @param params - The operation's `params`, as stored.
 * @returns The cap in cents, or `null` when this proposal is not a per-run spend cap.
 */
function perRunCapOf(params: Readonly<Record<string, unknown>> | undefined): number | null {
  if (params === undefined) return null;

  if (params.guard === SPEND_GUARD) {
    const inner = params.params;
    const cap =
      inner !== null && typeof inner === "object"
        ? (inner as Record<string, unknown>).per_run_cap_cents
        : undefined;
    return isCents(cap) ? cap : null;
  }

  if (params.per === "run" && isCents(params.spend_cap_cents)) {
    return params.spend_cap_cents;
  }

  return null;
}

/**
 * The draft's spend guard — the newest per-run cap the copilot proposed on it.
 *
 * @param traces - The tool traces of the workflow's copilot replies, **newest first**.
 * @returns The cap in cents, or `null` when no reply proposed one.
 */
export function draftSpendGuardCents(traces: readonly CopilotToolTrace[]): number | null {
  for (const trace of traces) {
    // Within one reply the last proposal is the one the conversation ended on.
    for (const operation of [...trace.operations].reverse()) {
      if (operation.op.kind !== GUARD_OPERATION || operation.outcome !== "proposed") continue;

      const cap = perRunCapOf(operation.op.params);
      if (cap !== null) return cap;
    }
  }

  return null;
}

/**
 * The budget a dry run runs under.
 *
 * @param workspaceCapCents - `workspace_settings_effective.dry_run_cap_cents`.
 * @param draftGuardCents - The draft's spend guard, or `null`.
 * @returns The lower cap, and which one it is.
 */
export function effectiveBudget(
  workspaceCapCents: number,
  draftGuardCents: number | null,
): DryRunBudget {
  const draftWins = draftGuardCents !== null && draftGuardCents < workspaceCapCents;

  return {
    capCents: draftWins ? draftGuardCents : workspaceCapCents,
    source: draftWins ? "draft_guard" : "workspace_cap",
    workspaceCapCents,
    draftGuardCents,
  };
}

/**
 * The caps the harness is sent.
 *
 * Only the run's spend is capped here: a stage's own `limits.token_budget` is in the document
 * and the harness applies it itself.
 *
 * @param budget - The dry run's budget.
 * @returns The engine's four caps.
 */
export function engineBudget(budget: DryRunBudget): EngineDryRunBudget {
  return {
    runCostCents: budget.capCents,
    stageCostCents: null,
    runTokens: null,
    stageTokens: null,
  };
}
