import { ResearchToolError } from "../../research-tool.errors";
import {
  MAX_CRAWL_DELAY_MS,
  PDF_SKIP_NOTE,
  PageFetcher,
  ROBOTS_FAILURE_TTL_MS,
  ROBOTS_TTL_MS,
  USER_AGENT,
  isPdfPath,
  pageUrl,
  retryAfterSeconds,
  type FetchLimits,
} from "./web.fetcher";
import {
  ARTICLE_URL,
  MISSING_URL,
  ManualClock,
  PDF_URL,
  PRIVATE_URL,
  RecordedSite,
  SITE,
  UNREACHABLE_URL,
  fixtureSitePages,
  page,
  type Recorded,
} from "./web.recordings.fixture";
import { PageTransportError } from "./web.transport";

const LIMITS: FetchLimits = {
  timeoutMs: 15_000,
  maxBytes: 5_242_880,
  maxRedirects: 5,
  hostIntervalMs: 1000,
};

function reader(pages?: Map<string, Recorded>, limits: Partial<FetchLimits> = {}) {
  const clock = new ManualClock();
  const site = new RecordedSite(pages ?? fixtureSitePages(), clock);
  const fetcher = new PageFetcher(site, { ...LIMITS, ...limits }, clock);
  return { clock, site, fetcher };
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

describe("the page reader", () => {
  it("reads a page's main content, hashes every byte read and names itself", async () => {
    const { fetcher, site } = reader();

    const fetched = await fetcher.fetch(ARTICLE_URL);

    expect(fetched).toMatchObject({
      requestedUrl: ARTICLE_URL,
      finalUrl: ARTICLE_URL,
      redirects: 0,
      status: 200,
      contentType: "text/html",
      title: "Gust-tolerant docking: what the field shows",
      truncated: false,
      extractor: "main-content-v1",
    });
    expect(fetched.text).toContain("Docking success falls from 97% below 6 m/s");
    expect(fetched.text).not.toContain("We use cookies");
    expect(fetched.text).not.toContain("Privacy");
    expect(fetched.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(site.requests.every((request) => request.headers["user-agent"] === USER_AGENT)).toBe(
      true,
    );
  });

  it("asks robots.txt before the page, once per origin", async () => {
    const { fetcher, site } = reader();

    await fetcher.fetch(ARTICLE_URL);
    await fetcher.fetch(`${SITE}/notes.txt`);

    expect(site.urls()).toEqual([`${SITE}/robots.txt`, ARTICLE_URL, `${SITE}/notes.txt`]);
  });

  it("refuses a page robots.txt disallows, naming the rule", async () => {
    const { fetcher, site } = reader();

    const error = await refusal(fetcher.fetch(PRIVATE_URL));

    expect(error.errorClass).toBe("robots_denied");
    expect(error.detail).toBe(
      "robots.txt disallows /private/pricing for OuroborosResearch (Disallow: /private/)",
    );
    expect(site.urls()).not.toContain(PRIVATE_URL);
  });

  it("treats a missing robots.txt as no rules", async () => {
    const pages = fixtureSitePages();
    pages.set(`${SITE}/robots.txt`, page(404));
    pages.set(PRIVATE_URL, page(200, "<p>dealer pricing</p>", { "content-type": "text/html" }));

    expect((await reader(pages).fetcher.fetch(PRIVATE_URL)).text).toBe("dealer pricing");
  });

  it("assumes disallowed when robots.txt answers 5xx or not at all, and asks again later", async () => {
    const pages = fixtureSitePages();
    pages.set(`${SITE}/robots.txt`, page(503));
    const { fetcher, clock, site } = reader(pages);

    expect((await refusal(fetcher.fetch(ARTICLE_URL))).errorClass).toBe("robots_denied");

    pages.set(`${SITE}/robots.txt`, new PageTransportError("network", "reset"));
    clock.advance(ROBOTS_FAILURE_TTL_MS + 1);
    expect((await refusal(fetcher.fetch(ARTICLE_URL))).errorClass).toBe("robots_denied");

    pages.set(`${SITE}/robots.txt`, page(200, "User-agent: *\nAllow: /\n"));
    clock.advance(ROBOTS_FAILURE_TTL_MS + 1);
    expect((await fetcher.fetch(ARTICLE_URL)).status).toBe(200);
    expect(site.urls().filter((url) => url.endsWith("/robots.txt"))).toHaveLength(3);
  });

  it("trusts a robots.txt verdict for a day", async () => {
    const { fetcher, clock, site } = reader();

    await fetcher.fetch(ARTICLE_URL);
    clock.advance(ROBOTS_TTL_MS - 10_000);
    await fetcher.fetch(ARTICLE_URL);
    clock.advance(20_000);
    await fetcher.fetch(ARTICLE_URL);

    expect(site.urls().filter((url) => url.endsWith("/robots.txt"))).toHaveLength(2);
  });

  it("follows a redirect, re-checking robots on the new path, and reports the final URL", async () => {
    const { fetcher } = reader();

    const fetched = await fetcher.fetch(`${SITE}/old/gust-docking`);

    expect(fetched).toMatchObject({
      finalUrl: ARTICLE_URL,
      redirects: 1,
      requestedUrl: `${SITE}/old/gust-docking`,
    });
  });

  it("refuses a redirect into a disallowed path", async () => {
    const pages = fixtureSitePages();
    pages.set(`${SITE}/go`, page(302, "", { location: "/private/pricing" }));

    expect((await refusal(reader(pages).fetcher.fetch(`${SITE}/go`))).errorClass).toBe(
      "robots_denied",
    );
  });

  it("bounds redirects", async () => {
    const pages = fixtureSitePages();
    pages.set(`${SITE}/loop`, page(302, "", { location: "/loop" }));
    const { fetcher, site } = reader(pages, { maxRedirects: 3 });

    const error = await refusal(fetcher.fetch(`${SITE}/loop`));

    expect(error).toMatchObject({
      errorClass: "upstream",
      detail: `more than 3 redirects from ${SITE}/loop`,
    });
    expect(site.urls().filter((url) => url.endsWith("/loop"))).toHaveLength(4);
  });

  it("caps the bytes it reads and says the page was truncated", async () => {
    const pages = fixtureSitePages();
    pages.set(
      `${SITE}/long`,
      page(200, `<p>${"word ".repeat(40_000)}</p>`, { "content-type": "text/html" }),
    );
    const { fetcher, site } = reader(pages, { maxBytes: 65_536 });

    const fetched = await fetcher.fetch(`${SITE}/long`);

    expect(fetched).toMatchObject({ bytes: 65_536, truncated: true });
    expect(site.requests.at(-1)).toBeDefined();
  });

  it("spaces requests to one host by the larger of the interval and the crawl-delay", async () => {
    const { fetcher, site } = reader();

    await fetcher.fetch(ARTICLE_URL);
    await fetcher.fetch(`${SITE}/notes.txt`);

    const [robots, article, notes] = site.requests.map((request) => request.at);
    expect(article - robots).toBeGreaterThanOrEqual(1000);
    // robots.txt says Crawl-delay: 2.
    expect(notes - article).toBeGreaterThanOrEqual(2000);
  });

  it("caps an excessive crawl-delay", async () => {
    const pages = fixtureSitePages();
    pages.set(`${SITE}/robots.txt`, page(200, "User-agent: *\nCrawl-delay: 3600\n"));
    const { fetcher, site } = reader(pages);

    await fetcher.fetch(ARTICLE_URL);
    await fetcher.fetch(`${SITE}/notes.txt`);

    const [, article, notes] = site.requests.map((request) => request.at);
    expect(notes - article).toBe(MAX_CRAWL_DELAY_MS);
  });

  it("does not pace different hosts against each other", async () => {
    const pages = fixtureSitePages();
    pages.set("https://other.example.test/robots.txt", page(404));
    pages.set(
      "https://other.example.test/a",
      page(200, "<p>other</p>", { "content-type": "text/html" }),
    );
    const { fetcher, clock } = reader(pages, { hostIntervalMs: 5000 });

    await fetcher.fetch(ARTICLE_URL);
    const before = clock.sleeps.length;
    await fetcher.fetch("https://other.example.test/a");

    // The other host's robots.txt and page wait only on each other.
    expect(clock.sleeps.slice(before)).toEqual([5000]);
  });

  it("answers a PDF — by path or by type — with the papers-tool note, reading nothing", async () => {
    const { fetcher, site } = reader();

    expect(await refusal(fetcher.fetch(PDF_URL))).toMatchObject({
      errorClass: "unsupported",
      detail: PDF_SKIP_NOTE,
    });
    expect(site.requests).toHaveLength(0);
    expect(await refusal(fetcher.fetch(`${SITE}/papers/mpc-landing`))).toMatchObject({
      errorClass: "unsupported",
      detail: PDF_SKIP_NOTE,
    });
  });

  it("classifies a non-text type as unsupported", async () => {
    const error = await refusal(reader().fetcher.fetch(`${SITE}/images/dock.png`));

    expect(error).toMatchObject({ errorClass: "unsupported" });
    expect(error.detail).toContain("image/png is not readable text");
  });

  it("reads a text type as it is", async () => {
    const fetched = await reader().fetcher.fetch(`${SITE}/notes.txt`);

    expect(fetched).toMatchObject({
      contentType: "text/plain",
      extractor: "plain-text",
      title: null,
    });
    expect(fetched.text).toBe("Plain notes about docking.\nSecond line.");
  });

  it("classifies a refused page, a throttle and a dead host", async () => {
    const { fetcher } = reader();

    expect(await refusal(fetcher.fetch(MISSING_URL))).toMatchObject({
      errorClass: "upstream",
      detail: "docs.example.test answered 404 for /missing",
    });
    expect(await refusal(fetcher.fetch(`${SITE}/busy`))).toMatchObject({
      errorClass: "rate_limited",
      retryAfterSeconds: 30,
    });
    expect(await refusal(fetcher.fetch(UNREACHABLE_URL))).toMatchObject({ errorClass: "network" });
  });

  it("answers a refused address as a failure, not a skip", async () => {
    const pages = fixtureSitePages();
    pages.set("http://10.0.0.5/robots.txt", page(404));
    pages.set(
      "http://10.0.0.5/admin",
      new PageTransportError("blocked", "refused by the URL policy"),
    );

    expect((await refusal(reader(pages).fetcher.fetch("http://10.0.0.5/admin"))).errorClass).toBe(
      "upstream",
    );
  });

  it("decodes a declared charset", async () => {
    const pages = fixtureSitePages();
    pages.set(
      `${SITE}/latin`,
      page(200, Buffer.from([0x63, 0x61, 0x66, 0xe9]), {
        "content-type": "text/plain; charset=iso-8859-1",
      }),
    );

    expect((await reader(pages).fetcher.fetch(`${SITE}/latin`)).text).toBe("café");
  });
});

describe("the reader's helpers", () => {
  it("reads only absolute http(s) URLs without credentials, dropping the fragment", () => {
    expect(pageUrl("https://example.com/a#b").toString()).toBe("https://example.com/a");
    for (const bad of [
      "not a url",
      "ftp://example.com/x",
      "file:///etc/passwd",
      "https://u:p@example.com/",
    ]) {
      expect(() => pageUrl(bad)).toThrow(ResearchToolError);
    }
  });

  it("recognises a PDF by its path", () => {
    expect(isPdfPath(new URL("https://x.test/a/B.PDF"))).toBe(true);
    expect(isPdfPath(new URL("https://x.test/a/pdf-guide"))).toBe(false);
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterSeconds("12")).toBe(12);
    expect(retryAfterSeconds(undefined)).toBeNull();
    expect(retryAfterSeconds("soon")).toBeNull();
    expect(retryAfterSeconds(new Date(Date.now() + 60_000).toUTCString())).toBeGreaterThan(50);
  });
});
