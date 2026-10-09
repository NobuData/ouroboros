/**
 * `web` — the Web search & page reader research tool (CL.2,
 * [#615](https://github.com/NobuData/ouroboros/issues/615)).
 *
 * Mockup 22's first tool row and first composer chip:
 *
 * ```
 * ◍ Web search & page reader    search API + full-page extraction, robots-aware    ●
 * ```
 *
 * - **`search(q)`** asks the workspace's provider (`web.providers.ts` — SearXNG by default, or a
 *   hosted one by configuration) and answers its hits, each one a `web` source record whose excerpt
 *   is the provider's snippet: a search result is a citation stub, and a claim that leans on more
 *   than a snippet fetches the page.
 * - **`fetch(url)`** reads the page with our own reader (`web.fetcher.ts`) — robots.txt honoured,
 *   one host at a time, redirects bounded, bytes capped — extracts its main content and answers it
 *   with one source record: the final URL, the hash of every byte read, and a bounded excerpt
 *   (V108's 4 KiB). A robots denial and a PDF are classified refusals the internal surface records
 *   as skips (`source_skips`, V116), never silent drops.
 *
 * Health is configuration validity first and reachability second, so a missing key and a dead
 * endpoint read differently on the card: `misconfigured: …` versus `unreachable: …`.
 */

import { createHash } from "node:crypto";

import type {
  FetchCapableTool,
  SearchCapableTool,
  SearchOptions,
  SourceRecord,
  ToolCallContext,
  ToolCapabilities,
  ToolDisplayMeta,
  ToolResult,
} from "../../research-tool.adapter";
import type { ResearchToolConfig, ResearchToolConfigSchema } from "../../research-tool.config";
import { ResearchToolError } from "../../research-tool.errors";
import { NOT_CONFIGURED_HEALTH, type ToolHealth } from "../../research-tool.health";
import { PageFetcher, retryAfterSeconds } from "./web.fetcher";
import {
  PROVIDERS,
  WEB_CONFIG_SCHEMA,
  readWebConfig,
  webConfigProblems,
  webSearchPriceCents,
  type SearchHit,
  type SearchRequest,
} from "./web.providers";

/** The slug — V106's `web` research tool. */
export const WEB_TOOL_SLUG = "web";

/** The most bytes of an excerpt — V108's bound. */
export const EXCERPT_MAX_BYTES = 4096;

/** The most characters of a fetched page's text handed back in the payload. */
export const PAYLOAD_TEXT_MAX_CHARS = 200_000;

/** A health check slower than this is `degraded`. */
export const SLOW_HEALTH_MS = 2000;

/** A provider's answer. */
export interface SearchHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** The body as text. */
  readonly body: string;
}

/** How a provider is asked — `fetch` in production, recordings in the specs. */
export type SearchHttp = (request: SearchRequest, timeoutMs: number) => Promise<SearchHttpResponse>;

/** The most bytes of a provider's answer read. */
export const SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The production `SearchHttp`: undici's `fetch`, bounded in time and in bytes.
 *
 * @param request - The provider request.
 * @param timeoutMs - The deadline.
 * @returns The answer.
 */
export const fetchSearchHttp: SearchHttp = async (request, timeoutMs) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;

  while (reader !== undefined) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    read += next.value.length;
    if (read > SEARCH_RESPONSE_MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  return { status: response.status, headers, body: Buffer.concat(chunks).toString("utf8") };
};

/** What the web tool is built from. */
export interface WebToolDependencies {
  /** The page reader. */
  readonly fetcher: PageFetcher;
  /** How providers are asked. */
  readonly http: SearchHttp;
  /** The deployment's SearXNG, `OURO_RESEARCH_SEARXNG_URL`. */
  readonly defaultSearxngUrl: string;
  /** How long a provider request may take, `OURO_RESEARCH_FETCH_TIMEOUT_MS`. */
  readonly timeoutMs: number;
  /** The clock, for `retrievedAt` and health latency. */
  readonly now?: () => Date;
}

/** The Web search & page reader. */
export class WebResearchTool implements SearchCapableTool, FetchCapableTool {
  readonly slug = WEB_TOOL_SLUG;

  private readonly now: () => Date;

  /** @param dependencies - The reader, the provider client and the defaults. */
  constructor(private readonly dependencies: WebToolDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  displayMeta(): ToolDisplayMeta {
    return {
      name: "Web search & page reader",
      glyph: "◍",
      subLine: "search API + full-page extraction, robots-aware",
    };
  }

  counts(): Promise<Readonly<Record<string, number | null>>> {
    return Promise.resolve({});
  }

  configSchema(): ResearchToolConfigSchema {
    return structuredClone(WEB_CONFIG_SCHEMA);
  }

  capabilities(): ToolCapabilities & { readonly search: true; readonly fetch: true } {
    return { search: true, fetch: true, query: false, watch: false };
  }

  /**
   * Search the workspace's provider.
   *
   * @param context - The call's configuration and key.
   * @param query - What to look for.
   * @param options - The caller's limit.
   * @returns The hits, one source record each; a null payload when nothing was found.
   * @throws {ResearchToolError} `auth` for a missing or refused key, `rate_limited` on a 429,
   *   `network` when the provider did not answer, `upstream` for any other refusal or an answer
   *   that is not JSON.
   */
  async search(
    context: ToolCallContext,
    query: string,
    options: SearchOptions,
  ): Promise<ToolResult> {
    const config = readWebConfig(context.config);
    const spec = PROVIDERS[config.provider];
    const request = spec.request(
      query,
      options.limit,
      config,
      context.secret,
      this.dependencies.defaultSearxngUrl,
    );
    const response = await this.ask(spec.label, request);
    const hits = dedupe(spec.parse(parseJson(spec.label, response.body)))
      .filter((candidate) => isPageUrl(candidate.url))
      .slice(0, options.limit);

    if (hits.length === 0) {
      return { payload: null, sources: [], usage: { tokens: 0 } };
    }

    const retrievedAt = this.now().toISOString();
    const sources: SourceRecord[] = hits.map((candidate, index) => ({
      kind: "web",
      title: clip(candidate.title === "" ? labelOf(candidate.url) : candidate.title, 300),
      locator: candidate.url,
      retrievedAt,
      contentHash: sha256(JSON.stringify({ provider: spec.id, ...candidate })),
      excerpt: excerptOf(
        candidate.snippet === "" ? candidate.title || candidate.url : candidate.snippet,
      ),
      meta: {
        provider: spec.id,
        query,
        rank: index + 1,
        ...(candidate.publishedAt === null ? {} : { publishedAt: candidate.publishedAt }),
      },
    }));

    return {
      payload: {
        provider: spec.id,
        query,
        hits: hits.map((candidate, index) => ({ rank: index + 1, ...candidate })),
      },
      sources,
      usage: { tokens: 0 },
    };
  }

  /**
   * Read one page.
   *
   * @param context - The call's context (the reader needs no configuration).
   * @param locator - The page's URL.
   * @returns The page's main text, and the source record archiving it.
   * @throws {ResearchToolError} See `PageFetcher.fetch`.
   */
  async fetch(context: ToolCallContext, locator: string): Promise<ToolResult> {
    void context;
    const page = await this.dependencies.fetcher.fetch(locator);
    const text =
      page.text === ""
        ? "(the page has no readable text — it may need a browser to render)"
        : page.text;

    const source: SourceRecord = {
      kind: "web",
      title: clip(page.title ?? labelOf(page.finalUrl), 300),
      locator: page.finalUrl,
      retrievedAt: this.now().toISOString(),
      contentHash: page.contentHash,
      excerpt: excerptOf(text),
      meta: {
        requestedUrl: page.requestedUrl,
        status: page.status,
        contentType: page.contentType,
        bytes: page.bytes,
        truncated: page.truncated,
        redirects: page.redirects,
        extractor: page.extractor,
        robots: "allowed",
      },
    };

    return {
      payload: {
        url: page.requestedUrl,
        finalUrl: page.finalUrl,
        title: page.title,
        contentType: page.contentType,
        text: clip(text, PAYLOAD_TEXT_MAX_CHARS),
        bytes: page.bytes,
        truncated: page.truncated,
        extractor: page.extractor,
      },
      sources: [source],
      usage: { tokens: 0 },
    };
  }

  /**
   * What one operation costs — the selected provider's list price per search, for #622's estimate.
   * The page reader is ours and free, so pricing every web operation at the search price makes the
   * estimate an upper bound, never an understatement.
   *
   * @param config - The configuration, or null (SearXNG, unpriced).
   * @returns Cents per operation, or null for SearXNG and Firecrawl.
   */
  operationPriceCents(config: ResearchToolConfig | null): number | null {
    return webSearchPriceCents(config);
  }

  /**
   * Whether the workspace's configuration works — validity first, then reachability.
   *
   * @param config - The configuration, or null.
   * @param secret - The key, or null.
   * @returns The card's state. Never rejects.
   */
  async healthCheck(config: ResearchToolConfig | null, secret: string | null): Promise<ToolHealth> {
    if (config === null) return NOT_CONFIGURED_HEALTH;

    const problems = webConfigProblems(config, secret);
    if (problems.length > 0) {
      return { state: "down", detail: `misconfigured: ${problems.join("; ")}` };
    }

    const read = readWebConfig(config);
    const spec = PROVIDERS[read.provider];
    const started = this.now().getTime();

    try {
      const response = await this.dependencies.http(
        {
          method: "GET",
          url: spec.healthUrl(read, this.dependencies.defaultSearxngUrl),
          headers: {},
        },
        this.dependencies.timeoutMs,
      );
      const elapsed = this.now().getTime() - started;

      if (read.provider === "searxng" && response.status >= 400) {
        return {
          state: "down",
          detail: `unreachable: SearXNG answered ${String(response.status)}`,
        };
      }
      if (response.status >= 500) {
        return {
          state: "down",
          detail: `unreachable: ${spec.label} answered ${String(response.status)}`,
        };
      }

      const detail = `${spec.label} · ${String(response.status)} · ${String(elapsed)}ms${spec.needsKey ? " · key checked on first search" : ""}`;
      return elapsed > SLOW_HEALTH_MS
        ? { state: "degraded", detail: `slow: ${detail}` }
        : { state: "healthy", detail };
    } catch {
      return { state: "down", detail: `unreachable: ${spec.label} did not answer` };
    }
  }

  /**
   * Ask a provider, with its failures classified.
   *
   * @param label - The provider's name, for details.
   * @param request - The request.
   * @returns A 2xx answer.
   */
  private async ask(label: string, request: SearchRequest): Promise<SearchHttpResponse> {
    let response: SearchHttpResponse;

    try {
      response = await this.dependencies.http(request, this.dependencies.timeoutMs);
    } catch {
      throw new ResearchToolError("network", `${label} did not answer`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new ResearchToolError("auth", `${label} refused the key (${String(response.status)})`);
    }
    if (response.status === 429) {
      throw new ResearchToolError(
        "rate_limited",
        `${label} asked for fewer searches (429)`,
        retryAfterSeconds(response.headers["retry-after"]),
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ResearchToolError("upstream", `${label} answered ${String(response.status)}`);
    }
    return response;
  }
}

function parseJson(label: string, body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ResearchToolError("upstream", `${label} answered with something that is not JSON`);
  }
}

function dedupe(hits: readonly SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

/**
 * Whether a hit's URL is one a source record can carry.
 *
 * @param url - The URL.
 * @returns `true` for an absolute http(s) URL of at most 2048 characters with no whitespace.
 */
function isPageUrl(url: string): boolean {
  return url.length <= 2048 && /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/\S*)?$/.test(url);
}

function labelOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * The passage a claim may lean on — the text's start, cut at a word inside V108's byte bound.
 *
 * @param value - The text.
 * @returns At most {@link EXCERPT_MAX_BYTES} bytes; never blank.
 */
export function excerptOf(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (Buffer.byteLength(flat) <= EXCERPT_MAX_BYTES) return flat === "" ? "(no text)" : flat;

  let cut = flat.slice(0, EXCERPT_MAX_BYTES);
  while (Buffer.byteLength(`${cut}…`) > EXCERPT_MAX_BYTES) cut = cut.slice(0, -1);
  const word = cut.lastIndexOf(" ");
  return `${word > EXCERPT_MAX_BYTES / 2 ? cut.slice(0, word) : cut}…`;
}
