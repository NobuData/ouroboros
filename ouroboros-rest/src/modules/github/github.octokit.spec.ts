import { GithubClient } from "./github.client";
import { FIXTURE_TOKEN, FIXTURE_WORKSPACE, budgetHeaders } from "./github.fixture";
import { GITHUB_TIMEOUT_MS, USER_AGENT, createOctokit } from "./github.octokit";
import { GithubRateLimiter } from "./github.rate-limit";

/**
 * The only suite that loads the real `@octokit/rest`, and the reason the ES-module transform
 * in `jest.config.mjs` names it.
 *
 * Everything else under `src/modules/github/` is written against `OctokitLike` and tested
 * with a plain object — which is the right trade for code this product owns, and the wrong
 * one for the three claims below, because each of them is a claim about the **library**:
 *
 *   * the token is injected as an `Authorization` header and never has to be passed at a
 *     call site;
 *   * pagination follows GitHub's `Link` header, so a walk is a walk rather than a loop over
 *     a page counter this product would have to keep right;
 *   * a matching ETag comes back as a **rejection** carrying `304`, which is the behaviour
 *     `GithubClient.conditionalMiss` exists to translate — and if the library ever stopped
 *     doing it, a fake that agreed with our code would go on passing.
 *
 * A stub `fetch` rather than a network: real library, real request pipeline, no GitHub.
 */

/** What the stub was asked for. */
interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal | null | undefined;
}

/** One canned answer. */
interface Canned {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/** A `fetch` that answers from a script and records what it was asked. */
function stubFetch(answers: readonly Canned[]): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  let next = 0;

  const impl: typeof fetch = (input, init) => {
    const request = new Request(input, init);

    sent.push({
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      signal: init?.signal,
    });

    const canned = answers[Math.min(next, answers.length - 1)];

    next += 1;

    return Promise.resolve(
      new Response(canned.status === 304 ? null : JSON.stringify(canned.body), {
        status: canned.status,
        headers: {
          "content-type": "application/json",
          ...budgetHeaders({ remaining: 4999 }),
          ...canned.headers,
        },
      }),
    );
  };

  return { fetch: impl, sent };
}

/** The `Link` header GitHub sends to point at the next page. */
function linkTo(url: string): string {
  return `<${url}>; rel="next"`;
}

describe("the Octokit seam", () => {
  it("injects the token as an Authorization header, at every call site at once", async () => {
    const { fetch: impl, sent } = stubFetch([{ status: 200, body: { id: 1 } }]);

    await createOctokit({ token: FIXTURE_TOKEN, fetchImpl: impl }).request(
      "GET /repos/{owner}/{repo}",
      {
        owner: "nobudata",
        repo: "ouroboros",
      },
    );

    expect(sent[0].headers.authorization).toBe(`token ${FIXTURE_TOKEN}`);
  });

  it("identifies this service to GitHub", async () => {
    const { fetch: impl, sent } = stubFetch([{ status: 200, body: {} }]);

    await createOctokit({ token: FIXTURE_TOKEN, fetchImpl: impl }).request("GET /rate_limit");

    expect(sent[0].headers["user-agent"]).toContain(USER_AGENT);
  });

  it("honours a base URL, which is what a GitHub Enterprise Server deployment needs", async () => {
    const { fetch: impl, sent } = stubFetch([{ status: 200, body: {} }]);

    await createOctokit({
      token: FIXTURE_TOKEN,
      baseUrl: "https://github.example.com/api/v3",
      fetchImpl: impl,
    }).request("GET /rate_limit");

    expect(sent[0].url).toBe("https://github.example.com/api/v3/rate_limit");
  });

  it("bounds every request with a deadline the call site cannot forget", async () => {
    const { fetch: impl, sent } = stubFetch([{ status: 200, body: {} }]);

    await createOctokit({ token: FIXTURE_TOKEN, fetchImpl: impl }).request("GET /rate_limit");

    // The signal is asserted rather than the ten seconds: waiting out GITHUB_TIMEOUT_MS to
    // prove a timeout exists would put that long into every run of the suite.
    expect(sent[0].signal).toBeInstanceOf(AbortSignal);
    expect(GITHUB_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("follows the Link header rather than counting pages itself", async () => {
    const { fetch: impl, sent } = stubFetch([
      {
        status: 200,
        body: [{ number: 1 }],
        headers: { link: linkTo("https://api.github.com/repositories/1/issues?page=2") },
      },
      { status: 200, body: [{ number: 2 }] },
    ]);

    const client = new GithubClient(
      FIXTURE_WORKSPACE,
      createOctokit({ token: FIXTURE_TOKEN, fetchImpl: impl }),
      new GithubRateLimiter(),
    );

    const numbers: number[] = [];

    for await (const page of client.pages<{ number: number }>("GET /repos/{owner}/{repo}/issues", {
      owner: "nobudata",
      repo: "ouroboros",
    })) {
      numbers.push(...page.items.map((issue) => issue.number));
    }

    expect(numbers).toEqual([1, 2]);
    expect(sent[1].url).toBe("https://api.github.com/repositories/1/issues?page=2");
  });

  it("rejects a matching ETag with a 304, which is what the client translates back", async () => {
    const { fetch: impl, sent } = stubFetch([{ status: 304, body: null }]);

    const client = new GithubClient(
      FIXTURE_WORKSPACE,
      createOctokit({ token: FIXTURE_TOKEN, fetchImpl: impl }),
      new GithubRateLimiter(),
    );

    const result = await client.request(
      "GET /repos/{owner}/{repo}",
      { owner: "x", repo: "y" },
      `W/"abc"`,
    );

    expect(sent[0].headers["if-none-match"]).toBe(`W/"abc"`);
    expect(result.notModified).toBe(true);
  });
});
