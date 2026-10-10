/**
 * The issue & PR history index — mockup 22's fourth tool row (CL.5,
 * [#618](https://github.com/NobuData/ouroboros/issues/618); decision V2).
 *
 * ```
 * ▤ Issue & PR history index    3,412 issues · support tickets · churn interviews    ●
 * ```
 *
 * The workspace's institutional memory — canonical tickets, mirrored PRs and imported document
 * sets — searched with PostgreSQL full-text and cited as `issue-index://` sources. One capability,
 * `query`, with three operations:
 *
 * ```
 * {op: "search", q, kinds?, labels?, since?, until?, repo?, set?, limit?}   ranked hits with excerpts
 * {op: "get", ref}                                                          one entry, by locator
 * {op: "aggregate", groupBy: "label" | "period" | "kind" | "repo" | "set",   counts — what a roadmap
 *    period?, q?, windowDays?, kinds?, labels?, since?, until?, repo?, set?}  investigation opens with
 * ```
 *
 * **Tracker-agnostic by construction.** The tool reads `history_index_entries` (V119) and nothing
 * else: which tracker fed a ticket is not in the view, so it cannot be in an answer. A workspace
 * that moves from GitHub to Jira changes nothing here.
 *
 * **A declared latency budget.** Every read runs under a {@link SEARCH_BUDGET_MS} statement
 * timeout; an index that cannot answer inside it fails `upstream`, it does not stall the loop.
 *
 * Every answer is cited (`history-index.sources.ts`): each hit, entry and aggregate's leading
 * buckets' newest entries, as `ticket` sources. An answer with nothing in it is `null`.
 */

import type { HistoryIndexKind } from "../../../../db/schema";
import {
  AGGREGATE_GROUPS,
  AGGREGATE_PERIODS,
  MAX_BUCKETS,
  type AggregateGroup,
  type AggregatePeriod,
  type HistoryIndexRepository,
  type IndexEntry,
  type IndexFilters,
  type IndexSummary,
} from "../../../history/history-index.repository";
import { entrySource } from "../../../history/history-index.sources";
import type {
  QueryCapableTool,
  SourceRecord,
  SubLineValue,
  ToolCallContext,
  ToolCapabilities,
  ToolDisplayMeta,
  ToolResult,
} from "../../research-tool.adapter";
import type { ResearchToolConfig, ResearchToolConfigSchema } from "../../research-tool.config";
import { ResearchToolError } from "../../research-tool.errors";
import { NOT_CONFIGURED_HEALTH, type ToolHealth } from "../../research-tool.health";

/** The registry slug — V106's seeded `tickets` row. */
export const TICKETS_TOOL_SLUG = "tickets";

/** The operations `query` answers. */
export const TICKETS_OPERATIONS = ["search", "get", "aggregate"] as const;

/**
 * The tool's declared latency budget, in milliseconds: the longest any one statement of a
 * search, lookup or aggregate may run before it is cancelled.
 */
export const SEARCH_BUDGET_MS = 500;

/** How many hits a search answers when the call names no limit, and the most it may. */
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;

/** The longest query, in characters. */
export const MAX_QUERY_CHARS = 500;

/** The most labels one filter names. */
export const MAX_FILTER_LABELS = 20;

/** The look-backs a workspace may choose as `aggregate`'s default, in days. */
export const WINDOW_CHOICES = ["30", "90", "180", "365"] as const;

/** `aggregate`'s window when neither the call nor the workspace names one — the diagram's `90d`. */
export const DEFAULT_WINDOW_DAYS = 90;

/** The longest window, in days — ten years. */
export const MAX_WINDOW_DAYS = 3650;

/** How many leading buckets an aggregate cites, and by how many entries each. */
export const CITED_BUCKETS = 8;
export const CITED_PER_BUCKET = 3;

/** How much of an entry's body `get` returns, in characters. */
export const MAX_BODY_CHARS = 20000;

/** How many imported sets the sub-line names before it counts them instead. */
const NAMED_SETS = 2;

/** The kinds a filter may name. */
const ENTRY_KINDS: readonly HistoryIndexKind[] = ["ticket", "pr", "document_set", "document"];

/** A locator this index answers — V108's `ticket` rule, the `issue-index://` half. */
const LOCATOR = /^issue-index:\/\/[a-z0-9][a-z0-9_-]*(\/[A-Za-z0-9._#-]+)+$/;

/** What the tool reads through. */
export type HistoryIndexStore = Pick<
  HistoryIndexRepository,
  "search" | "get" | "aggregate" | "summary"
>;

/** An entry, as a payload carries it. */
export interface EntryPayload {
  readonly locator: string;
  readonly kind: HistoryIndexKind;
  /** Where it came from: a source's slug, or `<collection>/<name>`. */
  readonly set: string;
  readonly ref: string;
  readonly title: string;
  readonly state: string | null;
  readonly labels: readonly string[];
  readonly author: string | null;
  readonly repo: string | null;
  readonly url: string | null;
  readonly occurredAt: string;
}

export class TicketsResearchTool implements QueryCapableTool {
  readonly slug = TICKETS_TOOL_SLUG;

  /**
   * @param store - The index.
   * @param now - The clock, for windows and `retrievedAt`.
   */
  constructor(
    private readonly store: HistoryIndexStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  displayMeta(): ToolDisplayMeta {
    return {
      name: "Issue & PR history index",
      glyph: "▤",
      subLine: "{issues} · {prs} · {imports}",
    };
  }

  /**
   * The sub-line, counted from the index.
   *
   * @param organizationId - The workspace.
   * @returns `issues` (`3,412 issues`), `prs` (`12 pull requests`) and `imports` (the imported
   *   sets by title, their count past two, or `no imported sets`); nulls when the index cannot
   *   be read. Never rejects.
   */
  async counts(organizationId: string): Promise<Readonly<Record<string, SubLineValue>>> {
    try {
      return subLineOf(await this.store.summary(organizationId));
    } catch {
      return { issues: null, prs: null, imports: null };
    }
  }

  /**
   * One setting — `aggregate`'s default look-back. The corpus is the workspace's ticket sources,
   * its mirrored PRs and the document sets an owner imports; none is configured here.
   *
   * @returns The form.
   */
  configSchema(): ResearchToolConfigSchema {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title: "Issue & PR history index",
      properties: {
        windowDays: {
          type: "string",
          title: "Default aggregate window",
          description:
            "How many days back an investigation counts when it names no window. The tool reads this workspace's ticket sources, its pull requests and its imported document sets.",
          enum: [...WINDOW_CHOICES],
          default: String(DEFAULT_WINDOW_DAYS),
        },
      },
      required: [],
      additionalProperties: false,
    };
  }

  capabilities(): ToolCapabilities & { readonly query: true } {
    return { search: false, fetch: false, query: true, watch: false };
  }

  /**
   * Whether the index holds anything and answers.
   *
   * @param config - The configuration, or null when the workspace has not enabled the tool.
   * @param _secret - Unused: the index is the workspace's own data.
   * @param organizationId - The workspace whose index is counted.
   * @returns `healthy` with what is indexed; `not_configured` for an empty index; `degraded` when
   *   no workspace is named; `down` when the index cannot be read. Never rejects.
   */
  async healthCheck(
    config: ResearchToolConfig | null,
    _secret: string | null,
    organizationId?: string,
  ): Promise<ToolHealth> {
    if (config === null) return NOT_CONFIGURED_HEALTH;
    if (organizationId === undefined) {
      return { state: "degraded", detail: "no workspace named — index size unknown" };
    }

    try {
      const summary = await this.store.summary(organizationId);
      if (summary.tickets + summary.pullRequests + summary.documents === 0) {
        return {
          state: "not_configured",
          detail: "nothing indexed yet — connect a ticket source or import a document set",
        };
      }
      const line = subLineOf(summary);

      return { state: "healthy", detail: `${line.issues} · ${line.prs} · ${line.imports}` };
    } catch {
      return { state: "down", detail: "the history index could not be read" };
    }
  }

  /**
   * One operation — see this file's header.
   *
   * @param context - The call.
   * @param structured - `{op, …}`.
   * @returns The answer and its citations; a `null` payload when nothing matches.
   * @throws {ResearchToolError} `unsupported` for an unknown op or a malformed input; `network`
   *   when the database could not be reached; `upstream` when the index did not answer inside
   *   its budget, or failed.
   */
  async query(
    context: ToolCallContext,
    structured: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const op = structured.op;

    // The private members below are not named `search` or `fetch`: the registry reads a member by
    // that name as the SPI operation, and this tool declares `query` alone.

    switch (op) {
      case "search":
        return this.searchIndex(context, structured);
      case "get":
        return this.getEntry(context, structured);
      case "aggregate":
        return this.aggregateIndex(context, structured);
      default:
        throw new ResearchToolError(
          "unsupported",
          `the history index answers {op: ${TICKETS_OPERATIONS.map((name) => `"${name}"`).join(" | ")}}`,
        );
    }
  }

  private async searchIndex(
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const q = queryText(input.q, true);
    const filters = filtersOf(input, this.now());
    const limit = limitOf(input.limit);
    const hits = await indexed(() =>
      this.store.search(context.organizationId, q, filters, limit, SEARCH_BUDGET_MS),
    );

    if (hits.length === 0) return { payload: null, sources: [], usage: { tokens: 0 } };

    const retrievedAt = this.now();
    const asked = { op: "search", q, ...describe(filters) };

    return {
      payload: {
        op: "search",
        q,
        filters: describe(filters),
        hits: hits.map((hit) => ({
          ...entryPayload(hit),
          rank: Math.round(hit.rank * 1000) / 1000,
          matchedEveryTerm: hit.complete,
          excerpt: hit.excerpt,
        })),
      },
      sources: hits.map((hit) => entrySource(hit, retrievedAt, hit.excerpt, { query: asked })),
      usage: { tokens: 0 },
    };
  }

  private async getEntry(
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const ref = input.ref;
    if (typeof ref !== "string" || ref.length > 2048 || !LOCATOR.test(ref)) {
      throw new ResearchToolError(
        "unsupported",
        'get() takes an index locator — {ref: "issue-index://support/churn-2026-q2"}',
      );
    }

    const entries = await indexed(() =>
      this.store.get(context.organizationId, ref, SEARCH_BUDGET_MS),
    );
    if (entries.length === 0) return { payload: null, sources: [], usage: { tokens: 0 } };

    const retrievedAt = this.now();

    return {
      payload: {
        op: "get",
        ref,
        entries: entries.map((entry) => ({
          ...entryPayload(entry),
          body:
            entry.body === null || entry.body.length <= MAX_BODY_CHARS
              ? entry.body
              : `${entry.body.slice(0, MAX_BODY_CHARS)}…`,
          meta: entry.meta,
        })),
      },
      sources: entries.map((entry) =>
        entrySource(entry, retrievedAt, null, { query: { op: "get" } }),
      ),
      usage: { tokens: 0 },
    };
  }

  private async aggregateIndex(
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const groupBy = oneOf<AggregateGroup>(input.groupBy, AGGREGATE_GROUPS, "groupBy");
    const period =
      input.period === undefined
        ? "week"
        : oneOf<AggregatePeriod>(input.period, AGGREGATE_PERIODS, "period");
    const q = input.q === undefined || input.q === null ? null : queryText(input.q, false);
    const now = this.now();
    const named = filtersOf(input, now);

    // A window is a look-back from now; an explicit `since` says the same thing more exactly.
    if (input.windowDays !== undefined && named.since !== undefined) {
      throw new ResearchToolError(
        "unsupported",
        "name a window with windowDays or since, not both",
      );
    }
    const since =
      named.since ??
      new Date(now.getTime() - windowOf(input.windowDays, context.config) * 86_400_000);
    const until = named.until ?? now;
    const filters: IndexFilters = { ...named, since, until };

    const result = await indexed(() =>
      this.store.aggregate(
        context.organizationId,
        {
          groupBy,
          period,
          q,
          filters,
          citedBuckets: CITED_BUCKETS,
          citedPerBucket: CITED_PER_BUCKET,
        },
        SEARCH_BUDGET_MS,
      ),
    );

    if (result.total === 0 || result.buckets.length === 0) {
      return { payload: null, sources: [], usage: { tokens: 0 } };
    }

    const asked = {
      op: "aggregate",
      groupBy,
      ...(groupBy === "period" ? { period } : {}),
      ...(q === null ? {} : { q }),
      ...describe(filters),
    };
    const counts = new Map(result.buckets.map((bucket) => [bucket.key, bucket.count]));

    // An entry with two labels can be evidence for two buckets: cite it once, naming both.
    const cited = new Map<string, { entry: IndexEntry; buckets: Record<string, number> }>();
    for (const { bucket, ...entry } of result.evidence) {
      const seen = cited.get(entry.locator) ?? { entry, buckets: {} };
      seen.buckets[bucket] = counts.get(bucket) ?? 0;
      cited.set(entry.locator, seen);
    }
    const sources: SourceRecord[] = [...cited.values()].map(({ entry, buckets }) =>
      entrySource(entry, now, null, { query: asked, buckets }),
    );

    return {
      payload: {
        op: "aggregate",
        groupBy,
        period: groupBy === "period" ? period : null,
        q,
        filters: describe(filters),
        window: { since: since.toISOString(), until: until.toISOString() },
        total: result.total,
        buckets: result.buckets,
        truncated: result.buckets.length === MAX_BUCKETS,
      },
      sources,
      usage: { tokens: 0 },
    };
  }
}

/**
 * The sub-line's three phrases.
 *
 * @param summary - What the index holds.
 * @returns `issues`, `prs` and `imports`.
 */
export function subLineOf(summary: IndexSummary): {
  issues: string;
  prs: string;
  imports: string;
} {
  const counted = (count: number, one: string, many: string): string =>
    `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

  return {
    issues: counted(summary.tickets, "issue", "issues"),
    prs: counted(summary.pullRequests, "pull request", "pull requests"),
    imports:
      summary.sets.length === 0
        ? "no imported sets"
        : summary.sets.length > NAMED_SETS
          ? `${summary.sets.length.toLocaleString("en-US")} imported sets`
          : summary.sets.map((title) => title.slice(0, 60)).join(", "),
  };
}

function entryPayload(entry: IndexEntry): EntryPayload {
  return {
    locator: entry.locator,
    kind: entry.kind,
    set: entry.setKey,
    ref: entry.ref,
    title: entry.title,
    state: entry.state,
    labels: entry.labels,
    author: entry.author,
    repo: entry.repo,
    url: entry.url,
    occurredAt: entry.occurredAt.toISOString(),
  };
}

/** The socket-level failures that mean the database could not be reached at all. */
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01",
]);

/** PostgreSQL's `query_canceled` — what a statement timeout raises. */
const QUERY_CANCELED = "57014";

/**
 * Read the index, with a failure classified as the SPI requires.
 *
 * @param read - The read.
 * @returns What it answered.
 * @throws {ResearchToolError} `network` when the database could not be reached; `upstream` when
 *   the read outlived its budget, or for any other failure — never an unclassified error.
 */
async function indexed<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    if (typeof code === "string" && UNREACHABLE.has(code)) {
      throw new ResearchToolError("network", "the history index could not be reached");
    }
    if (code === QUERY_CANCELED) {
      throw new ResearchToolError(
        "upstream",
        `the history index did not answer within its ${String(SEARCH_BUDGET_MS)} ms budget`,
      );
    }
    throw new ResearchToolError("upstream", "the history index could not be read");
  }
}

/**
 * The filters a call names.
 *
 * @param input - The call.
 * @param now - The clock — a `since` in the future is refused.
 * @returns The filters; a field the call does not name is absent.
 * @throws {ResearchToolError} `unsupported` for a malformed filter.
 */
function filtersOf(input: Readonly<Record<string, unknown>>, now: Date): IndexFilters {
  const kinds =
    input.kinds === undefined
      ? undefined
      : list(input.kinds, "kinds", ENTRY_KINDS.length).map((kind) =>
          oneOf<HistoryIndexKind>(kind, ENTRY_KINDS, "kinds"),
        );
  const labels =
    input.labels === undefined ? undefined : list(input.labels, "labels", MAX_FILTER_LABELS);
  const since = instant(input.since, "since");
  const until = instant(input.until, "until");

  if (since !== undefined && since.getTime() > now.getTime()) {
    throw new ResearchToolError("unsupported", "since is in the future");
  }
  if (since !== undefined && until !== undefined && until.getTime() <= since.getTime()) {
    throw new ResearchToolError("unsupported", "until must be after since");
  }

  return {
    ...(kinds === undefined ? {} : { kinds }),
    ...(labels === undefined ? {} : { labels }),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    ...(input.repo === undefined ? {} : { repo: short(input.repo, "repo") }),
    ...(input.set === undefined ? {} : { set: short(input.set, "set") }),
  };
}

/**
 * Filters as JSON — for the payload, and for a citation's meta.
 *
 * @param filters - The filters.
 * @returns The same, with instants as ISO-8601 text.
 */
function describe(filters: IndexFilters): Record<string, unknown> {
  return {
    ...(filters.kinds === undefined ? {} : { kinds: filters.kinds }),
    ...(filters.labels === undefined ? {} : { labels: filters.labels }),
    ...(filters.since === undefined ? {} : { since: filters.since.toISOString() }),
    ...(filters.until === undefined ? {} : { until: filters.until.toISOString() }),
    ...(filters.repo === undefined ? {} : { repo: filters.repo }),
    ...(filters.set === undefined ? {} : { set: filters.set }),
  };
}

function queryText(value: unknown, required: boolean): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_QUERY_CHARS) {
    throw new ResearchToolError(
      "unsupported",
      required
        ? `search() takes a query — {q: "docking abort"} — of at most ${String(MAX_QUERY_CHARS)} characters`
        : `q must be a non-empty string of at most ${String(MAX_QUERY_CHARS)} characters`,
    );
  }
  return value.trim();
}

function short(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200) {
    throw new ResearchToolError("unsupported", `${field} must be a non-empty string`);
  }
  return value.trim();
}

function list(value: unknown, field: string, most: number): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > most ||
    !value.every((item) => typeof item === "string" && item.trim() !== "" && item.length <= 255)
  ) {
    throw new ResearchToolError(
      "unsupported",
      `${field} must be a list of 1 to ${String(most)} non-empty strings`,
    );
  }
  return (value as string[]).map((item) => item.trim());
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (typeof value !== "string" || !(choices as readonly string[]).includes(value)) {
    throw new ResearchToolError(
      "unsupported",
      `${field} must be one of ${choices.map((choice) => `"${choice}"`).join(", ")}`,
    );
  }
  return value as T;
}

function instant(value: unknown, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const stamp =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? Date.parse(value) : NaN;
  if (Number.isNaN(stamp)) {
    throw new ResearchToolError(
      "unsupported",
      `${field} must be an ISO-8601 date or timestamp — "2026-07-01"`,
    );
  }
  return new Date(stamp);
}

function limitOf(value: unknown): number {
  if (value === undefined) return DEFAULT_SEARCH_LIMIT;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_SEARCH_LIMIT
  ) {
    throw new ResearchToolError(
      "unsupported",
      `limit must be a whole number from 1 to ${String(MAX_SEARCH_LIMIT)}`,
    );
  }
  return value;
}

/**
 * `aggregate`'s window.
 *
 * @param value - What the call named.
 * @param config - The workspace's configuration — its default.
 * @returns Days.
 * @throws {ResearchToolError} `unsupported` outside 1–3650.
 */
function windowOf(value: unknown, config: ResearchToolConfig): number {
  if (value === undefined) {
    const configured = config.windowDays;
    return typeof configured === "string" &&
      (WINDOW_CHOICES as readonly string[]).includes(configured)
      ? Number(configured)
      : DEFAULT_WINDOW_DAYS;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_WINDOW_DAYS
  ) {
    throw new ResearchToolError(
      "unsupported",
      `windowDays must be a whole number from 1 to ${String(MAX_WINDOW_DAYS)}`,
    );
  }
  return value;
}
