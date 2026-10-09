/**
 * Search providers — configuration, not code (infrastructure option 1-A).
 *
 * ```
 * searxng   (default) the deployment's own metasearch, JSON API, no key, no per-query cost
 * brave     Brave Search API             key in X-Subscription-Token
 * tavily    Tavily search                key as a bearer token
 * firecrawl Firecrawl search             key as a bearer token
 * ```
 *
 * Each provider is two pure functions — how to ask, and how to read the answer — plus what it
 * costs. Everything else the web tool does is the same whichever is selected: the hits are
 * normalised into one shape and become source records the same way, and pages are read by our own
 * fetcher, never the provider's. Switching provider is a configuration change and nothing else;
 * `web.conformance.spec.ts` runs the conformance kit over each to prove it.
 */

import { ResearchToolError } from "../../research-tool.errors";
import type { ResearchToolConfig, ResearchToolConfigSchema } from "../../research-tool.config";

/** The providers, in the order the configuration form offers them. */
export const WEB_PROVIDERS = ["searxng", "brave", "tavily", "firecrawl"] as const;

/** One of {@link WEB_PROVIDERS}. */
export type WebProvider = (typeof WEB_PROVIDERS)[number];

/** The provider used when a workspace has selected none. */
export const DEFAULT_WEB_PROVIDER: WebProvider = "searxng";

/** SafeSearch levels, as the form offers them. */
export const SAFE_SEARCH = ["off", "moderate", "strict"] as const;

/** Tavily's search depths. */
export const SEARCH_DEPTHS = ["basic", "advanced"] as const;

/** One search request, ready to send. */
export interface SearchRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** A JSON body for a POST. */
  readonly body?: Readonly<Record<string, unknown>>;
}

/** One hit, normalised. */
export interface SearchHit {
  readonly title: string;
  readonly url: string;
  /** The provider's snippet; may be empty. */
  readonly snippet: string;
  /** When the page was published, when the provider says; an ISO date or free text. */
  readonly publishedAt: string | null;
}

/** The web tool's configuration, read with its defaults. */
export interface WebConfig {
  readonly provider: WebProvider;
  /** The SearXNG endpoint, when the workspace named one. */
  readonly searxngUrl: string | null;
  readonly safeSearch: (typeof SAFE_SEARCH)[number];
  readonly searchDepth: (typeof SEARCH_DEPTHS)[number];
}

/** What a provider is. */
export interface ProviderSpec {
  readonly id: WebProvider;
  /** How the configuration form names it. */
  readonly label: string;
  /** Whether it needs an API key. */
  readonly needsKey: boolean;
  /**
   * List price per search, in cents, for #622's estimate — or null when unpriced (SearXNG costs
   * nothing per query; a provider whose price is not published per query is not guessed at).
   */
  readonly centsPerSearch: number | null;
  /** Where the health check looks — an address that costs nothing to ask. */
  healthUrl(config: WebConfig, defaultSearxngUrl: string): string;
  /** How to ask. */
  request(
    query: string,
    limit: number,
    config: WebConfig,
    key: string | null,
    defaultSearxngUrl: string,
  ): SearchRequest;
  /** How to read the answer. */
  parse(body: unknown): SearchHit[];
}

/**
 * The configuration form — one schema whatever the provider, so the enable flow (#629) renders it
 * with no web-specific code.
 */
export const WEB_CONFIG_SCHEMA: ResearchToolConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Web search & page reader",
  properties: {
    provider: {
      type: "string",
      title: "Search provider",
      description:
        "SearXNG is the deployment's own metasearch and needs no key. Brave, Tavily and Firecrawl are hosted and need one.",
      enum: [...WEB_PROVIDERS],
      default: DEFAULT_WEB_PROVIDER,
    },
    searxngUrl: {
      type: "string",
      title: "SearXNG URL",
      description: "Leave blank to use the deployment's SearXNG (OURO_RESEARCH_SEARXNG_URL).",
      format: "uri",
      maxLength: 2048,
    },
    apiKey: {
      type: "string",
      title: "API key",
      description: "Brave, Tavily or Firecrawl only. Stored sealed; never shown again.",
      minLength: 1,
      maxLength: 512,
      "x-ouroboros-secret": true,
    },
    safeSearch: {
      type: "string",
      title: "SafeSearch",
      enum: [...SAFE_SEARCH],
      default: "moderate",
    },
    searchDepth: {
      type: "string",
      title: "Search depth (Tavily)",
      description: "Advanced costs twice as much per search.",
      enum: [...SEARCH_DEPTHS],
      default: "basic",
    },
  },
  required: [],
  additionalProperties: false,
};

/**
 * A stored configuration, read with its defaults — the workspace may have stored nothing.
 *
 * @param config - The stored configuration.
 * @returns The configuration the tool runs with.
 */
export function readWebConfig(config: ResearchToolConfig | null): WebConfig {
  const value = (name: string): string | null => {
    const candidate = config?.[name];
    return typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : null;
  };
  const provider = value("provider");
  const safeSearch = value("safeSearch");
  const searchDepth = value("searchDepth");

  return {
    provider: (WEB_PROVIDERS as readonly string[]).includes(provider ?? "")
      ? (provider as WebProvider)
      : DEFAULT_WEB_PROVIDER,
    searxngUrl: value("searxngUrl"),
    safeSearch: (SAFE_SEARCH as readonly string[]).includes(safeSearch ?? "")
      ? (safeSearch as WebConfig["safeSearch"])
      : "moderate",
    searchDepth: searchDepth === "advanced" ? "advanced" : "basic",
  };
}

/**
 * What keeps a configuration from working — independent of whether the provider is reachable.
 *
 * @param config - The stored configuration.
 * @param secret - The opened key, or null.
 * @returns One sentence per problem; empty when the configuration can work.
 */
export function webConfigProblems(
  config: ResearchToolConfig | null,
  secret: string | null,
): string[] {
  const problems: string[] = [];
  const stored = config?.provider;

  if (stored !== undefined && !(WEB_PROVIDERS as readonly unknown[]).includes(stored)) {
    problems.push(`unknown provider ${String(stored)}`);
  }

  const read = readWebConfig(config);
  const spec = PROVIDERS[read.provider];

  if (spec.needsKey && (secret === null || secret.trim() === "")) {
    problems.push(`${spec.label} needs an API key`);
  }
  if (read.searxngUrl !== null && !/^https?:\/\/[^\s/]+/i.test(read.searxngUrl)) {
    problems.push("the SearXNG URL is not an http(s) URL");
  }
  return problems;
}

const SEARXNG_SAFESEARCH = { off: "0", moderate: "1", strict: "2" } as const;

function searxngBase(config: WebConfig, fallback: string): string {
  return (config.searxngUrl ?? fallback).replace(/\/+$/, "");
}

function requireKey(key: string | null, label: string): string {
  if (key === null || key.trim() === "") {
    throw new ResearchToolError(
      "auth",
      `${label} needs an API key — set one in the tool's settings`,
    );
  }
  return key;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hit(raw: unknown, snippetKey: string, dateKey: string): SearchHit {
  const record = asRecord(raw);
  const published = text(record[dateKey]);

  return {
    title: text(record.title),
    url: text(record.url),
    snippet: text(record[snippetKey]),
    publishedAt: published === "" ? null : published,
  };
}

/** The four providers. */
export const PROVIDERS: Readonly<Record<WebProvider, ProviderSpec>> = {
  searxng: {
    id: "searxng",
    label: "SearXNG",
    needsKey: false,
    centsPerSearch: null,
    healthUrl: (config, fallback) => `${searxngBase(config, fallback)}/healthz`,
    request: (query, limit, config, _key, fallback) => {
      void limit; // SearXNG pages by its own size; the tool trims to the limit.
      const params = new URLSearchParams({
        q: query,
        format: "json",
        safesearch: SEARXNG_SAFESEARCH[config.safeSearch],
        pageno: "1",
      });
      return {
        method: "GET",
        url: `${searxngBase(config, fallback)}/search?${params.toString()}`,
        headers: { accept: "application/json" },
      };
    },
    parse: (body) =>
      asArray(asRecord(body).results).map((raw) => hit(raw, "content", "publishedDate")),
  },
  brave: {
    id: "brave",
    label: "Brave Search",
    needsKey: true,
    // Brave Search API, Base AI plan: $5 per 1,000 queries.
    centsPerSearch: 0.5,
    healthUrl: () => "https://api.search.brave.com/",
    request: (query, limit, config, key) => {
      const params = new URLSearchParams({
        q: query,
        count: String(Math.min(limit, 20)),
        safesearch: config.safeSearch,
      });
      return {
        method: "GET",
        url: `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        headers: {
          accept: "application/json",
          "x-subscription-token": requireKey(key, "Brave Search"),
        },
      };
    },
    parse: (body) =>
      asArray(asRecord(asRecord(body).web).results).map((raw) =>
        hit(raw, "description", "page_age"),
      ),
  },
  tavily: {
    id: "tavily",
    label: "Tavily",
    needsKey: true,
    // Tavily: a basic search is one API credit, about $0.008 at pay-as-you-go.
    centsPerSearch: 0.8,
    healthUrl: () => "https://api.tavily.com/",
    request: (query, limit, config, key) => ({
      method: "POST",
      url: "https://api.tavily.com/search",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${requireKey(key, "Tavily")}`,
      },
      body: { query, max_results: Math.min(limit, 20), search_depth: config.searchDepth },
    }),
    parse: (body) =>
      asArray(asRecord(body).results).map((raw) => hit(raw, "content", "published_date")),
  },
  firecrawl: {
    id: "firecrawl",
    label: "Firecrawl",
    needsKey: true,
    // Firecrawl bills search in credits per result; there is no per-search price to declare.
    centsPerSearch: null,
    healthUrl: () => "https://api.firecrawl.dev/",
    request: (query, limit, _config, key) => ({
      method: "POST",
      url: "https://api.firecrawl.dev/v1/search",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${requireKey(key, "Firecrawl")}`,
      },
      body: { query, limit: Math.min(limit, 20) },
    }),
    parse: (body) =>
      asArray(asRecord(body).data).map((raw) => hit(raw, "description", "publishedDate")),
  },
};

/**
 * The cents one search costs under a configuration — what #622's estimate prices hosted
 * providers with.
 *
 * @param config - The stored configuration.
 * @returns Cents per search, or null when the provider is unpriced (SearXNG, Firecrawl).
 */
export function webSearchPriceCents(config: ResearchToolConfig | null): number | null {
  const read = readWebConfig(config);
  const price = PROVIDERS[read.provider].centsPerSearch;

  if (price === null) return null;
  return read.provider === "tavily" && read.searchDepth === "advanced" ? price * 2 : price;
}
