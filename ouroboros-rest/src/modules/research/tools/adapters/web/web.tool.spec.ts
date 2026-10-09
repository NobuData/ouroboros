import { conformanceContext } from "../../conformance.fixture";
import { sourceRecordViolations } from "../../research-tool.citations";
import { ResearchToolError } from "../../research-tool.errors";
import { PageFetcher } from "./web.fetcher";
import {
  ARTICLE_URL,
  ManualClock,
  PROVIDER_CONFIGS,
  RECORDED_KEY,
  RecordedProviders,
  RecordedSite,
  SITE,
  fixtureSitePages,
  page,
} from "./web.recordings.fixture";
import { EXCERPT_MAX_BYTES, WebResearchTool, excerptOf } from "./web.tool";

function build() {
  const clock = new ManualClock();
  const providers = new RecordedProviders(clock);
  const pages = fixtureSitePages();
  const site = new RecordedSite(pages, clock);
  const tool = new WebResearchTool({
    fetcher: new PageFetcher(
      site,
      { timeoutMs: 15_000, maxBytes: 5_242_880, maxRedirects: 5, hostIntervalMs: 1000 },
      clock,
    ),
    http: providers.http,
    defaultSearxngUrl: "http://searxng.test:8080",
    timeoutMs: 15_000,
    now: () => new Date(clock.now()),
  });
  return { tool, providers, pages, site, clock };
}

async function refusal(work: Promise<unknown>): Promise<ResearchToolError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ResearchToolError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the web tool", () => {
  it("is the web row of mockup 22, searching and fetching", () => {
    const { tool } = build();

    expect(tool.slug).toBe("web");
    expect(tool.displayMeta()).toEqual({
      name: "Web search & page reader",
      glyph: "◍",
      subLine: "search API + full-page extraction, robots-aware",
    });
    expect(tool.capabilities()).toEqual({ search: true, fetch: true, query: false, watch: false });
  });

  it("searches the deployment's SearXNG when the workspace configured nothing", async () => {
    const { tool, providers } = build();

    const result = await tool.search(
      conformanceContext({ config: {}, secret: null }),
      "gust docking",
      { limit: 10 },
    );

    expect(providers.requests[0].request.url).toMatch(
      /^http:\/\/searxng\.test:8080\/search\?q=gust\+docking/,
    );
    expect(result.payload).toMatchObject({ provider: "searxng", query: "gust docking" });
    // The repeat and the ftp:// hit are dropped.
    expect(result.sources.map((source) => source.locator)).toEqual([
      "https://skylink.example.com/releases/6.2",
      "https://droneanalysts.example.com/s4-teardown",
    ]);
    expect(result.sources[0]).toMatchObject({
      kind: "web",
      excerpt:
        "Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.",
      meta: {
        provider: "searxng",
        query: "gust docking",
        rank: 1,
        publishedAt: "2026-07-02T00:00:00",
      },
    });
    expect(result.sources.flatMap((source) => sourceRecordViolations(source))).toEqual([]);
  });

  it("honours the caller's limit", async () => {
    const { tool } = build();

    const result = await tool.search(conformanceContext({ config: {}, secret: null }), "gust", {
      limit: 1,
    });

    expect(result.sources).toHaveLength(1);
  });

  it("answers no hits as an empty answer, not a failure", async () => {
    const { tool, providers } = build();
    providers.mode = "empty";

    expect(
      await tool.search(conformanceContext({ config: {}, secret: null }), "nothing", { limit: 10 }),
    ).toEqual({
      payload: null,
      sources: [],
      usage: { tokens: 0 },
    });
  });

  it("switches provider by configuration alone", async () => {
    const { tool, providers } = build();

    for (const [provider, config] of Object.entries(PROVIDER_CONFIGS)) {
      const secret = provider === "searxng" ? null : RECORDED_KEY;
      const result = await tool.search(conformanceContext({ config, secret }), "gust docking", {
        limit: 10,
      });
      expect(result.payload).toMatchObject({ provider });
    }
    expect(new Set(providers.requests.map((entry) => new URL(entry.request.url).host))).toEqual(
      new Set(["searxng.test:8080", "api.search.brave.com", "api.tavily.com", "api.firecrawl.dev"]),
    );
  });

  it("classifies a provider's refusals", async () => {
    const { tool, providers } = build();
    const brave = conformanceContext({ config: { provider: "brave" }, secret: RECORDED_KEY });
    const search = () => tool.search(brave, "q", { limit: 5 });

    providers.mode = "unauthorized";
    expect((await refusal(search())).errorClass).toBe("auth");
    providers.mode = "rate_limited";
    expect(await refusal(search())).toMatchObject({
      errorClass: "rate_limited",
      retryAfterSeconds: 12,
    });
    providers.mode = "error";
    expect((await refusal(search())).errorClass).toBe("upstream");
    providers.mode = "not_json";
    expect((await refusal(search())).detail).toContain("not JSON");
    providers.mode = "down";
    expect((await refusal(search())).errorClass).toBe("network");
    expect(
      (
        await refusal(
          tool.search(conformanceContext({ config: { provider: "brave" }, secret: null }), "q", {
            limit: 5,
          }),
        )
      ).errorClass,
    ).toBe("auth");
  });

  it("fetches a page into one archived source: final URL, hash, bounded excerpt", async () => {
    const { tool } = build();

    const result = await tool.fetch(
      conformanceContext({ config: {}, secret: null }),
      `${SITE}/old/gust-docking`,
    );

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      kind: "web",
      title: "Gust-tolerant docking: what the field shows",
      locator: ARTICLE_URL,
      meta: {
        requestedUrl: `${SITE}/old/gust-docking`,
        redirects: 1,
        robots: "allowed",
        extractor: "main-content-v1",
      },
    });
    expect(sourceRecordViolations(result.sources[0])).toEqual([]);
    expect(result.payload).toMatchObject({ finalUrl: ARTICLE_URL, truncated: false });
  });

  it("says when a page has no readable text rather than archiving a blank", async () => {
    const { tool, pages } = build();
    pages.set(
      `${SITE}/app`,
      page(200, "<html><body><div id='root'></div><script>boot()</script></body></html>", {
        "content-type": "text/html",
      }),
    );

    const result = await tool.fetch(
      conformanceContext({ config: {}, secret: null }),
      `${SITE}/app`,
    );

    expect(result.sources[0].excerpt).toContain("no readable text");
  });

  describe("health", () => {
    it("is idle with no configuration, without a network call", async () => {
      const { tool, providers } = build();

      expect(await tool.healthCheck(null, null)).toEqual({
        state: "not_configured",
        detail: "not configured",
      });
      expect(providers.requests).toHaveLength(0);
    });

    it("tells a misconfiguration from an unreachable provider", async () => {
      const { tool, providers } = build();

      const misconfigured = await tool.healthCheck({ provider: "tavily" }, null);
      providers.mode = "down";
      const unreachable = await tool.healthCheck({}, null);

      expect(misconfigured).toEqual({
        state: "down",
        detail: "misconfigured: Tavily needs an API key",
      });
      expect(unreachable).toEqual({ state: "down", detail: "unreachable: SearXNG did not answer" });
      expect(providers.requests).toHaveLength(1);
    });

    it("is healthy when the provider answers, and degraded when it is slow", async () => {
      const { tool, providers } = build();

      expect(await tool.healthCheck({}, null)).toMatchObject({
        state: "healthy",
        detail: "SearXNG · 200 · 0ms",
      });
      expect(await tool.healthCheck({ provider: "brave" }, RECORDED_KEY)).toMatchObject({
        state: "healthy",
        detail: "Brave Search · 200 · 0ms · key checked on first search",
      });
      providers.mode = "slow";
      expect((await tool.healthCheck({}, null)).state).toBe("degraded");
    });
  });

  it("declares the selected provider's price per operation for the estimate", () => {
    const { tool } = build();

    expect(tool.operationPriceCents(null)).toBeNull();
    expect(tool.operationPriceCents({ provider: "searxng" })).toBeNull();
    expect(tool.operationPriceCents({ provider: "brave" })).toBe(0.5);
    expect(tool.operationPriceCents({ provider: "tavily", searchDepth: "advanced" })).toBe(1.6);
    expect(tool.operationPriceCents({ provider: "firecrawl" })).toBeNull();
  });
});

describe("excerpts", () => {
  it("keeps a short text whole and cuts a long one at a word inside the byte bound", () => {
    expect(excerptOf("  a   short\ntext ")).toBe("a short text");
    expect(excerptOf("")).toBe("(no text)");

    const long = excerptOf("gust ".repeat(2000));
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    expect(long.endsWith("gust…")).toBe(true);

    const multibyte = excerptOf("é".repeat(5000));
    expect(Buffer.byteLength(multibyte)).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
  });
});
