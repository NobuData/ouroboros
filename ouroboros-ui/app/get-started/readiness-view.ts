/**
 * Step 4's readiness card — what it says and how it is grouped (DK.2,
 * [#1319](https://github.com/NobuData/ouroboros/issues/1319)). Pure: the card and the action bar
 * both read it, so the caption under a disabled action and the card's first failing row are the
 * same sentence.
 *
 * ```
 * GET /api/loop/readiness?repository=…&workflow=…[&issue=…]   this origin → REST DK.1 (#1318)
 * passing    collapsed — "✓ N checks passed" behind a show toggle
 * failing    expanded — the reason, its fix link
 * unknown    expanded — the reason, what "could not be confirmed" means, its fix link
 * disabled   the deployment switch is off: the configuration is saved, the switch is an
 *            administrator's, the administration page is linked; the action finishes setup
 * ```
 *
 * Every sentence a check carries is REST's own (`reason`, `fix.label`); this module adds only
 * the frame around them, so a reason is never paraphrased into something the service did not say.
 */

import type { LoopReadiness, LoopReadinessCheck } from "@/app/api/loop";
import { DOCS_URL } from "@/app/external";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const READINESS_ENDPOINT = "/api/loop/readiness";

/** The query parameters, as REST names them. */
export const READINESS_PARAMS = { repository: "repository", workflow: "workflow", issue: "issue" } as const;

/** The administration page that says how live execution is turned on (DK.3, #1325). */
export const LIVE_EXECUTION_ADMIN_DOCS = `${DOCS_URL}administration/live-execution`;

/** The card's title and accessible names. */
export const READINESS_TITLE = "Ready to run?";
export const READINESS_ROWS_LABEL = "What a live loop needs";
export const PASSED_TOGGLE_SHOW = "show";
export const PASSED_TOGGLE_HIDE = "hide";

/** What the card says while it has not heard yet, and when it cannot hear. */
export const READINESS_PENDING = "Checking whether a live loop can start…";
export const UNREACHABLE_READINESS = "Readiness could not be checked — the service did not answer.";
export const UNREADABLE_READINESS = "Readiness could not be checked — the answer was not one this page reads.";
/** Step 4 before step 3 has instantiated a workflow: there is nothing to check yet. */
export const NO_WORKFLOW_READINESS = "Readiness is checked once a workflow is chosen in step 3.";

/** What an `unknown` row means, beside its own reason. */
export const UNKNOWN_NOTE = "Ouroboros could not confirm this, so it blocks until it can.";

/** The dry-run line — the safety the loop runs under, said once ready or not. */
export const DRY_RUN_LINE = "Dry-run is on: the loop opens a draft pull request and merges nothing.";

/** The execution-disabled design. */
export const DISABLED_TITLE = "Your configuration is saved.";
export const DISABLED_LINE =
  "Live execution is an administrator's switch (OURO_LIVE_EXECUTION_ENABLED) and it is off in this deployment. Finish setup to queue your first issue; it waits in the queue until an administrator turns live execution on.";
export const DISABLED_LINK = "How live execution is turned on →";

/** The primary action's label while live execution is off — the launcher queues the pick. */
export const FINISH_LABEL = "Finish setup";

/** How the estimate is labelled — an expectation, never a promise. */
export const ESTIMATE_LABEL = "Estimate";

/** The glyph each state draws, and how a screen reader hears it. */
export const STATE_GLYPHS: Readonly<Record<LoopReadinessCheck["state"], string>> = {
  pass: "✓",
  fail: "✗",
  unknown: "?",
};
export const STATE_NAMES: Readonly<Record<LoopReadinessCheck["state"], string>> = {
  pass: "Passed",
  fail: "Failed",
  unknown: "Could not be confirmed",
};

/**
 * The readiness address for a repository, a workflow and, optionally, an issue.
 *
 * @param repo `owner/name`.
 * @param workflow The workflow's slug.
 * @param issue The issue number to ask about, or null for the wizard's pick.
 * @returns `/api/loop/readiness?repository=…&workflow=…[&issue=…]`.
 */
export function readinessEndpoint(repo: string, workflow: string, issue: number | null): string {
  const query = new URLSearchParams({
    [READINESS_PARAMS.repository]: repo,
    [READINESS_PARAMS.workflow]: workflow,
  });

  if (issue !== null) query.set(READINESS_PARAMS.issue, String(issue));

  return `${READINESS_ENDPOINT}?${query.toString()}`;
}

/** The card's rows, grouped the way it draws them. */
export interface ReadinessGroups {
  /** Passing checks — collapsed. */
  readonly passed: readonly LoopReadinessCheck[];
  /** Failing and unknown checks, in REST's order — expanded. */
  readonly blocking: readonly LoopReadinessCheck[];
}

/**
 * Split the checks into the collapsed passes and the expanded rest.
 *
 * @param readiness The preflight.
 * @returns The two groups, each in REST's order.
 */
export function readinessGroups(readiness: Pick<LoopReadiness, "checks">): ReadinessGroups {
  return {
    passed: readiness.checks.filter((check) => check.state === "pass"),
    blocking: readiness.checks.filter((check) => check.state !== "pass"),
  };
}

/**
 * Whether the deployment switch is off — the execution-disabled design.
 *
 * @param readiness The preflight.
 * @returns True when the `deployment` check failed on `deployment_disabled`.
 */
export function executionDisabled(readiness: Pick<LoopReadiness, "checks">): boolean {
  return readiness.checks.some((check) => check.id === "deployment" && check.code === "deployment_disabled");
}

/**
 * The caption under a disabled action — the first check that did not pass, in REST's words.
 *
 * @param readiness The preflight.
 * @returns The reason, or null when every check passed.
 */
export function firstBlockingReason(readiness: Pick<LoopReadiness, "checks">): string | null {
  return readiness.checks.find((check) => check.state !== "pass")?.reason ?? null;
}

/**
 * `✓ 5 checks passed`.
 *
 * @param count How many passed.
 * @returns The collapsed row's words.
 */
export function passedLine(count: number): string {
  return `${STATE_GLYPHS.pass} ${String(count)} ${count === 1 ? "check" : "checks"} passed`;
}

/**
 * The head line — the repository, and the issue with its size when one is known.
 *
 * @param readiness The preflight.
 * @returns `acme/helios · #488 Fix typo in README · size S`.
 */
export function headLine(readiness: Pick<LoopReadiness, "repository" | "estimate">): string {
  const { issue } = readiness.estimate;
  const parts = [readiness.repository];

  if (issue !== null) {
    parts.push(`#${String(issue.number)} ${issue.title}`);
    if (issue.size !== null) parts.push(`size ${issue.size.toUpperCase()}`);
  }

  return parts.join(" · ");
}

/**
 * Cents as dollars: `$2.00`.
 *
 * @param cents A whole number of cents.
 * @returns The amount.
 */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The estimate line — labelled as one, and only what the deployment knows.
 *
 * @param estimate The preflight's estimate.
 * @returns `cap $2.00 per run · issue sized S (heuristic-v0)`, or null when it knows neither.
 */
export function estimateLine(estimate: LoopReadiness["estimate"]): string | null {
  const parts: string[] = [];

  if (estimate.costCapCentsPerRun !== null) parts.push(`cap ${dollars(estimate.costCapCentsPerRun)} per run`);
  if (estimate.issue?.size != null) {
    const by = estimate.issue.sizedBy === null ? "" : ` (${estimate.issue.sizedBy})`;
    parts.push(`issue sized ${estimate.issue.size.toUpperCase()}${by}`);
  }

  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * Whether the dry-run check passed — the card says the safety line only when it holds.
 *
 * @param readiness The preflight.
 * @returns True when `dry_run` passed.
 */
export function dryRunHolds(readiness: Pick<LoopReadiness, "checks">): boolean {
  return readiness.checks.some((check) => check.id === "dry_run" && check.state === "pass");
}

/**
 * Whether a payload is shaped like the preflight — enough to draw the card.
 *
 * @param value What arrived.
 * @returns True for the preflight.
 */
export function isLoopReadiness(value: unknown): value is LoopReadiness {
  if (typeof value !== "object" || value === null) return false;

  const { repository, ready, checks, estimate } = value as Record<string, unknown>;

  return (
    typeof repository === "string" &&
    typeof ready === "boolean" &&
    Array.isArray(checks) &&
    checks.every(isCheck) &&
    typeof estimate === "object" &&
    estimate !== null
  );
}

/**
 * Whether one row is shaped like a check.
 *
 * @param value One element of `checks`.
 * @returns True for a check.
 */
function isCheck(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  const { id, state, reason, fix } = value as Record<string, unknown>;

  return (
    typeof id === "string" &&
    (state === "pass" || state === "fail" || state === "unknown") &&
    typeof reason === "string" &&
    (fix === null || (typeof fix === "object" && fix !== null))
  );
}
