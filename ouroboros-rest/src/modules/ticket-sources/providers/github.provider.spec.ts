import { Logger } from "@nestjs/common";

import { GithubRateLimiter } from "../../github/github.rate-limit";
import { budgetHeaders, httpError } from "../../github/github.fixture";
import { TicketSourceError, statusReasonFor } from "../ticket-source.errors";
import { supportsWrites, writeMemberViolations, type TicketPage } from "../ticket-source.provider";
import { MAX_ENABLED_REPOS } from "./github.config";
import { GITHUB_FAILURES, GithubApiError } from "../../github/github.errors";
import {
  GithubTicketSourceProvider,
  MAX_TICKETS_PER_SYNC,
  REPO_ROUTE,
  REDACTED,
  asTicketSourceError,
  budgetPerRepo,
  redactTokens,
} from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_TOKEN,
  issuePayload,
  issueRun,
  pullRequestPayload,
  recordingFactory,
  scriptedOctokit,
  syncContext,
  type OctokitScript,
} from "./github.provider.fixture";
import { ISSUES_ROUTE } from "./github.mapping";

/**
 * The first conforming plugin, against a scripted GitHub
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)).
 *
 * What is asserted here is the second of the three levels `docs/TICKET_SOURCES.md` § 8 names:
 * *"the provider against a stubbed HTTP layer — pagination, the cursor round trip, each of the
 * four error classes"*. The first level is `github.mapping.spec.ts`; the third is Q.5's
 * conformance kit ([#142](https://github.com/NobuData/ouroboros/issues/142)), which runs one
 * suite against every provider and is the ticket that makes *pluggable* something other than a
 * claim.
 *
 * **The intake MVP's sync criteria are the headings below**, because this issue's first
 * acceptance criterion is that they *"all hold when running through the SPI"*: a cold import
 * lands all open issues with pull requests excluded, a no-change poll costs O(1) requests and
 * touches no rows, an upstream edit appears within one poll, and closing flips state.
 */

/** What a cursor from a previous poll looks like. */
const CURSOR = "2026-09-11T09:00:00.000Z";

/**
 * Build the provider over a scripted GitHub.
 *
 * @param script - What each repository answers.
 * @returns The provider, the stand-in, and every token a client was built for.
 */
function build(script: OctokitScript = {}) {
  const octokit = scriptedOctokit(script);
  const { factory, tokens } = recordingFactory(octokit);

  return {
    octokit,
    tokens,
    // A guard per suite, not a shared one: the provider's budget is deliberately *not*
    // `GithubModule`'s singleton, and a test that reused one would carry a spent budget from
    // one case into the next.
    provider: new GithubTicketSourceProvider(factory, new GithubRateLimiter()),
  };
}

/** How many HTTP requests a walk of the issues endpoint made. */
function issueRequests(calls: readonly { route: string }[]): number {
  return calls.filter((call) => call.route === ISSUES_ROUTE).length;
}

/**
 * The parameters of the first issues request.
 *
 * @param calls - What the stand-in recorded.
 * @returns The query the provider sent.
 */
function firstQuery(
  calls: readonly { route: string; params: Readonly<Record<string, unknown>> }[],
): Readonly<Record<string, unknown>> {
  const call = calls.find((candidate) => candidate.route === ISSUES_ROUTE);

  if (call === undefined) {
    throw new Error("the provider made no request to the issues endpoint");
  }

  return call.params;
}

describe("the GitHub ticket source provider", () => {
  beforeEach(() => {
    // The walk reports an unreadable payload rather than failing the page, which is behaviour
    // one case below asserts and every other case would only have to read past.
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  it("registers as the kind V030's column spells", () => {
    expect(build().provider.kind).toBe("github");
  });

  it("declares labels, no webhooks, and every write — stably", () => {
    // Stability is a requirement rather than an observation: the registry checks the webhook
    // flag once, at boot, and an affordance that changed between two renders would be one that
    // then failed.
    const { provider } = build();

    expect(provider.capabilities()).toStrictEqual({
      webhooks: false,
      labels: true,
      // AL.3 (#279): native dependencies, milestones, and epics as parent issues with sub-issues.
      bidirectionalWrites: true,
      write: {
        createTicket: true,
        nativeDependencies: true,
        epicMapping: "parent_issue",
        milestones: true,
      },
      // AX.1 (#357): every merge strategy, reviews, and a poll — the webhook slot waits for #122.
      pr: {
        pullRequests: true,
        create: true,
        mergeStrategies: ["merge", "squash", "rebase"],
        reviews: true,
        events: "poll",
      },
    });
    expect(provider.capabilities()).toStrictEqual(provider.capabilities());
    expect(supportsWrites(provider)).toBe(true);
    expect(writeMemberViolations(provider)).toStrictEqual([]);
  });

  describe("a cold import", () => {
    it("lands every open issue", async () => {
      const { provider } = build({ issues: { [SOURCE_REPO]: [issueRun(3)] } });

      const page = await provider.fullSync(syncContext());

      expect(page.tickets).toHaveLength(3);
      expect(page.tickets.map((ticket) => ticket.externalKey)).toStrictEqual(["#1", "#2", "#3"]);
    });

    it("asks for the open ones only, with no watermark", async () => {
      // The entitlement the SPI grants a provider: "a cold import that dragged in a decade of
      // closed issues would be a first sync nobody wants".
      const { provider, octokit } = build({ issues: { [SOURCE_REPO]: [issueRun(1)] } });

      await provider.fullSync(syncContext());

      expect(firstQuery(octokit.calls)).toMatchObject({
        owner: SOURCE_LOGIN,
        repo: SOURCE_REPO,
        state: "open",
        sort: "updated",
        direction: "asc",
      });
      expect(firstQuery(octokit.calls).since).toBeUndefined();
    });

    it("excludes pull requests, because a PR in the backlog is a bug users see immediately", async () => {
      const { provider } = build({
        issues: {
          [SOURCE_REPO]: [
            [
              issuePayload({ number: 1 }),
              pullRequestPayload({ number: 2 }),
              issuePayload({ number: 3 }),
            ],
          ],
        },
      });

      const page = await provider.fullSync(syncContext());

      expect(page.tickets.map((ticket) => ticket.externalKey)).toStrictEqual(["#1", "#3"]);
    });

    it("walks every page of a repository", async () => {
      const { provider } = build({
        issues: { [SOURCE_REPO]: [issueRun(2, { from: 1 }), issueRun(2, { from: 3 })] },
      });

      const page = await provider.fullSync(syncContext());

      expect(page.tickets).toHaveLength(4);
    });

    it("walks every enabled repository, which is the config's repo scoping", async () => {
      const { provider } = build({
        issues: {
          "helios-firmware": [issueRun(2, { from: 1, repo: "helios-firmware" })],
          "atlas-scheduler": [issueRun(1, { from: 9, repo: "atlas-scheduler" })],
        },
      });

      const page = await provider.fullSync(
        syncContext({
          config: { login: SOURCE_LOGIN, repos: ["helios-firmware", "atlas-scheduler"] },
        }),
      );

      expect(page.tickets.map((ticket) => ticket.meta)).toContainEqual({
        github: { owner: SOURCE_LOGIN, repo: "atlas-scheduler" },
      });
      expect(page.tickets).toHaveLength(3);
    });

    it("orders the page ascending by sourceUpdatedAt, which is what resumability rests on", async () => {
      const { provider } = build({
        issues: {
          a: [[issuePayload({ number: 2, repo: "a", updated_at: "2026-09-11T12:00:00Z" })]],
          b: [[issuePayload({ number: 1, repo: "b", updated_at: "2026-09-11T08:00:00Z" })]],
        },
      });

      const page = await provider.fullSync(
        syncContext({ config: { login: SOURCE_LOGIN, repos: ["a", "b"] } }),
      );

      expect(page.tickets.map((ticket) => ticket.externalKey)).toStrictEqual(["#1", "#2"]);
    });
  });

  describe("the cursor", () => {
    it("is the newest instant the page saw, not the process's clock", async () => {
      // A clock-derived cursor is wrong by however far this host has drifted from GitHub's,
      // and it is wrong in the direction that loses tickets.
      const { provider } = build({
        issues: { [SOURCE_REPO]: [issueRun(3, { since: new Date("2026-09-05T00:00:00.000Z") })] },
      });

      const page = await provider.fullSync(syncContext());

      expect(page.nextCursor).toBe("2026-09-05T00:02:00.000Z");
      expect(page.hasMore).toBe(false);
    });

    it("comes back unread on the next poll, as `since`", async () => {
      const { provider, octokit } = build({ issues: { [SOURCE_REPO]: [[]] } });

      await provider.incrementalSync(syncContext(), CURSOR);

      expect(firstQuery(octokit.calls)).toMatchObject({ since: CURSOR, state: "all" });
    });

    it("is null when a poll saw nothing, which leaves the stored one alone", async () => {
      // Not a way to clear a cursor: `''` is refused by the column, and a cursor of `''` is a
      // poller that re-imports the whole backlog every pass.
      const { provider } = build({ issues: { [SOURCE_REPO]: [[]] } });

      const page = await provider.incrementalSync(syncContext(), CURSOR);

      expect(page.nextCursor).toBeNull();
      expect(page.tickets).toStrictEqual([]);
    });

    it("stops at the weakest frontier when one repository was cut short", async () => {
      // The part a multi-repository source gets wrong if it is written the obvious way. `b`
      // finished at 12:00; `a` was cut short at 08:01. Advancing to 12:00 would put the
      // watermark past tickets in `a` that nobody has fetched — and `since` is how they would
      // have been found.
      const share = budgetPerRepo(2);
      const { provider } = build({
        issues: {
          a: [issueRun(share + 1, { repo: "a", since: new Date("2026-09-11T08:00:00.000Z") })],
          b: [[issuePayload({ number: 900, repo: "b", updated_at: "2026-09-11T12:00:00Z" })]],
        },
      });

      const page = await provider.fullSync(
        syncContext({ config: { login: SOURCE_LOGIN, repos: ["a", "b"] } }),
      );

      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe(
        new Date(
          new Date("2026-09-11T08:00:00.000Z").getTime() + (share - 1) * 60_000,
        ).toISOString(),
      );
    });

    it("treats a watermark that will not parse as no watermark, rather than sending nonsense", async () => {
      const { provider, octokit } = build({ issues: { [SOURCE_REPO]: [[]] } });

      await provider.incrementalSync(syncContext(), "the other day");

      expect(firstQuery(octokit.calls)).toMatchObject({ state: "open" });
      expect(firstQuery(octokit.calls).since).toBeUndefined();
    });
  });

  describe("a no-change poll", () => {
    it("costs one request per enabled repository and answers an empty page", async () => {
      // The intake MVP's criterion, through the SPI: O(1) requests, and a page the loop writes
      // nothing for.
      const { provider, octokit } = build({ issues: { a: [[]], b: [[]] } });

      const page = await provider.incrementalSync(
        syncContext({ config: { login: SOURCE_LOGIN, repos: ["a", "b"] } }),
        CURSOR,
      );

      expect(issueRequests(octokit.calls)).toBe(2);
      expect(page).toStrictEqual<TicketPage>({ tickets: [], nextCursor: null, hasMore: false });
    });
  });

  describe("an upstream change", () => {
    it("appears within one poll", async () => {
      const { provider } = build({
        issues: {
          [SOURCE_REPO]: [[issuePayload({ number: 485, title: "Edited upstream" })]],
        },
      });

      const page = await provider.incrementalSync(syncContext(), CURSOR);

      expect(page.tickets[0]?.title).toBe("Edited upstream");
    });

    it("flips state when an issue is closed, because an incremental poll asks for `all`", async () => {
      // `state=open` cannot express a close: an issue that stops being listed "sits in the
      // mirror as open forever".
      const { provider, octokit } = build({
        issues: { [SOURCE_REPO]: [[issuePayload({ number: 485, state: "closed" })]] },
      });

      const page = await provider.incrementalSync(syncContext(), CURSOR);

      expect(firstQuery(octokit.calls).state).toBe("all");
      expect(page.tickets[0]?.state).toBe("closed");
    });
  });

  describe("the page budget", () => {
    it("is divided across the enabled repositories, so none sits unvisited", () => {
      expect(budgetPerRepo(1)).toBe(MAX_TICKETS_PER_SYNC);
      expect(budgetPerRepo(4)).toBe(MAX_TICKETS_PER_SYNC / 4);
      expect(budgetPerRepo(MAX_ENABLED_REPOS)).toBeGreaterThanOrEqual(1);
    });

    it("asks for another cycle when a repository had more to give", async () => {
      const share = budgetPerRepo(1);
      const { provider } = build({ issues: { [SOURCE_REPO]: [issueRun(share + 1)] } });

      const page = await provider.fullSync(syncContext());

      expect(page.tickets).toHaveLength(share);
      expect(page.hasMore).toBe(true);
    });

    it("does not ask for another cycle when the share was merely filled exactly", async () => {
      // `hasMore` books the next cycle in a second rather than a full interval, so a `true`
      // that meant "possibly nothing" would be a poller that never rests.
      const share = budgetPerRepo(1);
      const { provider } = build({ issues: { [SOURCE_REPO]: [issueRun(share)] } });

      const page = await provider.fullSync(syncContext());

      expect(page.tickets).toHaveLength(share);
      expect(page.hasMore).toBe(false);
    });

    it("stops reading pages once a repository's share is spent", async () => {
      const share = budgetPerRepo(1);
      const { provider, octokit } = build({
        issues: {
          [SOURCE_REPO]: [issueRun(share), issueRun(share, { from: share + 1 }), issueRun(1)],
        },
      });

      await provider.fullSync(syncContext());

      // Two pages read, the third never asked for: the generator stops when the reader does.
      expect(issueRequests(octokit.calls)).toBe(2);
    });
  });

  describe("a payload it cannot read", () => {
    it("is skipped rather than costing the workspace its whole sync", async () => {
      const warned = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const { provider } = build({
        issues: {
          [SOURCE_REPO]: [
            [issuePayload({ number: 1 }), { number: 2 }, issuePayload({ number: 3 })],
          ],
        },
      });

      const page = await provider.fullSync(syncContext());

      expect(page.tickets.map((ticket) => ticket.externalKey)).toStrictEqual(["#1", "#3"]);
      // Skipped, and said so: a mirror that silently dropped a row would be one nobody could
      // account for.
      expect(warned).toHaveBeenCalledTimes(1);
    });

    it("still throws when it is the one payload a caller asked about", () => {
      // The walk's policy is the walk's; `mapTicket` answers for exactly what it was handed.
      const { provider } = build();

      expect(() => provider.mapTicket({ number: 2 })).toThrow(TicketSourceError);
    });
  });

  describe("failing", () => {
    /**
     * Run a sync whose walk rejects, and return the error the loop would record.
     *
     * @param error - What GitHub threw.
     * @returns The translated failure.
     */
    async function failure(error: Error): Promise<TicketSourceError> {
      const { provider } = build({ issuesFail: { [SOURCE_REPO]: error } });

      try {
        await provider.fullSync(syncContext());
      } catch (thrown) {
        return thrown as TicketSourceError;
      }

      throw new Error("the provider completed a sync it should have failed");
    }

    it("calls a rejected token `auth`", async () => {
      expect((await failure(httpError(401))).errorClass).toBe("auth");
    });

    it("calls a 403 with budget left `auth`, because that is a missing scope", async () => {
      const error = await failure(httpError(403, budgetHeaders({ remaining: 4000 })));

      expect(error.errorClass).toBe("auth");
    });

    it("calls a repository it cannot see `not_found`", async () => {
      expect((await failure(httpError(404))).errorClass).toBe("not_found");
    });

    it("calls GitHub's own failure `upstream`", async () => {
      expect((await failure(httpError(503))).errorClass).toBe("upstream");
    });

    it("calls a socket that closed `upstream`, because there is no `network` class", async () => {
      expect((await failure(new Error("socket hang up"))).errorClass).toBe("upstream");
    });

    it("refuses a source with no token as `auth`, rather than polling GitHub anonymously", async () => {
      // Sixty requests an hour shared across the host is a source that fails unpredictably.
      const { provider, octokit } = build();

      await expect(provider.fullSync(syncContext({ credentials: null }))).rejects.toThrow(
        TicketSourceError,
      );
      expect(octokit.calls).toStrictEqual([]);
    });

    it("refuses a configuration it cannot read as `not_found`, before any request", async () => {
      const { provider, octokit } = build();

      await expect(
        provider.fullSync(syncContext({ config: { login: "acme/robotics", repos: ["x"] } })),
      ).rejects.toMatchObject({ errorClass: "not_found" });
      expect(octokit.calls).toStrictEqual([]);
    });
  });

  describe("a spent rate limit", () => {
    it("is `rate_limit`, and carries when the window lifts", async () => {
      const { provider } = build({
        issuesFail: {
          [SOURCE_REPO]: httpError(403, {
            ...budgetHeaders({ remaining: 0 }),
            "retry-after": "900",
          }),
        },
      });

      let thrown: TicketSourceError | undefined;

      try {
        await provider.fullSync(syncContext());
      } catch (error) {
        thrown = error as TicketSourceError;
      }

      expect(thrown?.errorClass).toBe("rate_limit");
      expect(thrown?.retryAt).toBeInstanceOf(Date);
    });

    it("becomes the honest source status a person reads", () => {
      // The one piece of provider knowledge that reaches a person unchanged, because there is
      // no neutral way to say *when*. This is the acceptance criterion, end to end.
      const error = new TicketSourceError(
        "rate_limit",
        "403 with Retry-After: 900",
        new Date("2026-09-12T14:20:00.000Z"),
      );

      expect(statusReasonFor(error)).toBe("rate limited until 14:20 UTC");
    });

    it("stands down on the next call rather than spending the budget again", async () => {
      // K.3's guard, reached through the provider: once the walk has learned the budget is
      // spent, the next sync is refused before a request is made.
      const { provider, octokit } = build({
        issuesFail: {
          [SOURCE_REPO]: httpError(429, {
            ...budgetHeaders({ remaining: 0 }),
            "retry-after": "900",
          }),
        },
      });

      await expect(provider.fullSync(syncContext())).rejects.toThrow(TicketSourceError);
      const spent = issueRequests(octokit.calls);

      await expect(provider.fullSync(syncContext())).rejects.toMatchObject({
        errorClass: "rate_limit",
      });
      expect(issueRequests(octokit.calls)).toBe(spent);
    });
  });

  describe("validateConfig — Q.4's Test connection", () => {
    it("is a real round-trip: one probe per enabled repository", async () => {
      const { provider, octokit } = build({ repos: { a: true, b: true } });

      const result = await provider.validateConfig(
        { login: SOURCE_LOGIN, repos: ["a", "b"] },
        SOURCE_TOKEN,
      );

      expect(result).toStrictEqual({ status: "ok", detail: `${SOURCE_LOGIN} · 2 repositories` });
      expect(octokit.calls.filter((call) => call.route === REPO_ROUTE)).toHaveLength(2);
    });

    it("says something, so somebody can see they pointed it at the thing they meant", async () => {
      const { provider } = build({ repos: { [SOURCE_REPO]: true } });

      await expect(
        provider.validateConfig({ login: SOURCE_LOGIN, repos: [SOURCE_REPO] }, SOURCE_TOKEN),
      ).resolves.toMatchObject({ detail: `${SOURCE_LOGIN} · 1 repository` });
    });

    it("answers a failure rather than rejecting, for a configuration it cannot read", async () => {
      // "A provider that threw here would make a form's error state depend on whether somebody
      // remembered a `try`."
      const { provider } = build();

      await expect(
        provider.validateConfig({ login: "acme/robotics", repos: [] }, SOURCE_TOKEN),
      ).resolves.toMatchObject({ status: "failed", errorClass: "not_found" });
    });

    it("answers a failure when there is no token at all", async () => {
      const { provider, octokit } = build();

      await expect(
        provider.validateConfig({ login: SOURCE_LOGIN, repos: ["a"] }, null),
      ).resolves.toMatchObject({ status: "failed", errorClass: "auth" });
      expect(octokit.calls).toStrictEqual([]);
    });

    it.each([
      ["a rejected token", httpError(401), "auth"],
      ["a repository it cannot see", httpError(404), "not_found"],
      ["a spent budget", httpError(403, budgetHeaders({ remaining: 0 })), "rate_limit"],
      ["a missing scope", httpError(403, budgetHeaders({ remaining: 4000 })), "auth"],
      ["GitHub's own failure", httpError(502), "upstream"],
      ["a socket that closed", new Error("socket hang up"), "upstream"],
    ])("answers %s as a result, not a rejection", async (_case, error, errorClass) => {
      const { provider } = build({ repos: { a: error } });

      await expect(
        provider.validateConfig({ login: SOURCE_LOGIN, repos: ["a"] }, SOURCE_TOKEN),
      ).resolves.toMatchObject({ status: "failed", errorClass });
    });

    it("names the repository that failed, because a form cannot render 'one of them'", async () => {
      const { provider } = build({ repos: { a: true, b: httpError(404) } });

      const result = await provider.validateConfig(
        { login: SOURCE_LOGIN, repos: ["a", "b"] },
        SOURCE_TOKEN,
      );

      expect(result).toMatchObject({ status: "failed" });
      expect(result.detail).toContain(`${SOURCE_LOGIN}/b`);
    });
  });

  it("builds a client for the source's own credential, never for a stored one", async () => {
    // The credential arrives on the context and is handed to the seam. Nothing here reads a
    // workspace's settings token, which is what `GithubClientFactory` would have done.
    const { provider, tokens } = build({ issues: { [SOURCE_REPO]: [[]] } });

    await provider.fullSync(syncContext({ credentials: "ghp_adifferenttokenentirely00000000000" }));

    expect(tokens).toStrictEqual(["ghp_adifferenttokenentirely00000000000"]);
  });

  it("holds no credential between calls, because a provider is a singleton", async () => {
    const { provider } = build({ issues: { [SOURCE_REPO]: [[]] } });

    await provider.fullSync(syncContext());

    // Every own and inherited field, read the way a leak would be found: by looking.
    expect(JSON.stringify(Object.values(provider))).not.toContain(SOURCE_TOKEN);
  });

  it("computes a resume time from the clock it is given, not from the process's", () => {
    // `asTicketSourceError` takes a clock so this is a value rather than a range. The wait
    // comes from GitHub's `Retry-After`; the instant is that wait applied to *now*.
    const at = new Date("2026-09-12T13:05:00.000Z");
    const spent = new GithubApiError(GITHUB_FAILURES.rateLimited, "429; standing down", 900);

    expect(asTicketSourceError(spent, at).retryAt).toStrictEqual(
      new Date("2026-09-12T13:20:00.000Z"),
    );
    expect(statusReasonFor(asTicketSourceError(spent, at))).toBe("rate limited until 13:20 UTC");
  });

  describe("redacting a message this module did not compose", () => {
    // `GithubClient` describes a call that failed before an answer by quoting the underlying
    // error, and what a library's error says is its business. This is the net under that rope;
    // on every ordinary path it returns its argument unchanged.
    it.each([
      ["a classic token", "ghp_qwertyuiopasdfghjklzxcvbnm0123456789"],
      ["a fine-grained one", "github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ01"],
      ["an OAuth one", "gho_qwertyuiopasdfghjklzxcvbnm0123456789"],
      ["a server-to-server one", "ghs_qwertyuiopasdfghjklzxcvbnm0123456789"],
      ["a pre-2021 one", "0123456789abcdef0123456789abcdef01234567"],
    ])("hides %s buried in a sentence", (_case, token) => {
      const redacted = redactTokens(`GET /repos failed before an answer: bad credentials ${token}`);

      expect(redacted).toContain(REDACTED);
      expect(redacted).not.toContain(token);
    });

    it("leaves a message with nothing token-shaped in it exactly as it was", () => {
      const detail = "GET /repos/{owner}/{repo}/issues answered 503";

      expect(redactTokens(detail)).toBe(detail);
    });
  });

  it("passes a failure it already understands through unchanged", () => {
    // A `TicketSourceError` raised by the config parse or by `tokenOf` must not be re-wrapped
    // as `upstream` on its way out of the walk.
    const refusal = new TicketSourceError("auth", "this source has no GitHub token");

    expect(asTicketSourceError(refusal)).toBe(refusal);
  });
});
