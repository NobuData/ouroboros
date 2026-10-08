/**
 * How a research tool fails — six classes, each with a designed surface state — and the refusals
 * the internal tool surface answers with.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). An adapter throws
 * {@link ResearchToolError} carrying one of {@link TOOL_ERROR_CLASSES}; nothing else is a
 * failure an adapter may raise. Each class maps to a **surface state** — what the run panel and
 * the tools card draw — rather than to a generic "tool failed", because each one asks something
 * different of the person reading it:
 *
 *   class            surface state      retry   what it asks
 *   ---------------  -----------------  ------  ------------------------------------------------
 *   auth             reconnect          no      the credential was refused — re-enter it
 *   network          retrying           yes     the tool could not be reached; it will try again
 *   robots_denied    skipped_source     no      the site forbids reading it — recorded, not cited
 *   rate_limited     backing_off        yes     the upstream throttled; it waits, then retries
 *   upstream         retrying           yes     the upstream answered 5xx or nonsense
 *   unsupported      not_supported      no      the upstream cannot do this (a JS-only page, a
 *                                               format the reader does not parse)
 *
 * The list is exhaustive over the adapters this epic ships (CL.2–CL.6): `robots_denied` is the
 * web reader's and the competitor tracker's, `unsupported` covers the render tier v1 does not
 * have (#637), and every adapter that talks HTTP can produce the other four.
 */

import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotImplementedError,
  UpstreamError,
} from "../../errors/error.envelope";

/** The six ways a tool fails. */
export const TOOL_ERROR_CLASSES = [
  "auth",
  "network",
  "robots_denied",
  "rate_limited",
  "upstream",
  "unsupported",
] as const;

/** One of {@link TOOL_ERROR_CLASSES}. */
export type ToolErrorClass = (typeof TOOL_ERROR_CLASSES)[number];

/** The designed states a failure surfaces as. */
export type ToolSurfaceState =
  "reconnect" | "retrying" | "skipped_source" | "backing_off" | "not_supported";

/** Each class's surface state. */
export const TOOL_ERROR_SURFACES: Readonly<Record<ToolErrorClass, ToolSurfaceState>> = {
  auth: "reconnect",
  network: "retrying",
  robots_denied: "skipped_source",
  rate_limited: "backing_off",
  upstream: "retrying",
  unsupported: "not_supported",
};

/** Whether a retry of the same operation can help. */
export const TOOL_ERROR_RETRYABLE: Readonly<Record<ToolErrorClass, boolean>> = {
  auth: false,
  network: true,
  robots_denied: false,
  rate_limited: true,
  upstream: true,
  unsupported: false,
};

/** A classified tool failure — the only exception an adapter's operation may throw. */
export class ResearchToolError extends Error {
  /**
   * @param errorClass - Which of the six it was.
   * @param detail - A short note — `403 robots.txt disallows /releases`. **Never the
   *   credential**: the conformance kit asserts it.
   * @param retryAfterSeconds - For `rate_limited`, how long the upstream asked to wait, when
   *   it said; null otherwise.
   */
  constructor(
    readonly errorClass: ToolErrorClass,
    readonly detail: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`${errorClass}: ${detail}`);
    this.name = "ResearchToolError";
  }
}

/**
 * Whether a value is a {@link ResearchToolError} with a known class.
 *
 * @param error - Anything caught.
 * @returns `true` for a classified tool failure.
 */
export function isResearchToolError(error: unknown): error is ResearchToolError {
  return (
    error instanceof ResearchToolError &&
    (TOOL_ERROR_CLASSES as readonly string[]).includes(error.errorClass)
  );
}

/** The codes the internal tool surface refuses with. */
export const RESEARCH_TOOL_ERRORS = {
  /** `501` — a slug with no adapter in this build. */
  toolNotRegistered: "research_tool_not_registered",
  /** `422` — the tool does not declare that operation, or the input is not one it takes. */
  operationUnsupported: "research_tool_operation_unsupported",
  /** `403` — the investigation did not enable this tool. */
  toolNotEnabled: "research_tool_not_enabled",
  /** `409` — the workspace has not configured a tool whose schema requires settings. */
  toolNotConfigured: "research_tool_not_configured",
  /** `409` — the investigation is not running, so nothing may be archived under it. */
  investigationNotRunning: "investigation_not_running",
  /** `409` — the investigation's operation or token budget is spent. */
  budgetExhausted: "research_budget_exhausted",
  /** `502` — the tool failed; `details.errorClass` says how. */
  toolFailed: "research_tool_failed",
  /** `502` — the tool answered outside the citation contract. */
  contractViolation: "research_tool_contract_violation",
} as const;

/**
 * `501` — this build has no adapter for that slug.
 *
 * @param slug - The slug asked for.
 * @param registered - The slugs that do have one.
 * @returns The error to throw.
 */
export function toolNotRegistered(
  slug: string,
  registered: readonly string[],
): NotImplementedError {
  return new NotImplementedError(
    RESEARCH_TOOL_ERRORS.toolNotRegistered,
    "This build has no adapter for that research tool.",
    { tool: slug, registered: [...registered] },
  );
}

/**
 * `422` — the tool does not do that, or the input is not what that operation takes.
 *
 * @param slug - The tool.
 * @param operation - The operation asked for.
 * @param supported - The operations it does declare.
 * @param reason - Why, when it is the input rather than the operation.
 * @returns The error to throw.
 */
export function operationUnsupported(
  slug: string,
  operation: string,
  supported: readonly string[],
  reason: string | null = null,
): InvalidRequestError {
  return new InvalidRequestError(
    RESEARCH_TOOL_ERRORS.operationUnsupported,
    "That research tool does not support this operation with this input.",
    { tool: slug, operation, supported: [...supported], ...(reason === null ? {} : { reason }) },
  );
}

/**
 * `403` — the investigation did not turn this tool on.
 *
 * @param slug - The tool.
 * @param investigation - The investigation's display id — `RS-127`.
 * @param enabled - The tools it did enable.
 * @returns The error to throw.
 */
export function toolNotEnabled(
  slug: string,
  investigation: string,
  enabled: readonly string[],
): ForbiddenError {
  return new ForbiddenError(
    RESEARCH_TOOL_ERRORS.toolNotEnabled,
    "This investigation did not enable that research tool.",
    { tool: slug, investigation, enabled: [...enabled] },
  );
}

/**
 * `409` — the workspace has not configured the tool and its schema requires settings.
 *
 * @param slug - The tool.
 * @returns The error to throw.
 */
export function toolNotConfigured(slug: string): ConflictError {
  return new ConflictError(
    RESEARCH_TOOL_ERRORS.toolNotConfigured,
    "This workspace has not configured that research tool. Enable it in Research settings.",
    { tool: slug },
  );
}

/**
 * `409` — the investigation is not running.
 *
 * @param investigation - Its display id.
 * @param status - Its status.
 * @returns The error to throw.
 */
export function investigationNotRunning(investigation: string, status: string): ConflictError {
  return new ConflictError(
    RESEARCH_TOOL_ERRORS.investigationNotRunning,
    "Only a running investigation can call research tools.",
    { investigation, status },
  );
}

/**
 * `409` — no operations or tokens remain.
 *
 * @param investigation - Its display id.
 * @param budget - What the caller said remained.
 * @returns The error to throw.
 */
export function budgetExhausted(
  investigation: string,
  budget: { readonly operations: number; readonly tokens: number | null },
): ConflictError {
  return new ConflictError(
    RESEARCH_TOOL_ERRORS.budgetExhausted,
    "The investigation's research budget is spent.",
    { investigation, operations: budget.operations, tokens: budget.tokens },
  );
}

/**
 * `502` — the tool failed, classified.
 *
 * @param slug - The tool.
 * @param operation - The operation.
 * @param error - The adapter's classified failure.
 * @returns The error to throw — `details` carries the class, its surface state, whether a retry
 *   can help, the wait the upstream asked for, and the adapter's detail.
 */
export function toolFailed(
  slug: string,
  operation: string,
  error: ResearchToolError,
): UpstreamError {
  return new UpstreamError(RESEARCH_TOOL_ERRORS.toolFailed, "The research tool failed.", {
    tool: slug,
    operation,
    errorClass: error.errorClass,
    surfaceState: TOOL_ERROR_SURFACES[error.errorClass],
    retryable: TOOL_ERROR_RETRYABLE[error.errorClass],
    retryAfterSeconds: error.retryAfterSeconds,
    detail: error.detail,
  });
}

/**
 * `502` — the tool answered outside the contract: no sources, a malformed one, a non-classified
 * exception, or more tokens than it was allowed.
 *
 * @param slug - The tool.
 * @param operation - The operation.
 * @param violations - What was wrong, one sentence each.
 * @returns The error to throw.
 */
export function contractViolation(
  slug: string,
  operation: string,
  violations: readonly string[],
): UpstreamError {
  return new UpstreamError(
    RESEARCH_TOOL_ERRORS.contractViolation,
    "The research tool answered outside the citation contract.",
    { tool: slug, operation, violations: [...violations] },
  );
}
