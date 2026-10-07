/**
 * The in-memory research tool — every operation, no network, scriptable failures.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). It is what the conformance kit
 * is proved green against, and what powers the internal surface's suites and the investigation
 * loop's tests (#620) without a socket: a small corpus of documents it searches, fetches and
 * queries, answering every operation with the source records it read — exactly as a real adapter
 * must.
 *
 * A `.fixture.ts`, so it never ships (`tsconfig.build.json`), and so the boundary rule lets a
 * suite import it while production code may not.
 */

import { createHash } from "node:crypto";

import type {
  FetchCapableTool,
  QueryCapableTool,
  SearchCapableTool,
  SearchOptions,
  SourceRecord,
  ToolCallContext,
  ToolCapabilities,
  ToolDisplayMeta,
  ToolResult,
} from "../research-tool.adapter";
import type { ResearchToolConfig, ResearchToolConfigSchema } from "../research-tool.config";
import { ResearchToolError, type ToolErrorClass } from "../research-tool.errors";
import {
  NOT_CONFIGURED_HEALTH,
  type ToolHealth,
  type ToolHealthState,
} from "../research-tool.health";

/** One document in the fake's corpus. */
export interface FakeDocument {
  readonly locator: string;
  readonly title: string;
  readonly text: string;
}

/** The corpus the fake answers from — mockup 22's two Skylink sources, abridged. */
export const FAKE_CORPUS: readonly FakeDocument[] = [
  {
    locator: "https://droneanalysts.example.com/s4-teardown",
    title: "Skylink S4 docking module — teardown & sensor BOM",
    text: "The S4 carries a 6-axis IMU and a 40 m time-of-flight rangefinder — the same sensor class as Helios.",
  },
  {
    locator: "https://skylink.example.com/releases/6.2",
    title: 'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
    text: "Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.",
  },
];

/** A credential the kit can look for in every detail and source the fake produces. */
export const FAKE_SECRET = "fake-research-key-0f3c9a";

/** A configuration the fake's schema accepts. */
export const FAKE_CONFIG: ResearchToolConfig = {
  endpoint: "https://search.example.com",
  scope: ["example.com"],
};

/** The timestamp every fake source is retrieved at, so fixtures are deterministic. */
export const FAKE_RETRIEVED_AT = "2026-10-06T12:00:00.000Z";

/** How the fake can be built. */
export interface FakeToolOptions {
  /** The registry key — `fake` unless a suite needs two, or a real slug. */
  readonly slug?: string;
  /** The corpus. */
  readonly corpus?: readonly FakeDocument[];
  /** Tokens each operation reports — 0 by default; a suite sets it to exercise budgets. */
  readonly tokensPerOperation?: number;
  /** Whether the schema requires the endpoint — so "not configured" can be exercised. */
  readonly requiresConfig?: boolean;
}

/**
 * `sha256:<hex>` of a text, as the ledger stores it.
 *
 * @param text - What was read.
 * @returns The content hash.
 */
export function contentHashOf(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** The fake tool. */
export class FakeResearchTool implements SearchCapableTool, FetchCapableTool, QueryCapableTool {
  readonly slug: string;
  private readonly corpus: readonly FakeDocument[];
  private readonly tokens: number;
  private readonly requiresConfig: boolean;
  /** A failure scripted for the next operation, if any. */
  private nextFailure: ToolErrorClass | null = null;
  /** A health state scripted for the next check, if any. */
  private nextHealth: ToolHealthState | null = null;
  /** Every context an operation was handed, for suites that assert what an adapter saw. */
  readonly contexts: ToolCallContext[] = [];

  /** @param options - See {@link FakeToolOptions}. */
  constructor(options: FakeToolOptions = {}) {
    this.slug = options.slug ?? "fake";
    this.corpus = options.corpus ?? FAKE_CORPUS;
    this.tokens = options.tokensPerOperation ?? 0;
    this.requiresConfig = options.requiresConfig ?? false;
  }

  /**
   * Script the next operation to fail.
   *
   * @param errorClass - How.
   * @returns This tool, for chaining.
   */
  willFail(errorClass: ToolErrorClass): this {
    this.nextFailure = errorClass;
    return this;
  }

  /**
   * Script the next health check.
   *
   * @param state - What it should answer.
   * @returns This tool, for chaining.
   */
  willReport(state: ToolHealthState): this {
    this.nextHealth = state;
    return this;
  }

  displayMeta(): ToolDisplayMeta {
    return { name: "In-memory corpus", glyph: "◇", subLine: "{documents} documents · no network" };
  }

  counts(): Promise<Readonly<Record<string, number | null>>> {
    return Promise.resolve({ documents: this.corpus.length });
  }

  configSchema(): ResearchToolConfigSchema {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title: "Connect the in-memory corpus",
      properties: {
        endpoint: { type: "string", title: "Endpoint", format: "uri" },
        scope: {
          type: "array",
          title: "Domains in scope",
          items: { type: "string", minLength: 1, maxLength: 253 },
        },
        apiKey: { type: "string", title: "API key", "x-ouroboros-secret": true },
      },
      required: this.requiresConfig ? ["endpoint"] : [],
      additionalProperties: false,
    };
  }

  capabilities(): ToolCapabilities & {
    readonly search: true;
    readonly fetch: true;
    readonly query: true;
  } {
    return { search: true, fetch: true, query: true, watch: false };
  }

  healthCheck(config: ResearchToolConfig | null): Promise<ToolHealth> {
    if (config === null) {
      return Promise.resolve(NOT_CONFIGURED_HEALTH);
    }

    const state = this.nextHealth ?? "healthy";
    this.nextHealth = null;

    const detail: Record<ToolHealthState, string> = {
      healthy: `${this.corpus.length.toString()} documents · 0ms`,
      degraded: "slow corpus · 2400ms",
      down: "corpus unreachable",
      not_configured: "not configured",
    };

    return Promise.resolve({ state, detail: detail[state] });
  }

  search(context: ToolCallContext, query: string, options: SearchOptions): Promise<ToolResult> {
    return this.answer(context, () => {
      const needle = query.toLowerCase();
      const hits = this.corpus
        .filter((document) => `${document.title} ${document.text}`.toLowerCase().includes(needle))
        .slice(0, options.limit);

      return hits.length === 0
        ? { payload: null, sources: [] }
        : {
            payload: { hits: hits.map((hit) => ({ title: hit.title, locator: hit.locator })) },
            sources: hits.map((hit) => this.sourceOf(hit, { query })),
          };
    });
  }

  fetch(context: ToolCallContext, locator: string): Promise<ToolResult> {
    return this.answer(context, () => {
      const document = this.corpus.find((candidate) => candidate.locator === locator);

      if (document === undefined) {
        throw new ResearchToolError("upstream", `404 ${locator}`);
      }

      return {
        payload: { locator: document.locator, title: document.title, text: document.text },
        sources: [this.sourceOf(document, {})],
      };
    });
  }

  query(
    context: ToolCallContext,
    structured: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    return this.answer(context, () => {
      const prefix = typeof structured.locatorPrefix === "string" ? structured.locatorPrefix : "";
      const rows = this.corpus.filter((document) => document.locator.startsWith(prefix));

      return rows.length === 0
        ? { payload: null, sources: [] }
        : {
            payload: { rows: rows.map((row) => ({ locator: row.locator, title: row.title })) },
            sources: rows.map((row) => this.sourceOf(row, { locatorPrefix: prefix })),
          };
    });
  }

  /**
   * Run an operation's body with the fake's shared behaviour: record the context, honour a
   * scripted failure, and report the configured token use.
   *
   * @param context - The call's context.
   * @param body - What the operation computes.
   * @returns The result.
   */
  private answer(
    context: ToolCallContext,
    body: () => { payload: unknown; sources: SourceRecord[] },
  ): Promise<ToolResult> {
    this.contexts.push(context);

    const failure = this.nextFailure;
    this.nextFailure = null;

    if (failure !== null) {
      const details: Record<ToolErrorClass, string> = {
        auth: "key rejected (401)",
        network: "connection refused",
        robots_denied: "robots.txt disallows /releases",
        rate_limited: "429 slow down",
        upstream: "503 upstream",
        unsupported: "page needs a JS render tier",
      };

      return Promise.reject(
        new ResearchToolError(failure, details[failure], failure === "rate_limited" ? 30 : null),
      );
    }

    try {
      return Promise.resolve({ ...body(), usage: { tokens: this.tokens } });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * The source record a document archives as.
   *
   * @param document - What was read.
   * @param meta - What reproduces the read.
   * @returns The record.
   */
  private sourceOf(document: FakeDocument, meta: Record<string, unknown>): SourceRecord {
    return {
      kind: "web",
      title: document.title,
      locator: document.locator,
      retrievedAt: FAKE_RETRIEVED_AT,
      contentHash: contentHashOf(document.text),
      excerpt: document.text,
      meta,
    };
  }
}
