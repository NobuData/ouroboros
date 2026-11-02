/**
 * The GitHub provider's repository-access read (DK.1, [#1318](https://github.com/NobuData/ouroboros/issues/1318))
 * — driven through the provider over a scripted Octokit, so the rate guard and the failure
 * classification are the real ones.
 */

import { budgetHeaders, fakeOctokit, httpError, response } from "../../github/github.fixture";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { supportsRepositoryAccess } from "../ticket-source.access";
import { TicketSourceError } from "../ticket-source.errors";
import type { TicketSourceProvider } from "../ticket-source.provider";
import { GithubTicketSourceProvider } from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  recordingFactory,
  syncContext,
} from "./github.provider.fixture";

/** Healthy budget headers. */
const HEALTHY = budgetHeaders({ remaining: 4999 });

/**
 * A provider over a script.
 *
 * @param answers - What GitHub answers, in order.
 * @returns The provider and the fake.
 */
function build(answers: Parameters<typeof fakeOctokit>[0]) {
  const octokit = fakeOctokit(answers);

  return {
    octokit,
    provider: new GithubTicketSourceProvider(
      recordingFactory(octokit).factory,
      new GithubRateLimiter(),
    ),
  };
}

describe("repositoryAccess", () => {
  it("asks GitHub for the push target once, and reads the push permission", async () => {
    const { provider, octokit } = build([
      response({ full_name: "x", permissions: { push: true, pull: true } }, HEALTHY),
    ]);

    await expect(provider.repositoryAccess(syncContext())).resolves.toEqual({
      repository: `${SOURCE_LOGIN}/${SOURCE_REPO}`,
      push: true,
    });
    expect(octokit.calls).toEqual([
      { route: "GET /repos/{owner}/{repo}", params: { owner: SOURCE_LOGIN, repo: SOURCE_REPO } },
    ]);
  });

  it("says false for an account that can only read, and null for an answer without permissions", async () => {
    const denied = build([response({ permissions: { push: false, pull: true } }, HEALTHY)]);
    const silent = build([response({ full_name: "x" }, HEALTHY)]);

    await expect(denied.provider.repositoryAccess(syncContext())).resolves.toMatchObject({
      push: false,
    });
    await expect(silent.provider.repositoryAccess(syncContext())).resolves.toMatchObject({
      push: null,
    });
  });

  it.each([
    [404, "not_found"],
    [401, "auth"],
  ])("classifies a %i as %s", async (status, errorClass) => {
    const { provider } = build([httpError(status)]);

    const error: unknown = await provider.repositoryAccess(syncContext()).catch((e: unknown) => e);

    expect(TicketSourceError.is(error)).toBe(true);
    expect((error as TicketSourceError).errorClass).toBe(errorClass);
  });
});

describe("supportsRepositoryAccess", () => {
  it("holds for the GitHub provider", () => {
    expect(supportsRepositoryAccess(build([]).provider)).toBe(true);
  });

  it("does not hold for a provider without pull requests or without the member", () => {
    const noPrs = {
      capabilities: () => ({ pr: { pullRequests: false } }),
      repositoryAccess: () => Promise.resolve({ repository: "a/b", push: true }),
    } as unknown as TicketSourceProvider;
    const noMember = {
      capabilities: () => ({ pr: { pullRequests: true } }),
    } as unknown as TicketSourceProvider;

    expect(supportsRepositoryAccess(noPrs)).toBe(false);
    expect(supportsRepositoryAccess(noMember)).toBe(false);
  });
});
