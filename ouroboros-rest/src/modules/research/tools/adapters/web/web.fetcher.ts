/**
 * The page reader — ours whichever provider found the page (decision V3).
 *
 * ```
 * fetch(url) ─▶ http(s)? ─▶ *.pdf? ─▶ "papers tool arrives in v2"          (unsupported → skip)
 *            ─▶ robots.txt allows it?  ─▶ no ─▶ robots_denied              (recorded as a skip)
 *            ─▶ wait our turn for the host (interval, or its crawl-delay)
 *            ─▶ GET, bytes capped, timed out ─▶ 3xx? next hop (bounded, each hop re-checked)
 *            ─▶ content type: html → main content · text → as is · pdf → v2 skip · other → skip
 *            ─▶ {title, text, hash of every byte read, final URL}
 * ```
 *
 * **robots.txt** is read once per origin and cached for a day. A 4xx means the site has no rules;
 * an unreachable or 5xx robots.txt means *assume disallowed*, as RFC 9309 requires — a site that
 * cannot say what it allows has not allowed anything.
 *
 * **Politeness is per host**: requests to one host start at least `OURO_RESEARCH_HOST_INTERVAL_MS`
 * apart — or the site's `crawl-delay`, when it asks for longer (bounded at
 * {@link MAX_CRAWL_DELAY_MS}) — and one host's requests are made one at a time.
 */

import { createHash } from "node:crypto";

import { ResearchToolError } from "../../research-tool.errors";
import { EXTRACTOR, extractMainContent } from "./web.extract";
import {
  ALLOW_ALL,
  DISALLOW_ALL,
  ROBOTS_AGENT_TOKEN,
  parseRobots,
  robotsAllows,
  type RobotsPolicy,
} from "./web.robots";
import { PageTransportError, type PageResponse, type PageTransport } from "./web.transport";

/** The User-Agent every request carries — robots.txt addresses it by its product token. */
export const USER_AGENT = `${ROBOTS_AGENT_TOKEN}/1.0 (+https://ouroboros.build/research-reader)`;

/** The note a PDF is skipped with — the docs, standards & papers tool reads them (#635). */
export const PDF_SKIP_NOTE =
  "papers tool arrives in v2 — PDFs are read by Docs, standards & papers (#635), not the page reader";

/** How long a robots.txt verdict is trusted. */
export const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

/** How long an unreadable robots.txt is held as *disallowed* before it is asked again. */
export const ROBOTS_FAILURE_TTL_MS = 5 * 60 * 1000;

/** The longest crawl-delay honoured — a site asking for more is paced at this. */
export const MAX_CRAWL_DELAY_MS = 30_000;

/** The most bytes of a robots.txt read; RFC 9309 asks readers to parse at least 500 KiB. */
export const ROBOTS_MAX_BYTES = 512 * 1024;

/** The bounds the reader is held to — the `OURO_RESEARCH_*` variables. */
export interface FetchLimits {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects: number;
  readonly hostIntervalMs: number;
}

/** A page read and extracted. */
export interface FetchedPage {
  /** The URL asked for. */
  readonly requestedUrl: string;
  /** The URL the content came from, after redirects. */
  readonly finalUrl: string;
  /** Redirects followed. */
  readonly redirects: number;
  readonly status: number;
  /** The media type, without parameters — `text/html`. */
  readonly contentType: string;
  /** The page's title, or null. */
  readonly title: string | null;
  /** The main content as plain text. */
  readonly text: string;
  /** Bytes read. */
  readonly bytes: number;
  /** Whether the page was longer than the cap, so only its start was read. */
  readonly truncated: boolean;
  /** `sha256:<hex>` of every byte read. */
  readonly contentHash: string;
  /** The extractor — `main-content-v1`, or `plain-text` for a text type. */
  readonly extractor: string;
  /**
   * The whole response body, decoded — the HTML before extraction, the feed before parsing. For
   * a reader that scopes the page itself (the competitor tracker's selectors, #616).
   */
  readonly document: string;
}

/** The clock and the pause, injectable so politeness is testable without waiting. */
export interface FetchClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

/** The real clock. */
export const SYSTEM_CLOCK: FetchClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

interface RobotsEntry {
  readonly policy: RobotsPolicy;
  readonly expiresAt: number;
}

/** The page reader. One per process: its robots cache and host pacing are shared. */
export class PageFetcher {
  private readonly robots = new Map<string, RobotsEntry>();

  private readonly hostQueues = new Map<string, Promise<void>>();

  private readonly nextStart = new Map<string, number>();

  /**
   * @param transport - The socket.
   * @param limits - The bounds.
   * @param clock - The clock; the system's by default.
   */
  constructor(
    private readonly transport: PageTransport,
    private readonly limits: FetchLimits,
    private readonly clock: FetchClock = SYSTEM_CLOCK,
  ) {}

  /**
   * Read one page.
   *
   * @param locator - The page's URL.
   * @returns The page, extracted, with the hash of what was read.
   * @throws {ResearchToolError} `unsupported` for a URL or a type the reader does not read (a PDF,
   *   an image), `robots_denied` when robots.txt forbids it, `rate_limited` on a 429, `network` when
   *   nothing answered, `upstream` for a refused page or too many redirects.
   */
  async fetch(locator: string): Promise<FetchedPage> {
    let url = pageUrl(locator);

    if (isPdfPath(url)) {
      throw new ResearchToolError("unsupported", PDF_SKIP_NOTE);
    }

    for (let redirects = 0; ; redirects += 1) {
      const policy = await this.robotsFor(url);
      const pathAndQuery = `${url.pathname}${url.search}`;
      const verdict = robotsAllows(policy, pathAndQuery);

      if (!verdict.allowed) {
        throw new ResearchToolError(
          "robots_denied",
          `robots.txt disallows ${url.pathname} for ${ROBOTS_AGENT_TOKEN}${verdict.rule === null ? "" : ` (${verdict.rule})`}`,
        );
      }

      const response = await this.politely(url, policy, () => this.get(url, this.limits.maxBytes));

      if (isRedirect(response.status) && response.headers.location !== undefined) {
        if (redirects >= this.limits.maxRedirects) {
          throw new ResearchToolError(
            "upstream",
            `more than ${String(this.limits.maxRedirects)} redirects from ${locator}`,
          );
        }
        url = pageUrl(new URL(response.headers.location, url).toString());
        if (isPdfPath(url)) throw new ResearchToolError("unsupported", PDF_SKIP_NOTE);
        continue;
      }

      refuseStatus(response, url);

      return this.read(locator, url, redirects, response);
    }
  }

  /**
   * The robots policy for a URL's origin — cached, or read now.
   *
   * @param url - Any URL of the origin.
   * @returns The reader's policy there.
   */
  private async robotsFor(url: URL): Promise<RobotsPolicy> {
    const origin = url.origin;
    const cached = this.robots.get(origin);

    if (cached !== undefined && cached.expiresAt > this.clock.now()) return cached.policy;

    let policy: RobotsPolicy;
    let ttl = ROBOTS_TTL_MS;

    try {
      let robotsUrl = new URL("/robots.txt", origin);
      let response: PageResponse | null = null;

      for (let hop = 0; hop <= 5; hop += 1) {
        const target = robotsUrl;
        response = await this.politely(target, ALLOW_ALL, () => this.get(target, ROBOTS_MAX_BYTES));
        if (!isRedirect(response.status) || response.headers.location === undefined) break;
        robotsUrl = new URL(response.headers.location, robotsUrl);
      }

      if (response === null || isRedirect(response.status)) {
        policy = ALLOW_ALL;
      } else if (response.status >= 200 && response.status < 300) {
        policy = parseRobots(response.body.toString("utf8"));
      } else if (response.status >= 400 && response.status < 500) {
        policy = ALLOW_ALL;
      } else {
        policy = DISALLOW_ALL;
        ttl = ROBOTS_FAILURE_TTL_MS;
      }
    } catch {
      policy = DISALLOW_ALL;
      ttl = ROBOTS_FAILURE_TTL_MS;
    }

    this.robots.set(origin, { policy, expiresAt: this.clock.now() + ttl });
    return policy;
  }

  /**
   * Run a request in the host's turn: one at a time, spaced by the interval or the crawl-delay.
   *
   * @param url - The request's URL.
   * @param policy - The host's robots policy, for its crawl-delay.
   * @param work - The request.
   * @returns What the request answered.
   */
  private politely<T>(url: URL, policy: RobotsPolicy, work: () => Promise<T>): Promise<T> {
    const host = url.host;
    const spacing = Math.max(
      this.limits.hostIntervalMs,
      Math.min((policy.crawlDelaySeconds ?? 0) * 1000, MAX_CRAWL_DELAY_MS),
    );
    const previous = this.hostQueues.get(host) ?? Promise.resolve();
    const turn = previous.then(async () => {
      const wait = (this.nextStart.get(host) ?? 0) - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      this.nextStart.set(host, this.clock.now() + spacing);
      return work();
    });

    this.hostQueues.set(
      host,
      turn.then(
        () => undefined,
        () => undefined,
      ),
    );
    return turn;
  }

  /**
   * One GET, with its failures classified.
   *
   * @param url - The URL.
   * @param maxBytes - The body cap.
   * @returns The response.
   */
  private async get(url: URL, maxBytes: number): Promise<PageResponse> {
    try {
      return await this.transport.get({
        url,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "accept-encoding": "identity",
        },
        timeoutMs: this.limits.timeoutMs,
        maxBytes,
      });
    } catch (error) {
      if (error instanceof PageTransportError) {
        // A refused address is a refusal, not a skip: the reader will not read inside the
        // deployment's network unless an operator allowed it.
        throw new ResearchToolError(
          error.failure === "blocked" ? "upstream" : "network",
          `${url.host}: ${error.detail}`,
        );
      }
      throw new ResearchToolError("network", `${url.host}: the request failed`);
    }
  }

  /**
   * A 2xx page, classified by type and extracted.
   *
   * @param locator - The URL asked for.
   * @param url - The URL the response came from.
   * @param redirects - Hops followed.
   * @param response - The response.
   * @returns The page.
   */
  private read(locator: string, url: URL, redirects: number, response: PageResponse): FetchedPage {
    const contentType = mediaType(response.headers["content-type"]);
    const base = {
      requestedUrl: locator,
      finalUrl: url.toString(),
      redirects,
      status: response.status,
      contentType,
      bytes: response.body.length,
      truncated: response.truncated,
      contentHash: `sha256:${createHash("sha256").update(response.body).digest("hex")}`,
    };

    if (contentType === "application/pdf") {
      throw new ResearchToolError("unsupported", PDF_SKIP_NOTE);
    }

    const decoded = decode(response.body, response.headers["content-type"]);

    if (
      contentType === "text/html" ||
      contentType === "application/xhtml+xml" ||
      contentType === ""
    ) {
      const extracted = extractMainContent(decoded);
      return {
        ...base,
        title: extracted.title,
        text: extracted.text,
        extractor: EXTRACTOR,
        document: decoded,
      };
    }

    if (
      contentType.startsWith("text/") ||
      contentType === "application/json" ||
      contentType.endsWith("+json") ||
      contentType.endsWith("xml")
    ) {
      return {
        ...base,
        title: null,
        text: decoded.trim(),
        extractor: "plain-text",
        document: decoded,
      };
    }

    throw new ResearchToolError(
      "unsupported",
      `${contentType} is not readable text — the page reader reads HTML and text`,
    );
  }
}

/**
 * A locator, as a URL the reader will read.
 *
 * @param locator - What was asked for.
 * @returns The URL.
 * @throws {ResearchToolError} `unsupported` for anything but an absolute http(s) URL without
 *   credentials.
 */
export function pageUrl(locator: string): URL {
  let url: URL;

  try {
    url = new URL(locator);
  } catch {
    throw new ResearchToolError("unsupported", "the page reader reads absolute http(s) URLs");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ResearchToolError(
      "unsupported",
      `the page reader does not read ${url.protocol} URLs`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ResearchToolError(
      "unsupported",
      "the page reader does not read URLs carrying credentials",
    );
  }

  url.hash = "";
  return url;
}

/**
 * Whether a URL names a PDF by its path.
 *
 * @param url - The URL.
 * @returns `true` for `….pdf`.
 */
export function isPdfPath(url: URL): boolean {
  return /\.pdf$/i.test(url.pathname);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Refuse a response that is not a page.
 *
 * @param response - The response.
 * @param url - Its URL, for the detail.
 * @throws {ResearchToolError} `rate_limited` on a 429 (with its Retry-After), `upstream` on any
 *   other non-2xx.
 */
function refuseStatus(response: PageResponse, url: URL): void {
  if (response.status >= 200 && response.status < 300) return;

  if (response.status === 429) {
    throw new ResearchToolError(
      "rate_limited",
      `${url.host} asked the reader to slow down (429)`,
      retryAfterSeconds(response.headers["retry-after"]),
    );
  }

  throw new ResearchToolError(
    "upstream",
    `${url.host} answered ${String(response.status)} for ${url.pathname}`,
  );
}

/**
 * A Retry-After header, in seconds.
 *
 * @param header - Seconds, or an HTTP date.
 * @returns Seconds, or null when absent or unreadable.
 */
export function retryAfterSeconds(header: string | undefined): number | null {
  if (header === undefined) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * The body as text, in its declared charset.
 *
 * @param body - The bytes.
 * @param header - The Content-Type header.
 * @returns The decoded text; UTF-8 when the charset is absent or unknown.
 */
function decode(body: Buffer, header: string | undefined): string {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(header ?? "")?.[1]?.toLowerCase() ?? "utf-8";

  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}
