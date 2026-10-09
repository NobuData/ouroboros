import { ResearchToolError } from "../../research-tool.errors";
import { toolConfigViolations, toolSchemaViolations } from "../../research-tool.config";
import {
  PROVIDERS,
  WEB_CONFIG_SCHEMA,
  readWebConfig,
  webConfigProblems,
  webSearchPriceCents,
} from "./web.providers";
import { BRAVE_BODY, FIRECRAWL_BODY, SEARXNG_BODY, TAVILY_BODY } from "./web.recordings.fixture";

const SEARXNG = "http://searxng:8080";

describe("the web tool's providers", () => {
  it("is one valid schema with no required field — SearXNG works unconfigured", () => {
    expect(toolSchemaViolations(WEB_CONFIG_SCHEMA)).toEqual([]);
    expect(WEB_CONFIG_SCHEMA.required).toEqual([]);
    expect(
      toolConfigViolations(WEB_CONFIG_SCHEMA, { provider: "brave", safeSearch: "strict" }),
    ).toEqual({});
    expect(Object.keys(toolConfigViolations(WEB_CONFIG_SCHEMA, { provider: "google" }))).toEqual([
      "provider",
    ]);
  });

  it("reads a stored configuration with its defaults", () => {
    expect(readWebConfig(null)).toEqual({
      provider: "searxng",
      searxngUrl: null,
      safeSearch: "moderate",
      searchDepth: "basic",
    });
    expect(
      readWebConfig({ provider: "tavily", searchDepth: "advanced", searxngUrl: " " }),
    ).toMatchObject({
      provider: "tavily",
      searchDepth: "advanced",
      searxngUrl: null,
    });
  });

  it("names what keeps a configuration from working", () => {
    expect(webConfigProblems({}, null)).toEqual([]);
    expect(webConfigProblems({ provider: "brave" }, null)).toEqual([
      "Brave Search needs an API key",
    ]);
    expect(webConfigProblems({ provider: "bing" }, null)).toEqual(["unknown provider bing"]);
    expect(webConfigProblems({ searxngUrl: "searxng:8080" }, null)).toEqual([
      "the SearXNG URL is not an http(s) URL",
    ]);
  });

  it("asks SearXNG for JSON at the configured or the deployment's endpoint", () => {
    const config = readWebConfig({ safeSearch: "strict" });
    const request = PROVIDERS.searxng.request("gust docking", 10, config, null, `${SEARXNG}/`);

    expect(request.method).toBe("GET");
    expect(request.url).toBe(`${SEARXNG}/search?q=gust+docking&format=json&safesearch=2&pageno=1`);
    expect(
      PROVIDERS.searxng.request(
        "q",
        5,
        readWebConfig({ searxngUrl: "https://s.example" }),
        null,
        SEARXNG,
      ).url,
    ).toMatch(/^https:\/\/s\.example\/search\?/);
    expect(PROVIDERS.searxng.healthUrl(config, SEARXNG)).toBe(`${SEARXNG}/healthz`);
  });

  it("asks the hosted providers with the key where each expects it", () => {
    const config = readWebConfig({ searchDepth: "advanced" });

    expect(PROVIDERS.brave.request("q", 50, config, "k", SEARXNG)).toMatchObject({
      url: "https://api.search.brave.com/res/v1/web/search?q=q&count=20&safesearch=moderate",
      headers: { "x-subscription-token": "k" },
    });
    expect(PROVIDERS.tavily.request("q", 5, config, "k", SEARXNG)).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer k" },
      body: { query: "q", max_results: 5, search_depth: "advanced" },
    });
    expect(PROVIDERS.firecrawl.request("q", 5, config, "k", SEARXNG)).toMatchObject({
      url: "https://api.firecrawl.dev/v1/search",
      body: { query: "q", limit: 5 },
    });
  });

  it("refuses to ask a hosted provider without a key, as an auth failure", () => {
    expect(() => PROVIDERS.brave.request("q", 5, readWebConfig(null), null, SEARXNG)).toThrow(
      ResearchToolError,
    );
    try {
      PROVIDERS.tavily.request("q", 5, readWebConfig(null), " ", SEARXNG);
    } catch (error) {
      expect((error as ResearchToolError).errorClass).toBe("auth");
    }
  });

  it("normalises every provider's answer into one shape", () => {
    expect(PROVIDERS.searxng.parse(SEARXNG_BODY)[0]).toEqual({
      title: 'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
      url: "https://skylink.example.com/releases/6.2",
      snippet:
        "Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.",
      publishedAt: "2026-07-02T00:00:00",
    });
    expect(PROVIDERS.brave.parse(BRAVE_BODY)).toHaveLength(2);
    expect(PROVIDERS.tavily.parse(TAVILY_BODY)[0]).toMatchObject({ publishedAt: "2026-05-14" });
    expect(PROVIDERS.firecrawl.parse(FIRECRAWL_BODY)[0]).toMatchObject({
      url: "https://novum.example.io/perch/changelog",
      publishedAt: null,
    });
    expect(PROVIDERS.brave.parse({ nothing: true })).toEqual([]);
    expect(PROVIDERS.searxng.parse("not an object")).toEqual([]);
  });

  it("declares what a hosted search costs, and nothing for an unpriced one", () => {
    expect(webSearchPriceCents(null)).toBeNull();
    expect(webSearchPriceCents({ provider: "brave" })).toBe(0.5);
    expect(webSearchPriceCents({ provider: "tavily" })).toBe(0.8);
    expect(webSearchPriceCents({ provider: "tavily", searchDepth: "advanced" })).toBe(1.6);
    expect(webSearchPriceCents({ provider: "firecrawl" })).toBeNull();
  });
});
