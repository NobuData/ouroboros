/**
 * One research tool operation, end to end — the service behind
 * `POST /internal/research/tools/:slug/:op`.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). The engine's investigation loop
 * (#620) calls tools only through here, so adapters and credentials stay in the control plane.
 * The checks run in a fixed order, and the order is part of the contract:
 *
 *   1. the investigation exists                      — 404 investigation_not_found
 *   2. it is running                                 — 409 investigation_not_running
 *   3. it enabled this tool                          — 403 research_tool_not_enabled
 *   4. this build has an adapter for the slug        — 501 research_tool_not_registered
 *   5. the adapter declares the operation, and the
 *      input is one that operation takes             — 422 research_tool_operation_unsupported
 *   6. the budget has an operation (and tokens) left — 409 research_budget_exhausted
 *   7. the workspace configured the tool, if its
 *      schema requires settings                      — 409 research_tool_not_configured
 *
 * Then the operation runs with the workspace's settings — **resolved from the investigation's
 * workspace, never from the request** — and its answer is held to the citation contract
 * (`research-tool.citations.ts`) before any source is archived: a classified failure is
 * `502 research_tool_failed` with its surface state; an answer with no sources, a malformed
 * source, more tokens than allowed or an unclassified exception is
 * `502 research_tool_contract_violation`. An accepted answer's sources land in the ledger at once
 * — progress is visible mid-run — and the response carries their cite numbers.
 *
 * **Budgets are the caller's, enforced here per call.** The loop owns an investigation's
 * remaining operations and tokens (its depth preset, #620) and sends them with each call; this
 * refuses a call with nothing left, hands the adapter the remaining tokens as its ceiling, and
 * answers what is left after the adapter's reported consumption.
 */

import { Injectable, Logger } from "@nestjs/common";

import { investigationNotFound } from "../research.errors";
import {
  TOOL_OPERATIONS,
  declaredOperations,
  supportsFetch,
  supportsQuery,
  supportsSearch,
  type ResearchToolAdapter,
  type SourceRecord,
  type ToolCallContext,
  type ToolOperation,
  type ToolResult,
} from "./research-tool.adapter";
import { resultViolations } from "./research-tool.citations";
import {
  budgetExhausted,
  contractViolation,
  investigationNotRunning,
  isResearchToolError,
  operationUnsupported,
  toolFailed,
  toolNotConfigured,
  toolNotEnabled,
} from "./research-tool.errors";
import { ResearchToolRegistry } from "./research-tool.registry";
import { ResearchToolRepository, type ArchivedSource } from "./research-tool.repository";
import { ResearchToolSettings } from "./research-tool.settings";

/** The caller's remaining budget for the investigation. */
export interface ToolBudget {
  /** Operations left; a call needs at least one. */
  readonly operations: number;
  /** Tokens left, or null when the investigation sets no token budget. */
  readonly tokens: number | null;
}

/** One operation request, as the engine sends it. */
export interface ToolInvocation {
  /** The investigation — the workspace is resolved from it. */
  readonly investigation: string;
  /** The operation's input: `{query, limit?}`, `{locator}`, or the structured query. */
  readonly input: Readonly<Record<string, unknown>>;
  readonly budget: ToolBudget;
}

/** One source in the answer — the ledger's numbering beside what the tool read. */
export interface InvokedSource extends SourceRecord {
  /** `source_records.id`. */
  readonly id: string;
  /** The `[07]`. */
  readonly citeNo: number;
  /** Whether the ledger already had it. */
  readonly deduplicated: boolean;
}

/** What one operation answers. */
export interface ToolInvocationResult {
  readonly tool: string;
  readonly operation: ToolOperation;
  /** `RS-127`. */
  readonly investigation: string;
  readonly payload: unknown;
  readonly sources: readonly InvokedSource[];
  /** What this call consumed — always one operation. */
  readonly usage: { readonly operations: 1; readonly tokens: number };
  /** What remains after it. */
  readonly budget: ToolBudget;
}

/** The default number of hits a search returns, and the most it may ask for. */
export const SEARCH_LIMIT = { default: 10, max: 50 } as const;

/** The longest search query accepted. */
export const QUERY_MAX_LENGTH = 2000;

@Injectable()
export class ResearchToolInvoker {
  private readonly logger = new Logger(ResearchToolInvoker.name);

  /**
   * @param registry - The adapters.
   * @param repository - Investigations and the ledger.
   * @param settings - Workspace settings and credentials, per tool.
   */
  constructor(
    private readonly registry: ResearchToolRegistry,
    private readonly repository: ResearchToolRepository,
    private readonly settings: ResearchToolSettings,
  ) {}

  /**
   * Run one operation for an investigation.
   *
   * @param slug - The tool.
   * @param operation - `search`, `fetch` or `query`.
   * @param request - The investigation, the input and the remaining budget.
   * @returns The payload, the archived sources with their cite numbers, and the budget left.
   * @throws {DomainError} One of the refusals in this file's header.
   */
  async invoke(
    slug: string,
    operation: string,
    request: ToolInvocation,
  ): Promise<ToolInvocationResult> {
    const investigation = await this.repository.findInvestigation(request.investigation);

    if (investigation === undefined) {
      throw investigationNotFound(request.investigation);
    }

    if (investigation.status !== "running") {
      throw investigationNotRunning(investigation.displayId, investigation.status);
    }

    if (!investigation.tools.includes(slug)) {
      throw toolNotEnabled(slug, investigation.displayId, investigation.tools);
    }

    const tool = this.registry.get(slug);
    const supported = declaredOperations(tool);

    if (!isOperation(operation) || !supported.includes(operation)) {
      throw operationUnsupported(slug, operation, supported);
    }

    const inputProblem = inputViolation(operation, request.input);

    if (inputProblem !== null) {
      throw operationUnsupported(slug, operation, supported, inputProblem);
    }

    const { budget } = request;

    if (budget.operations < 1 || budget.tokens === 0) {
      throw budgetExhausted(investigation.displayId, budget);
    }

    const opened = await this.settings.settingsFor(investigation.organizationId, slug);

    if (opened === null && tool.configSchema().required.length > 0) {
      throw toolNotConfigured(slug);
    }

    const context: ToolCallContext = {
      organizationId: investigation.organizationId,
      investigationId: investigation.id,
      config: opened?.config ?? {},
      secret: opened?.secret ?? null,
      tokenCeiling: budget.tokens,
    };

    const result = await this.run(tool, operation, context, request.input);
    const archived = await this.repository.archiveSources(investigation.id, slug, result.sources);

    return {
      tool: slug,
      operation,
      investigation: investigation.displayId,
      payload: result.payload,
      sources: result.sources.map((source, index) => withLedger(source, archived[index])),
      usage: { operations: 1, tokens: result.usage.tokens },
      budget: {
        operations: budget.operations - 1,
        tokens: budget.tokens === null ? null : budget.tokens - result.usage.tokens,
      },
    };
  }

  /**
   * Call the adapter and hold its answer to the contract.
   *
   * @param tool - The adapter.
   * @param operation - A declared operation.
   * @param context - The call's context.
   * @param input - The validated input.
   * @returns The accepted result.
   * @throws {UpstreamError} `research_tool_failed` or `research_tool_contract_violation`.
   */
  private async run(
    tool: ResearchToolAdapter,
    operation: ToolOperation,
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    let result: unknown;

    try {
      result = await callOperation(tool, operation, context, input);
    } catch (error) {
      if (isResearchToolError(error)) {
        throw toolFailed(tool.slug, operation, error);
      }

      // Not the error message: an unclassified exception from somebody's adapter may quote a
      // request — headers and all — and this answer goes to the engine.
      this.logger.warn(
        `Research tool "${tool.slug}" threw an unclassified ${error instanceof Error ? error.name : typeof error} from ${operation}`,
      );
      throw contractViolation(tool.slug, operation, [
        "the operation threw an unclassified error — adapters throw ResearchToolError",
      ]);
    }

    const violations = resultViolations(result, context.tokenCeiling);

    if (violations.length > 0) {
      throw contractViolation(tool.slug, operation, violations);
    }

    return result as ToolResult;
  }
}

/**
 * @param candidate - The `:op` path segment.
 * @returns Whether it names one of the three operations.
 */
function isOperation(candidate: string): candidate is ToolOperation {
  return (TOOL_OPERATIONS as readonly string[]).includes(candidate);
}

/**
 * What is wrong with an operation's input, if anything.
 *
 * @param operation - The operation.
 * @param input - The request's `input`.
 * @returns A sentence, or null when the input is acceptable.
 */
export function inputViolation(
  operation: ToolOperation,
  input: Readonly<Record<string, unknown>>,
): string | null {
  const keys = Object.keys(input);

  switch (operation) {
    case "search": {
      const unknown = keys.filter((key) => key !== "query" && key !== "limit");
      const query = input.query;
      const limit = input.limit;

      if (unknown.length > 0) {
        return `search takes {query, limit?}; unexpected: ${unknown.join(", ")}`;
      }
      if (typeof query !== "string" || query.trim() === "" || query.length > QUERY_MAX_LENGTH) {
        return `query must be a non-blank string of at most ${QUERY_MAX_LENGTH.toString()} characters`;
      }
      if (
        limit !== undefined &&
        (typeof limit !== "number" ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > SEARCH_LIMIT.max)
      ) {
        return `limit must be an integer from 1 to ${SEARCH_LIMIT.max.toString()}`;
      }
      return null;
    }
    case "fetch": {
      const locator = input.locator;

      if (keys.some((key) => key !== "locator")) {
        return "fetch takes {locator}";
      }
      if (typeof locator !== "string" || locator.trim() === "" || locator.length > 2048) {
        return "locator must be a non-blank string of at most 2048 characters";
      }
      return null;
    }
    case "query":
      return keys.length === 0 ? "query takes a non-empty structured object" : null;
  }
}

/**
 * Dispatch to the adapter's member — through the capability guards, so there is no path to a
 * member the adapter did not declare.
 *
 * @param tool - The adapter.
 * @param operation - A declared operation.
 * @param context - The call's context.
 * @param input - The validated input.
 * @returns Whatever the adapter resolved to — checked by the caller.
 */
function callOperation(
  tool: ResearchToolAdapter,
  operation: ToolOperation,
  context: ToolCallContext,
  input: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  if (operation === "search" && supportsSearch(tool)) {
    const limit = typeof input.limit === "number" ? input.limit : SEARCH_LIMIT.default;

    return tool.search(context, input.query as string, { limit });
  }
  if (operation === "fetch" && supportsFetch(tool)) {
    return tool.fetch(context, input.locator as string);
  }
  if (operation === "query" && supportsQuery(tool)) {
    return tool.query(context, input);
  }

  // Unreachable: the operation was checked against the declared flags before this was called.
  return Promise.reject(new Error(`"${tool.slug}" does not declare ${operation}`));
}

/**
 * A source with the ledger's numbering beside it.
 *
 * @param source - What the tool read.
 * @param archived - Its ledger row.
 * @returns The answer's source entry.
 */
function withLedger(source: SourceRecord, archived: ArchivedSource): InvokedSource {
  return {
    ...source,
    id: archived.id,
    citeNo: archived.citeNo,
    deduplicated: archived.deduplicated,
  };
}
