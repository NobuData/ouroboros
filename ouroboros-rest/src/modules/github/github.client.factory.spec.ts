import { GithubClient } from "./github.client";
import { GithubClientFactory } from "./github.client.factory";
import type { GithubCredentialsService } from "./github.credentials.service";
import { GITHUB_FAILURES, GithubApiError } from "./github.errors";
import { FIXTURE_TOKEN, FIXTURE_WORKSPACE, fakeOctokit } from "./github.fixture";
import { GithubRateLimiter } from "./github.rate-limit";

/**
 * Three claims, and each is the reason the factory exists rather than callers building
 * clients:
 *
 *   * the token is opened **per call**, so a rotation cannot be outrun by a cached client;
 *   * a workspace with no token is refused **before** any network is touched, as a designed
 *     reason rather than as whatever a client would have done with an empty string;
 *   * every client for a workspace shares one rate guard, because the budget belongs to the
 *     token and two clients are spending one allowance.
 */

describe("the GitHub client factory", () => {
  let credentials: jest.Mocked<GithubCredentialsService>;
  let limiter: GithubRateLimiter;
  let handed: string[];
  let factory: GithubClientFactory;

  beforeEach(() => {
    handed = [];
    limiter = new GithubRateLimiter();
    credentials = {
      tokenFor: jest.fn().mockResolvedValue(FIXTURE_TOKEN),
    } as unknown as jest.Mocked<GithubCredentialsService>;

    factory = new GithubClientFactory(credentials, limiter, (token) => {
      handed.push(token);
      return fakeOctokit([]);
    });
  });

  it("builds a client for the workspace it was asked about", async () => {
    const client = await factory.forOrganization(FIXTURE_WORKSPACE);

    expect(client).toBeInstanceOf(GithubClient);
    expect(client.organizationId).toBe(FIXTURE_WORKSPACE);
  });

  it("hands the library the workspace's token and nothing else", async () => {
    await factory.forOrganization(FIXTURE_WORKSPACE);

    expect(credentials.tokenFor).toHaveBeenCalledWith(FIXTURE_WORKSPACE);
    expect(handed).toEqual([FIXTURE_TOKEN]);
  });

  it("opens the token again for every client, rather than caching one", async () => {
    await factory.forOrganization(FIXTURE_WORKSPACE);
    await factory.forOrganization(FIXTURE_WORKSPACE);

    // What makes "rotate → the old token is never used again" structural: there is nowhere
    // for a stale credential to live between the column and the call.
    expect(credentials.tokenFor).toHaveBeenCalledTimes(2);
  });

  it("refuses a workspace with no token, without building anything", async () => {
    credentials.tokenFor.mockRejectedValue(
      new GithubApiError(GITHUB_FAILURES.notConfigured, "no token"),
    );

    await expect(factory.forOrganization(FIXTURE_WORKSPACE)).rejects.toMatchObject({
      failure: GITHUB_FAILURES.notConfigured,
    });
    expect(handed).toEqual([]);
  });

  it("shares one rate guard across every client for a workspace", async () => {
    const first = await factory.forOrganization(FIXTURE_WORKSPACE);
    const second = await factory.forOrganization(FIXTURE_WORKSPACE);

    limiter.pause(FIXTURE_WORKSPACE, () => "30");

    // Two clients, one budget — because the limit is per token and both are spending it.
    expect(first.rateLimit()?.pausedUntil).toBeDefined();
    expect(second.rateLimit()?.pausedUntil).toEqual(first.rateLimit()?.pausedUntil);
  });
});
