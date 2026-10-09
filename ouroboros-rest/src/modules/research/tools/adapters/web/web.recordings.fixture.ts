/**
 * Recordings the web tool's suites run on — a fixture site and four providers' answers — so every
 * suite runs with no network and every rule (robots, redirects, caps, pacing) is observable.
 *
 * The provider bodies are the shapes each API documents, trimmed to what the tool reads; the site
 * is `docs.example.test`, whose robots.txt forbids `/private/` and whose pages exercise every
 * content type the reader classifies.
 */

import type { ResearchToolConfig } from "../../research-tool.config";
import type { FetchClock } from "./web.fetcher";
import type { SearchRequest } from "./web.providers";
import type { SearchHttp, SearchHttpResponse } from "./web.tool";
import {
  PageTransportError,
  type PageRequest,
  type PageResponse,
  type PageTransport,
} from "./web.transport";

/** The fixture site's origin. */
export const SITE = "https://docs.example.test";

/** The article the conformance kit fetches. */
export const ARTICLE_URL = `${SITE}/articles/gust-docking`;

/** A page robots.txt forbids. */
export const PRIVATE_URL = `${SITE}/private/pricing`;

/** A PDF, by its path. */
export const PDF_URL = `${SITE}/papers/mpc-landing.pdf`;

/** A page whose server says it is gone. */
export const MISSING_URL = `${SITE}/missing`;

/** A page whose server is down. */
export const UNREACHABLE_URL = "https://down.example.test/page";

/** The article's HTML: navigation, a cookie banner, the article, a footer. */
export const ARTICLE_HTML = `<!doctype html>
<html><head>
  <title>Gust-tolerant docking — field notes</title>
  <meta property="og:title" content="Gust-tolerant docking: what the field shows">
  <script>window.analytics = { track() {} };</script>
  <style>body { font-family: sans-serif; }</style>
</head><body>
  <nav class="site-nav"><a href="/">Home</a> <a href="/articles">Articles</a> <a href="/about">About</a></nav>
  <div class="cookie-banner">We use cookies. <button>OK</button></div>
  <article>
    <h1>Gust-tolerant docking: what the field shows</h1>
    <p>Docking success falls from 97% below 6&nbsp;m/s to 52% above 8&nbsp;m/s, and the aborts cluster in the final two metres of the approach.</p>
    <p>Units that apply wind feedforward over the last 2&nbsp;m keep lateral error under 0.2&nbsp;m in the same gusts &mdash; a fixed-gain PID does not.</p>
    <p>Retrying from a re-planned approach vector recovers most aborts without an operator; returning to loiter recovers none.</p>
  </article>
  <footer class="footer">© 2026 Example Docs · <a href="/privacy">Privacy</a></footer>
</body></html>`;

/** One recorded response, or a transport failure. */
export type Recorded = PageResponse | PageTransportError | ((request: PageRequest) => PageResponse);

/**
 * A response with defaults.
 *
 * @param status - The status.
 * @param body - The body.
 * @param headers - The headers.
 * @returns The response.
 */
export function page(
  status: number,
  body: string | Buffer = "",
  headers: Record<string, string> = {},
): PageResponse {
  return {
    status,
    headers,
    body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
    truncated: false,
  };
}

/** The fixture site's pages. */
export function fixtureSitePages(): Map<string, Recorded> {
  return new Map<string, Recorded>([
    [
      `${SITE}/robots.txt`,
      page(200, "User-agent: *\nDisallow: /private/\nCrawl-delay: 2\n", {
        "content-type": "text/plain",
      }),
    ],
    [ARTICLE_URL, page(200, ARTICLE_HTML, { "content-type": "text/html; charset=utf-8" })],
    [`${SITE}/old/gust-docking`, page(301, "", { location: "/articles/gust-docking" })],
    [
      `${SITE}/notes.txt`,
      page(200, "Plain notes about docking.\nSecond line.", { "content-type": "text/plain" }),
    ],
    [
      `${SITE}/papers/mpc-landing`,
      page(200, "%PDF-1.7 ...", { "content-type": "application/pdf" }),
    ],
    [
      `${SITE}/images/dock.png`,
      page(200, Buffer.from([0x89, 0x50, 0x4e, 0x47]), { "content-type": "image/png" }),
    ],
    [MISSING_URL, page(404, "Not found", { "content-type": "text/html" })],
    [`${SITE}/busy`, page(429, "slow down", { "retry-after": "30" })],
    ["https://down.example.test/robots.txt", page(404)],
    [UNREACHABLE_URL, new PageTransportError("network", "connect ECONNREFUSED")],
  ]);
}

/** A clock that only moves when it sleeps. */
export class ManualClock implements FetchClock {
  /** Every pause requested, in order. */
  readonly sleeps: number[] = [];

  /** @param time - The starting time, in milliseconds. */
  constructor(private time = 1_760_000_000_000) {}

  now(): number {
    return this.time;
  }

  sleep(milliseconds: number): Promise<void> {
    this.sleeps.push(milliseconds);
    this.time += milliseconds;
    return Promise.resolve();
  }

  /** Move the clock on without a pause. */
  advance(milliseconds: number): void {
    this.time += milliseconds;
  }
}

/** A recorded site: answers from a map, and remembers every request and when it was made. */
export class RecordedSite implements PageTransport {
  /** Every request, in order, with the clock time it was made at. */
  readonly requests: { url: string; at: number; headers: Readonly<Record<string, string>> }[] = [];

  /**
   * @param pages - URL → recorded response; a URL not in the map answers 404.
   * @param clock - The clock requests are stamped with.
   */
  constructor(
    readonly pages: Map<string, Recorded> = fixtureSitePages(),
    private readonly clock: FetchClock = new ManualClock(),
  ) {}

  get(request: PageRequest): Promise<PageResponse> {
    const url = request.url.toString();
    this.requests.push({ url, at: this.clock.now(), headers: request.headers });

    const recorded = this.pages.get(url) ?? page(404);

    if (recorded instanceof PageTransportError) return Promise.reject(recorded);

    const response = typeof recorded === "function" ? recorded(request) : recorded;

    if (response.body.length > request.maxBytes) {
      return Promise.resolve({
        ...response,
        body: response.body.subarray(0, request.maxBytes),
        truncated: true,
      });
    }
    return Promise.resolve(response);
  }

  /** The URLs requested, in order. */
  urls(): string[] {
    return this.requests.map((entry) => entry.url);
  }
}

/** A SearXNG answer for `gust docking`. */
export const SEARXNG_BODY = {
  query: "gust docking",
  number_of_results: 3,
  results: [
    {
      url: "https://skylink.example.com/releases/6.2",
      title: 'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
      content:
        "Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.",
      engine: "duckduckgo",
      publishedDate: "2026-07-02T00:00:00",
    },
    {
      url: "https://droneanalysts.example.com/s4-teardown",
      title: "Skylink S4 docking module — teardown & sensor BOM",
      content: "The S4 carries a 6-axis IMU and a 40 m time-of-flight rangefinder.",
      engine: "bing",
    },
    {
      // A repeat from a second engine — dropped.
      url: "https://skylink.example.com/releases/6.2",
      title: "Skylink 6.2",
      content: "duplicate",
      engine: "brave",
    },
    { url: "ftp://files.example.com/x", title: "not a page", content: "" },
  ],
};

/** A Brave Search answer. */
export const BRAVE_BODY = {
  type: "search",
  web: {
    type: "search",
    results: [
      {
        title: "Gust-tolerant docking: what the field shows",
        url: "https://docs.example.test/articles/gust-docking",
        description: "Docking success falls from 97% below 6 m/s to 52% above 8 m/s.",
        page_age: "2026-06-11T00:00:00",
      },
      {
        title: "AeroMesh Dock 2 field review",
        url: "https://dronereview.example.net/aeromesh-dock-2",
        description: "Docking success 96% below 6 m/s, 81% at 8–10 m/s.",
      },
    ],
  },
};

/** A Tavily answer. */
export const TAVILY_BODY = {
  query: "gust docking",
  results: [
    {
      title: "MPC for precision landing in turbulent flow",
      url: "https://arxiv.example.org/abs/2605.11423",
      content: "Wind-feedforward MPC reduced touchdown error in gusts relative to fixed-gain PID.",
      score: 0.93,
      published_date: "2026-05-14",
    },
  ],
  response_time: 1.2,
};

/** A Firecrawl answer. */
export const FIRECRAWL_BODY = {
  success: true,
  data: [
    {
      url: "https://novum.example.io/perch/changelog",
      title: "Novum Perch changelog",
      description: "1.4: visual approach (beta) behind a feature flag.",
    },
  ],
};

/** The four providers' recorded configurations. */
export const PROVIDER_CONFIGS: Readonly<Record<string, ResearchToolConfig>> = {
  searxng: { provider: "searxng", searxngUrl: "http://searxng.test:8080" },
  brave: { provider: "brave" },
  tavily: { provider: "tavily", searchDepth: "basic" },
  firecrawl: { provider: "firecrawl" },
};

/** The key the hosted recordings were made with. */
export const RECORDED_KEY = "recorded-provider-key-0000";

/** Which host each provider is asked at. */
const PROVIDER_HOSTS: Readonly<Record<string, { host: string; body: unknown }>> = {
  searxng: { host: "searxng.test:8080", body: SEARXNG_BODY },
  brave: { host: "api.search.brave.com", body: BRAVE_BODY },
  tavily: { host: "api.tavily.com", body: TAVILY_BODY },
  firecrawl: { host: "api.firecrawl.dev", body: FIRECRAWL_BODY },
};

/** A provider answer with defaults. */
function answer(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): SearchHttpResponse {
  return { status, headers, body: typeof body === "string" ? body : JSON.stringify(body) };
}

/** What a recorded provider will answer next. */
export type ProviderMode =
  "ok" | "empty" | "unauthorized" | "rate_limited" | "error" | "not_json" | "down" | "slow";

/**
 * A recorded provider: answers its own recording for its search endpoint and `200` for its health
 * URL, or whatever {@link ProviderMode} says.
 */
export class RecordedProviders {
  /** Every request, in order. */
  readonly requests: { request: SearchRequest; timeoutMs: number }[] = [];

  /** What the next requests answer. */
  mode: ProviderMode = "ok";

  /** @param clock - Moved on by a `slow` answer, so health sees the latency. */
  constructor(private readonly clock?: ManualClock) {}

  /** The `SearchHttp` the tool is built with. */
  readonly http: SearchHttp = (request, timeoutMs) => {
    this.requests.push({ request, timeoutMs });
    const url = new URL(request.url);
    const provider = Object.entries(PROVIDER_HOSTS).find(([, value]) => value.host === url.host);

    switch (this.mode) {
      case "down":
        return Promise.reject(new TypeError("fetch failed"));
      case "unauthorized":
        return Promise.resolve(answer(401, { error: "invalid key" }));
      case "rate_limited":
        return Promise.resolve(answer(429, { error: "slow down" }, { "retry-after": "12" }));
      case "error":
        return Promise.resolve(answer(502, "bad gateway"));
      case "not_json":
        return Promise.resolve(answer(200, "<html>captcha</html>"));
      case "slow":
        this.clock?.advance(3000);
        break;
      default:
        break;
    }

    if (url.pathname === "/healthz" || url.pathname === "/")
      return Promise.resolve(answer(200, "OK"));
    if (provider === undefined) return Promise.resolve(answer(404, "no such provider"));
    if (this.mode === "empty")
      return Promise.resolve(answer(200, { results: [], web: { results: [] }, data: [] }));
    return Promise.resolve(answer(200, provider[1].body));
  };
}
