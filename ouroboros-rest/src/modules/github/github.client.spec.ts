import { ETAG_HEADER, GithubClient, IF_NONE_MATCH, PER_PAGE, headerReader } from "./github.client";
import { GITHUB_FAILURES, GithubApiError } from "./github.errors";
import {
  FIXTURE_WORKSPACE,
  budgetHeaders,
  fakeOctokit,
  httpError,
  response,
  type FakeOctokit,
} from "./github.fixture";
import { GithubRateLimiter, RATE_LIMIT_FLOOR, RETRY_AFTER_HEADER } from "./github.rate-limit";

/**
 * What the client is responsible for, and nothing the library is.
 *
 * Octokit's own behaviour — following the `Link` header, injecting the token, turning a `304`
 * into a rejection — is `github.octokit.spec.ts`'s subject, driven against the real library.
 * What is here is the four things this file adds on top, each of which is an acceptance
 * criterion or the reason one holds:
 *
 *   * the guard runs **before** the request, so the reserve stays a reserve;
 *   * every response teaches the guard, **including the failures**;
 *   * a walk yields pages and holds none of them;
 *   * every way GitHub can refuse becomes one of five named reasons.
 */

const ISSUES = "GET /repos/{owner}/{repo}/issues";

/** A page of rows, shaped like issues without pretending to be them. */
function issues(from: number, count: number): { number: number }[] {
  return Array.from({ length: count }, (_unused, at) => ({ number: from + at }));
}

/** Plenty of budget, so a case about something else is not about the guard. */
function healthy(): Record<string, string> {
  return budgetHeaders({ remaining: 4999 });
}

describe("the GitHub client", () => {
  let limiter: GithubRateLimiter;

  beforeEach(() => {
    limiter = new GithubRateLimiter();
  });

  /** A client over a scripted library. */
  function clientOver(octokit: FakeOctokit): GithubClient {
    return new GithubClient(FIXTURE_WORKSPACE, octokit, limiter);
  }

  describe("one request", () => {
    it("answers the body and the ETag to send next time", async () => {
      const octokit = fakeOctokit([
        response({ full_name: "nobudata/ouroboros" }, { ...healthy(), [ETAG_HEADER]: `W/"abc"` }),
      ]);

      const result = await clientOver(octokit).request<{ full_name: string }>("GET /repos/x/y");

      expect(result.data).toEqual({ full_name: "nobudata/ouroboros" });
      expect(result.etag).toBe(`W/"abc"`);
      expect(result.notModified).toBe(false);
    });

    it("sends no conditional header when there is no ETag to send", async () => {
      const octokit = fakeOctokit([response({}, healthy())]);

      await clientOver(octokit).request("GET /repos/x/y");

      // `If-None-Match: ""` is a condition that can never match, which would silently
      // *disable* caching rather than skip it.
      expect(octokit.calls[0].params).not.toHaveProperty("headers");
    });

    it("sends the ETag as a conditional request when there is one", async () => {
      const octokit = fakeOctokit([response({}, healthy())]);

      await clientOver(octokit).request("GET /repos/x/y", {}, `W/"abc"`);

      expect(octokit.calls[0].params).toMatchObject({ headers: { [IF_NONE_MATCH]: `W/"abc"` } });
    });

    it("reports a 304 as an answer rather than as a failure", async () => {
      // The library rejects for every non-2xx, so *nothing has changed* — the outcome a
      // poller wants most — arrives down the same path as a `500`.
      const octokit = fakeOctokit([httpError(304, healthy())]);

      const result = await clientOver(octokit).request("GET /repos/x/y", {}, `W/"abc"`);

      expect(result.notModified).toBe(true);
      expect(result.data).toBeUndefined();
      expect(result.etag).toBe(`W/"abc"`);
    });

    it("learns the budget from the response", async () => {
      const octokit = fakeOctokit([response({}, budgetHeaders({ remaining: 1234 }))]);

      await clientOver(octokit).request("GET /repos/x/y");

      expect(limiter.snapshot(FIXTURE_WORKSPACE)?.remaining).toBe(1234);
    });
  });

  describe("walking pages", () => {
    it("asks for the largest page GitHub allows", async () => {
      const octokit = fakeOctokit([response(issues(1, 1), healthy())]);

      for await (const _page of clientOver(octokit).pages(ISSUES, { owner: "x", repo: "y" })) {
        break;
      }

      // The budget is counted in requests rather than rows, so a hundred-per-page walk of a
      // thousand issues costs ten requests where the default thirty would cost thirty-four.
      expect(octokit.calls[0].params).toMatchObject({ per_page: PER_PAGE });
    });

    it("yields each page in order and holds none of them", async () => {
      const octokit = fakeOctokit([
        response(issues(1, 2), healthy()),
        response(issues(3, 2), healthy()),
        response(issues(5, 1), healthy()),
      ]);

      const sizes: number[] = [];
      let highWater = 0;

      for await (const page of clientOver(octokit).pages<{ number: number }>(ISSUES)) {
        sizes.push(page.items.length);
        // The claim the criterion is about: what the walk hands over at any moment is one
        // page, never the accumulation. A generator that had buffered would show it here.
        highWater = Math.max(highWater, page.items.length);
      }

      expect(sizes).toEqual([2, 2, 1]);
      expect(highWater).toBe(2);
    });

    it("stops the walk when the caller stops reading", async () => {
      const octokit = fakeOctokit([
        response(issues(1, 2), healthy()),
        response(issues(3, 2), healthy()),
        response(issues(5, 2), healthy()),
      ]);

      for await (const _page of clientOver(octokit).pages(ISSUES)) {
        break;
      }

      // One request, not three: a caller that found what it wanted has not spent the rest of
      // the budget on pages nobody read.
      expect(octokit.calls).toHaveLength(1);
    });

    it("reports the first page's ETag and no other page's", async () => {
      const octokit = fakeOctokit([
        response(issues(1, 1), { ...healthy(), [ETAG_HEADER]: `W/"page-1"` }),
        response(issues(2, 1), { ...healthy(), [ETAG_HEADER]: `W/"page-2"` }),
      ]);

      const etags: (string | undefined)[] = [];

      for await (const page of clientOver(octokit).pages(ISSUES)) {
        etags.push(page.etag);
      }

      // The next poll asks *"has anything changed"* of the list, which is the first page's
      // question. A later page's ETag would be an answer about a window that moves.
      expect(etags).toEqual([`W/"page-1"`, undefined]);
    });

    it("answers a matching ETag with one not-modified page and no walk", async () => {
      const octokit = fakeOctokit([httpError(304, healthy())]);

      const pages = [];

      for await (const page of clientOver(octokit).pages(ISSUES, {}, `W/"abc"`)) {
        pages.push(page);
      }

      // Yielded rather than an empty walk: an empty walk is what a repository with no issues
      // produces, and a poller that could not tell them apart would clear its mirror.
      expect(pages).toEqual([{ items: [], notModified: true, etag: `W/"abc"` }]);
    });

    it("stops partway when the budget crosses the floor mid-walk", async () => {
      const octokit = fakeOctokit([
        response(issues(1, 1), budgetHeaders({ remaining: RATE_LIMIT_FLOOR + 1 })),
        response(issues(2, 1), budgetHeaders({ remaining: RATE_LIMIT_FLOOR })),
        response(issues(3, 1), healthy()),
      ]);

      const seen: number[] = [];

      await expect(
        (async () => {
          for await (const page of clientOver(octokit).pages<{ number: number }>(ISSUES)) {
            seen.push(page.items[0].number);
          }
        })(),
      ).rejects.toThrow(GithubApiError);

      // The third page is never asked for: the pages after the floor are exactly the ones
      // worth not sending.
      expect(seen).toEqual([1, 2]);
      expect(octokit.calls).toHaveLength(2);
    });
  });

  describe("the guard, before the request", () => {
    it("refuses without sending anything once the floor is reached", async () => {
      limiter.observe(FIXTURE_WORKSPACE, headerReader(budgetHeaders({ remaining: 0 })));
      const octokit = fakeOctokit([response({}, healthy())]);

      await expect(clientOver(octokit).request("GET /repos/x/y")).rejects.toThrow(GithubApiError);
      expect(octokit.calls).toHaveLength(0);
    });
  });

  describe("classifying what GitHub answered", () => {
    it.each([
      ["401", 401, GITHUB_FAILURES.unauthorized],
      ["404", 404, GITHUB_FAILURES.notFound],
      ["500", 500, GITHUB_FAILURES.upstreamError],
      ["429", 429, GITHUB_FAILURES.rateLimited],
    ])("turns a %s into %s", async (_case, status, failure) => {
      const octokit = fakeOctokit([httpError(status, healthy())]);

      await expect(clientOver(octokit).request("GET /repos/x/y")).rejects.toMatchObject({
        failure,
      });
    });

    it("reads a 403 with a spent budget as a rate limit", async () => {
      const octokit = fakeOctokit([httpError(403, budgetHeaders({ remaining: 0 }))]);

      await expect(clientOver(octokit).request("GET /repos/x/y")).rejects.toMatchObject({
        failure: GITHUB_FAILURES.rateLimited,
      });
    });

    it("reads a 403 with retry-after as a secondary limit, and stands down", async () => {
      // The acceptance criterion's mocked `403 + retry-after`, seen from the client's side:
      // the refusal has to be *recorded*, or the very next call would be let through.
      const octokit = fakeOctokit([
        httpError(403, { ...healthy(), [RETRY_AFTER_HEADER]: "120" }),
        response({}, healthy()),
      ]);
      const client = clientOver(octokit);

      await expect(client.request("GET /repos/x/y")).rejects.toMatchObject({
        failure: GITHUB_FAILURES.rateLimited,
        retryAfterSeconds: 120,
      });

      await expect(client.request("GET /repos/x/y")).rejects.toThrow(GithubApiError);
      expect(octokit.calls).toHaveLength(1);
    });

    it("reads a 403 with budget remaining as a missing scope, not as a limit", async () => {
      // An administrator who has to widen a token's scopes should not be told to wait for a
      // limit that will never lift.
      const octokit = fakeOctokit([httpError(403, healthy())]);

      await expect(clientOver(octokit).request("GET /repos/x/y")).rejects.toMatchObject({
        failure: GITHUB_FAILURES.unauthorized,
      });
    });

    it("learns the budget from a failure, because a 404 spends a request too", async () => {
      const octokit = fakeOctokit([httpError(404, budgetHeaders({ remaining: 777 }))]);

      await expect(clientOver(octokit).request("GET /repos/x/y")).rejects.toThrow(GithubApiError);
      expect(limiter.snapshot(FIXTURE_WORKSPACE)?.remaining).toBe(777);
    });

    it("classifies a socket failure, which carries no status at all", async () => {
      const octokit = fakeOctokit([new Error("getaddrinfo ENOTFOUND api.github.com")]);

      await expect(clientOver(octokit).request("GET /repos/x/y")).rejects.toMatchObject({
        failure: GITHUB_FAILURES.upstreamError,
      });
    });

    it("passes its own refusal through rather than re-wrapping it as an upstream error", async () => {
      const octokit = fakeOctokit([
        httpError(403, { ...healthy(), [RETRY_AFTER_HEADER]: "60" }),
        response({}, healthy()),
      ]);
      const client = clientOver(octokit);

      await expect(client.request("GET /repos/x/y")).rejects.toThrow(GithubApiError);

      // The second call is refused by the guard *inside* the try, and it must not come back
      // as `upstream_error` — the sync would render "GitHub is down" for a stand-down this
      // service chose.
      await expect(client.request("GET /repos/x/y")).rejects.toMatchObject({
        failure: GITHUB_FAILURES.rateLimited,
      });
    });

    it("names no token in anything it throws", async () => {
      const octokit = fakeOctokit([httpError(401, healthy())]);

      await expect(clientOver(octokit).request("GET /repos/x/y")).rejects.toThrow(
        /GitHub rejected this workspace's token/,
      );
    });
  });

  describe("reporting the budget", () => {
    it("answers what the shared guard knows for this workspace", async () => {
      const octokit = fakeOctokit([response({}, budgetHeaders({ remaining: 42 }))]);
      const client = clientOver(octokit);

      await client.request("GET /repos/x/y");

      expect(client.rateLimit()?.remaining).toBe(42);
    });
  });
});
