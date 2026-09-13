import { Logger } from "@nestjs/common";

import { budgetHeaders, httpError } from "../../github/github.fixture";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { LOG_METHODS } from "../../vault/no-secret-logging";
import { statusReasonFor, TicketSourceError } from "../ticket-source.errors";
import { GithubTicketSourceProvider } from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_TOKEN,
  issuePayload,
  recordingFactory,
  scriptedOctokit,
  syncContext,
  type OctokitScript,
} from "./github.provider.fixture";

/**
 * **The grep test, for the provider.** Q.3's last acceptance criterion
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)): *"credentials never appear in a
 * response or a log line"*.
 *
 * `github/github.secrecy.spec.ts` makes this claim about the credential *lifecycle* — set,
 * read, rotate, clear. This one makes it about the **sync**, which is a different set of sinks:
 * a provider's outputs are a `TicketPage`, a `TicketSourceValidation` that a settings form
 * renders, a `TicketSourceError` whose `detail` reaches a log, and the `status_reason` that
 * error becomes on a row. All four are watched below, on the failure paths as well as the happy
 * one — because the shortest path to a leaked token is a provider that echoes a tracker's error
 * body, and tracker error bodies quote request headers.
 *
 * It greps for **fragments** rather than for the whole token, for the reason K.3's suite gives:
 * a leak that printed the last thirty characters would not contain the token, and would be a
 * leak.
 */

/** How long a run of the token has to appear before this suite calls it a leak. */
const FRAGMENT = 8;

/**
 * Every run of {@link FRAGMENT} characters from a secret — what a partial leak looks like.
 *
 * @param secret - The value that must not appear.
 * @returns Its overlapping fragments.
 */
function fragmentsOf(secret: string): string[] {
  const runs: string[] = [];

  for (let at = 0; at + FRAGMENT <= secret.length; at += 1) {
    runs.push(secret.slice(at, at + FRAGMENT));
  }

  return runs;
}

/**
 * Assert that nothing in `haystack` contains any recognisable piece of `secret`.
 *
 * @param haystack - Everything that left the provider, as one string.
 * @param secret - The token.
 */
function expectNoTrace(haystack: string, secret: string): void {
  for (const fragment of fragmentsOf(secret)) {
    expect(haystack).not.toContain(fragment);
  }
}

describe("what leaves the provider when a source's token is used", () => {
  let logged: unknown[];

  /**
   * Build the provider with every log sink captured.
   *
   * @param script - What the scripted GitHub answers.
   * @returns The provider.
   */
  function build(script: OctokitScript): GithubTicketSourceProvider {
    const { factory } = recordingFactory(scriptedOctokit(script));

    return new GithubTicketSourceProvider(factory, new GithubRateLimiter());
  }

  beforeEach(() => {
    logged = [];

    // Every level the lint rule knows about, on both sinks — so a module that acquires a
    // second logger is watched here without this file being edited.
    for (const method of LOG_METHODS) {
      const sinks = [Logger.prototype, console] as unknown as Record<string, unknown>[];

      for (const sink of sinks) {
        if (typeof sink[method] === "function") {
          jest
            .spyOn(sink as unknown as Record<string, () => void>, method as never)
            .mockImplementation(((...args: unknown[]) => {
              logged.push(...args);
            }) as never);
        }
      }
    }
  });

  /**
   * Everything any sink saw, as one string to grep.
   *
   * @returns The log, flattened.
   */
  function everythingLogged(): string {
    return logged
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
  }

  it("leaks nothing through a sync that succeeds", async () => {
    const provider = build({
      issues: { [SOURCE_REPO]: [[issuePayload(), { number: 2 }]] },
    });

    const page = await provider.fullSync(syncContext());

    expectNoTrace(JSON.stringify(page), SOURCE_TOKEN);
    expectNoTrace(everythingLogged(), SOURCE_TOKEN);
  });

  it("leaks nothing through a Test connection that succeeds", async () => {
    const provider = build({ repos: { [SOURCE_REPO]: true } });

    const result = await provider.validateConfig(
      { login: SOURCE_LOGIN, repos: [SOURCE_REPO] },
      SOURCE_TOKEN,
    );

    expectNoTrace(JSON.stringify(result), SOURCE_TOKEN);
    expectNoTrace(everythingLogged(), SOURCE_TOKEN);
  });

  it.each([
    ["a rejected token", httpError(401, { "x-ouro-echo": SOURCE_TOKEN })],
    ["a repository it cannot see", httpError(404, { "x-ouro-echo": SOURCE_TOKEN })],
    ["a spent budget", httpError(403, { ...budgetHeaders({ remaining: 0 }), "retry-after": "60" })],
    ["GitHub's own failure", httpError(503)],
    ["a socket that closed", Object.assign(new Error(`bad credentials: ${SOURCE_TOKEN}`), {})],
  ])("leaks nothing when a sync fails on %s", async (_case, error) => {
    // The header above is the shape this suite exists for: GitHub's error bodies and headers
    // quote the request, and a provider that echoed one would put the token on a settings page.
    const provider = build({ issuesFail: { [SOURCE_REPO]: error } });
    let thrown: TicketSourceError | undefined;

    try {
      await provider.fullSync(syncContext());
    } catch (raised) {
      thrown = raised as TicketSourceError;
    }

    expect(thrown).toBeInstanceOf(TicketSourceError);
    // The `detail` reaches a log; the `status_reason` reaches a screen. Both are checked,
    // because they are composed by different code.
    expectNoTrace(String(thrown?.detail), SOURCE_TOKEN);
    expectNoTrace(statusReasonFor(thrown as TicketSourceError), SOURCE_TOKEN);
    expectNoTrace(everythingLogged(), SOURCE_TOKEN);
  });

  it.each([
    ["a rejected token", httpError(401, { "x-ouro-echo": SOURCE_TOKEN })],
    ["a repository it cannot see", httpError(404)],
    ["a spent budget", httpError(403, budgetHeaders({ remaining: 0 }))],
    ["a socket that closed", new Error(`bad credentials: ${SOURCE_TOKEN}`)],
  ])("leaks nothing when a Test connection fails on %s", async (_case, error) => {
    const provider = build({ repos: { [SOURCE_REPO]: error } });

    const result = await provider.validateConfig(
      { login: SOURCE_LOGIN, repos: [SOURCE_REPO] },
      SOURCE_TOKEN,
    );

    expect(result.status).toBe("failed");
    expectNoTrace(JSON.stringify(result), SOURCE_TOKEN);
    expectNoTrace(everythingLogged(), SOURCE_TOKEN);
  });

  it("leaks nothing when the configuration itself carries something token-shaped", async () => {
    // Somebody pasting a token into the wrong field is the mistake this catches: the config is
    // echoed into a refusal's words, and it must be echoed by key rather than by value.
    const provider = build({});

    const result = await provider.validateConfig(
      { login: SOURCE_TOKEN, repos: [SOURCE_REPO] },
      SOURCE_TOKEN,
    );

    expect(result).toMatchObject({ status: "failed", errorClass: "not_found" });
    expectNoTrace(JSON.stringify(result), SOURCE_TOKEN);
    expectNoTrace(everythingLogged(), SOURCE_TOKEN);
  });

  it("keeps no copy of the token on the provider itself", async () => {
    // A provider is a singleton. One that kept a credential in a field would hold a plaintext
    // token across every request the process serves.
    const provider = build({ issues: { [SOURCE_REPO]: [[]] } });

    await provider.fullSync(syncContext());

    expectNoTrace(JSON.stringify(provider), SOURCE_TOKEN);
    expectNoTrace(JSON.stringify(Object.values(provider)), SOURCE_TOKEN);
  });
});
