/**
 * `ResearchToolAdapter` — the one interface core code is allowed to know about a research tool.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)), roadmap decisions **V2**
 * (pluggable tools) and **V3** (every claim cited).
 *
 * ```
 * interface ResearchToolAdapter
 *   slug · displayMeta() · counts() · configSchema() · capabilities() · healthCheck()
 *   search(q, opts) │ fetch(locator) │ query(structured)   — gated by capabilities()
 *       ─▶ { payload, sources: SourceRecord[], usage }       // citations are the return type
 *
 * core ──imports──▶ this file only        tools/adapters/{fake, web, competitor, …}
 * ```
 *
 * This is the third application of the SPI discipline the ticket-source (#139) and model
 * provider (#216) interfaces set: a registry keyed by slug (`research-tool.registry.ts`), a
 * dependency-cruiser boundary so core code imports this file and never an adapter, and a
 * conformance kit every adapter must pass (`conformance.fixture.ts`).
 *
 * ---------------------------------------------------------------------------
 * **Citations are a return type, not a convention.** Every operation answers
 * {@link ToolResult} — its payload *and* the {@link SourceRecord}s it read, in the citation
 * ledger's shape (V108, #609). An operation that returns data with no sources fails
 * conformance, and the internal surface refuses it at run time too, so evidence accumulates
 * as a consequence of doing the work rather than as a step somebody can forget.
 *
 * **Capabilities gate members, as `pull` does for model providers.** {@link ResearchToolAdapter}
 * declares no operation at all; an adapter that searches implements {@link SearchCapableTool},
 * and a caller reaches `search` only through {@link supportsSearch} (or the registry, which
 * checks the same flag). The flag and the member must agree — the registry refuses to boot on a
 * disagreement and the conformance kit asserts it in both directions. `watch` has no member here:
 * it promises that the tool keeps a schedule of its own (the competitor tracker, #616), which the
 * card and the enable flow read.
 *
 * **Credentials stay in the control plane.** An operation is handed its configuration and
 * credential for the length of one call, in a {@link ToolCallContext} the caller assembles. The
 * engine never sees either: it calls `/internal/research/tools/:slug/:op`, and that surface
 * resolves both from the investigation's workspace.
 */

import type { ResearchToolConfig, ResearchToolConfigSchema } from "./research-tool.config";
import type { ToolHealth } from "./research-tool.health";

/** The kinds of source a ledger row can be — V108's `source_records_kind` CHECK. */
export const SOURCE_RECORD_KINDS = [
  "web",
  "competitor_diff",
  "code",
  "ticket",
  "telemetry",
  "doc",
] as const;

/** One of {@link SOURCE_RECORD_KINDS}. */
export type SourceRecordKind = (typeof SOURCE_RECORD_KINDS)[number];

/**
 * One source an operation read — a citation-ledger row before it is archived.
 *
 * The fields are V108's `source_records` columns in camelCase; the ledger adds the investigation,
 * the tool slug and the cite number when the internal surface archives it.
 */
export interface SourceRecord {
  /** What kind of source it is. */
  readonly kind: SourceRecordKind;
  /** The sources panel's title — *Skylink S4 docking module — teardown & sensor BOM*. ≤ 300 chars. */
  readonly title: string;
  /**
   * Where it came from: an `http(s)` URL, or an internal URI with the same standing
   * (`issue-index://`, `git://repo@sha/path#L…`, `telemetry://metric/window`) — validated per
   * kind exactly as V108's `source_locator_valid()` does.
   */
  readonly locator: string;
  /** When it was read — an ISO-8601 timestamp. */
  readonly retrievedAt: string;
  /** `sha256:<64 hex>` of everything that was read, so the archive is provably unedited. */
  readonly contentHash: string;
  /** The passage a claim may lean on — non-blank, at most 4 096 bytes. */
  readonly excerpt: string;
  /** Whatever makes the citation reproducible — query, window, selector. An object ≤ 8 KiB. */
  readonly meta: Readonly<Record<string, unknown>>;
  /**
   * The competitor snapshot whose diff a `competitor_diff` source cites (V112, #610) — required
   * for that kind and absent for every other.
   */
  readonly snapshotId?: string;
}

/** What an operation consumed, as the adapter reports it. The caller counts operations itself. */
export interface ToolUsage {
  /** Model tokens the operation spent (an LLM-backed extractor, say); `0` when none. */
  readonly tokens: number;
}

/**
 * What every operation answers: its payload, the sources it read, and what it consumed.
 *
 * @typeParam P - The operation's payload — a JSON value the engine loop reads.
 */
export interface ToolResult<P = unknown> {
  /**
   * The operation's answer — search hits, a fetched document, query rows — or `null` for an
   * empty answer (a search with no hits), the one case that may come with no sources.
   */
  readonly payload: P;
  /** The sources the payload came from. Never empty when the payload is not null. */
  readonly sources: readonly SourceRecord[];
  /** What the operation consumed. */
  readonly usage: ToolUsage;
}

/**
 * Everything one call is handed — assembled by the caller, never by the adapter.
 *
 * Deliberately not a database row: an adapter has no business reading the investigation, the
 * sealed credential column or another workspace's settings.
 */
export interface ToolCallContext {
  /** The workspace the call is for — for an adapter whose data is per workspace. */
  readonly organizationId: string;
  /** The investigation the sources will be archived under. */
  readonly investigationId: string;
  /** The workspace's configuration of this tool, in its own schema's vocabulary. */
  readonly config: ResearchToolConfig;
  /** The opened credential, or null for a tool that needs none. Held for this call only. */
  readonly secret: string | null;
  /**
   * The most tokens this call may spend, or null when the investigation sets no token budget.
   * An adapter that cannot stay inside it should not start; one that reports more fails
   * conformance.
   */
  readonly tokenCeiling: number | null;
}

/** Options a search takes. */
export interface SearchOptions {
  /** The most hits to return — the caller's bound, which an adapter may undercut. 1–50. */
  readonly limit: number;
}

/**
 * The tools card's row — glyph, name and sub-line.
 *
 * The sub-line is a **template** whose `{slot}`s are filled from {@link ResearchToolAdapter.counts}:
 * mockup 22's `{rivals} rivals watched · release notes, changelogs, filings`. A tool with nothing
 * to count has a template with no slots.
 */
export interface ToolDisplayMeta {
  /** *Competitor tracker*. */
  readonly name: string;
  /** One character — `⌖`. */
  readonly glyph: string;
  /** The sub-line template — `{rivals} rivals watched · release notes, changelogs, filings`. */
  readonly subLine: string;
}

/** What a tool can do, as four flags. A total shape: `false` is an answer. */
export interface ToolCapabilities {
  /** Implements {@link SearchCapableTool}. */
  readonly search: boolean;
  /** Implements {@link FetchCapableTool}. */
  readonly fetch: boolean;
  /** Implements {@link QueryCapableTool}. */
  readonly query: boolean;
  /** Keeps a watch schedule of its own (#616). No member — see the header. */
  readonly watch: boolean;
}

/** The three operations, by name — the `:op` of the internal surface. */
export const TOOL_OPERATIONS = ["search", "fetch", "query"] as const;

/** One of {@link TOOL_OPERATIONS}. */
export type ToolOperation = (typeof TOOL_OPERATIONS)[number];

/** The SPI. Everything core code may know about a research tool. */
export interface ResearchToolAdapter {
  /**
   * The registry key — a `research_tools` slug (V106): `web`, `competitor`, `code`, `tickets`,
   * `telemetry`, `docs`, or one an organisation registers.
   */
  readonly slug: string;

  /** @returns The card's row. Stable and fresh, like every schema-like answer here. */
  displayMeta(): ToolDisplayMeta;

  /**
   * The live numbers the sub-line's slots name.
   *
   * @param organizationId - The workspace whose card is being drawn.
   * @param config - Its configuration of this tool, or null when it has none.
   * @returns One entry per slot in {@link ToolDisplayMeta.subLine} — a count, or null when it
   *   cannot be known right now (rendered as an em dash). Never rejects.
   */
  counts(
    organizationId: string,
    config: ResearchToolConfig | null,
  ): Promise<Readonly<Record<string, number | null>>>;

  /**
   * The workspace-level configuration this tool needs — keys, endpoints, scope.
   *
   * @returns A schema in the ticket-source form dialect (`research-tool.config.ts`), which the
   *   enable flow (#629) renders with no tool-specific code. Stable and fresh.
   */
  configSchema(): ResearchToolConfigSchema;

  /** @returns The four flags. Stable. */
  capabilities(): ToolCapabilities;

  /**
   * Whether this workspace's configuration of the tool works — the card's dot.
   *
   * @param config - The configuration, or null when the workspace has not configured the tool;
   *   the answer is then `not_configured` (the idle dot), without a network call.
   * @param secret - The opened credential, or null.
   * @returns The state and a short detail. **Never rejects** — a refusal or a timeout is a
   *   `down` result, because a dot's colour must not depend on somebody's control flow.
   */
  healthCheck(config: ResearchToolConfig | null, secret: string | null): Promise<ToolHealth>;

  /**
   * What one operation costs under a configuration, for the scope estimate (#622) — declared
   * only by a tool that can be pointed at a paid API.
   *
   * @param config - The workspace's configuration, or null when it has stored none.
   * @returns List price in cents per operation, or null when this configuration is unpriced
   *   (self-hosted, or a provider that publishes no per-operation price). Absent means the tool
   *   never charges.
   */
  operationPriceCents?(config: ResearchToolConfig | null): number | null;
}

/** A tool that searches. */
export interface SearchCapableTool extends ResearchToolAdapter {
  /** @returns The flags, with `search` narrowed to `true`. */
  capabilities(): ToolCapabilities & { readonly search: true };

  /**
   * Search for a query.
   *
   * @param context - The call's workspace, investigation, configuration and ceiling.
   * @param query - What to look for; non-blank.
   * @param options - The caller's bounds.
   * @returns The hits and the sources they came from.
   * @throws {import("./research-tool.errors").ResearchToolError} For any failure, classified.
   */
  search(context: ToolCallContext, query: string, options: SearchOptions): Promise<ToolResult>;
}

/** A tool that fetches one thing by locator. */
export interface FetchCapableTool extends ResearchToolAdapter {
  /** @returns The flags, with `fetch` narrowed to `true`. */
  capabilities(): ToolCapabilities & { readonly fetch: true };

  /**
   * Fetch one document.
   *
   * @param context - The call's workspace, investigation, configuration and ceiling.
   * @param locator - What to fetch — a URL or an internal URI the tool understands.
   * @returns The document and the source record that archives it.
   * @throws {import("./research-tool.errors").ResearchToolError} For any failure, classified;
   *   `robots_denied` when the site forbids it.
   */
  fetch(context: ToolCallContext, locator: string): Promise<ToolResult>;
}

/** A tool that answers a structured query. */
export interface QueryCapableTool extends ResearchToolAdapter {
  /** @returns The flags, with `query` narrowed to `true`. */
  capabilities(): ToolCapabilities & { readonly query: true };

  /**
   * Answer a structured query — `{op: "blame", path, line}` for code mining, say.
   *
   * @param context - The call's workspace, investigation, configuration and ceiling.
   * @param structured - The query, in the tool's own documented shape.
   * @returns The answer and its sources.
   * @throws {import("./research-tool.errors").ResearchToolError} For any failure, classified.
   */
  query(
    context: ToolCallContext,
    structured: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult>;
}

/**
 * Whether a tool searches — and, for the compiler, that its `search` is there.
 *
 * @param tool - Any tool.
 * @returns `true` when it declares the capability.
 */
export function supportsSearch(tool: ResearchToolAdapter): tool is SearchCapableTool {
  return tool.capabilities().search;
}

/**
 * Whether a tool fetches.
 *
 * @param tool - Any tool.
 * @returns `true` when it declares the capability.
 */
export function supportsFetch(tool: ResearchToolAdapter): tool is FetchCapableTool {
  return tool.capabilities().fetch;
}

/**
 * Whether a tool answers structured queries.
 *
 * @param tool - Any tool.
 * @returns `true` when it declares the capability.
 */
export function supportsQuery(tool: ResearchToolAdapter): tool is QueryCapableTool {
  return tool.capabilities().query;
}

/**
 * The operations a tool declares, in {@link TOOL_OPERATIONS} order.
 *
 * @param tool - Any tool.
 * @returns The operation names it supports.
 */
export function declaredOperations(tool: ResearchToolAdapter): ToolOperation[] {
  const flags = tool.capabilities();

  return TOOL_OPERATIONS.filter((operation) => flags[operation]);
}

/**
 * The member behind an operation, read without the type system's help.
 *
 * The one place that looks past the interface — the registry's flag/member consistency check
 * and the conformance kit need to know whether the member is *there*, which the interface is
 * designed to make unaskable.
 *
 * @param tool - Any tool.
 * @param operation - The operation.
 * @returns Whatever is at that member — a function for a conforming capable tool.
 */
export function operationMemberOf(tool: ResearchToolAdapter, operation: ToolOperation): unknown {
  return (tool as unknown as Record<string, unknown>)[operation];
}
