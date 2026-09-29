/**
 * GitHub's repository probes ([#384](https://github.com/NobuData/ouroboros/issues/384)) — the three
 * members the detector rides, driven through the provider over a scripted Octokit, so the rate
 * guard, the coverage check and the failure classification are the real ones.
 */

import {
  budgetHeaders,
  fakeOctokit,
  httpError,
  response,
  type ScriptedAnswer,
} from "../../github/github.fixture";
import { headerReader } from "../../github/github.client";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { TicketSourceError } from "../ticket-source.errors";
import { MAX_PROBE_FILE_BYTES } from "../ticket-source.probe";
import {
  PROBE_MEMBERS,
  probeMemberViolations,
  supportsRepoProbes,
} from "../ticket-source.provider";
import {
  CONTENTS_ROUTE,
  GITHUB_PROBE_CAPABILITIES,
  LANGUAGES_ROUTE,
  TREE_ROUTE,
  decodeBase64,
  probeTargetOf,
} from "./github.probe";
import { GithubTicketSourceProvider } from "./github.provider";
import {
  SOURCE_CONFIG,
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_WORKSPACE,
  recordingFactory,
  syncContext,
} from "./github.provider.fixture";

/** The covered repository, as the detector names it. */
const REPO = `${SOURCE_LOGIN}/${SOURCE_REPO}`;

/** Healthy budget headers. */
const HEALTHY = budgetHeaders({ remaining: 4999 });

/**
 * A provider over a script, with the limiter it shares.
 *
 * @param answers - What GitHub answers, in order.
 * @returns The provider, the fake and the limiter.
 */
function build(answers: readonly ScriptedAnswer[]) {
  const octokit = fakeOctokit(answers);
  const limiter = new GithubRateLimiter();

  return {
    octokit,
    limiter,
    provider: new GithubTicketSourceProvider(recordingFactory(octokit).factory, limiter),
  };
}

/**
 * The error a promise rejected with.
 *
 * @param promise - The promise.
 * @returns The `TicketSourceError` it rejected with.
 */
async function refusal(promise: Promise<unknown>): Promise<TicketSourceError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(TicketSourceError.is(error)).toBe(true);

  return error as TicketSourceError;
}

/**
 * A contents response for a file.
 *
 * @param text - The file's text.
 * @returns The body GitHub sends.
 */
function contents(text: string): Record<string, unknown> {
  return {
    type: "file",
    size: Buffer.byteLength(text),
    encoding: "base64",
    content: Buffer.from(text).toString("base64"),
  };
}

describe("the GitHub provider's probe declaration", () => {
  it("declares repository probes, and has all four members", () => {
    const { provider } = build([]);

    expect(provider.capabilities().probe).toBe(GITHUB_PROBE_CAPABILITIES);
    expect(supportsRepoProbes(provider)).toBe(true);
    expect(probeMemberViolations(provider)).toStrictEqual([]);
    expect(PROBE_MEMBERS).toEqual(["coversRepo", "repoLanguages", "repoTree", "repoFile"]);
  });
});

describe("coversRepo", () => {
  const { provider } = build([]);

  it("covers a repository the config lists, however it is cased", () => {
    expect(provider.coversRepo(SOURCE_CONFIG, REPO)).toBe(true);
    expect(provider.coversRepo(SOURCE_CONFIG, REPO.toUpperCase())).toBe(true);
  });

  it("covers nothing else — another repository, another account, a nested path", () => {
    expect(provider.coversRepo(SOURCE_CONFIG, `${SOURCE_LOGIN}/other`)).toBe(false);
    expect(provider.coversRepo(SOURCE_CONFIG, `someone-else/${SOURCE_REPO}`)).toBe(false);
    expect(provider.coversRepo(SOURCE_CONFIG, `${REPO}/deeper`)).toBe(false);
  });

  it("covers nothing for a config that does not parse, rather than throwing", () => {
    expect(provider.coversRepo({ nonsense: true }, REPO)).toBe(false);
    expect(provider.coversRepo(null, REPO)).toBe(false);
  });

  it("addresses the repository as the config spells it", () => {
    expect(probeTargetOf({ login: "Acme", repos: ["Helios"] }, "acme/helios")).toEqual({
      owner: "Acme",
      repo: "Helios",
    });
  });
});

describe("repoLanguages", () => {
  it("asks the languages endpoint once and keeps the byte counts", async () => {
    const { provider, octokit } = build([
      response({ C: 920_000, CMake: 50_000, Bogus: "many", Negative: -1 }, HEALTHY),
    ]);

    await expect(provider.repoLanguages(syncContext(), REPO)).resolves.toEqual({
      C: 920_000,
      CMake: 50_000,
    });
    expect(octokit.calls).toEqual([
      { route: LANGUAGES_ROUTE, params: { owner: SOURCE_LOGIN, repo: SOURCE_REPO } },
    ]);
  });
});

describe("repoTree", () => {
  it("lists every path of HEAD in one recursive request", async () => {
    const { provider, octokit } = build([
      response(
        {
          truncated: false,
          tree: [
            { path: "boot", type: "tree" },
            { path: "boot/main.c", type: "blob" },
            { path: "zephyr", type: "commit" },
            { path: 42, type: "blob" },
          ],
        },
        HEALTHY,
      ),
    ]);

    await expect(provider.repoTree(syncContext(), REPO)).resolves.toEqual({
      truncated: false,
      entries: [
        { path: "boot", type: "dir" },
        { path: "boot/main.c", type: "file" },
        { path: "zephyr", type: "file" },
      ],
    });
    expect(octokit.calls[0]).toEqual({
      route: TREE_ROUTE,
      params: { owner: SOURCE_LOGIN, repo: SOURCE_REPO, tree_sha: "HEAD", recursive: "1" },
    });
  });

  it("says when GitHub cut the listing short", async () => {
    const { provider } = build([response({ truncated: true, tree: [] }, HEALTHY)]);

    await expect(provider.repoTree(syncContext(), REPO)).resolves.toEqual({
      truncated: true,
      entries: [],
    });
  });

  it("answers an empty repository (409) with no paths rather than a failure", async () => {
    const { provider } = build([httpError(409, HEALTHY)]);

    await expect(provider.repoTree(syncContext(), REPO)).resolves.toEqual({
      truncated: false,
      entries: [],
    });
  });

  it("classifies a repository the token cannot see as not_found", async () => {
    const { provider } = build([httpError(404, HEALTHY)]);

    expect((await refusal(provider.repoTree(syncContext(), REPO))).errorClass).toBe("not_found");
  });
});

describe("repoFile", () => {
  it("decodes one file", async () => {
    const { provider, octokit } = build([response(contents("manifest:\n  self: {}\n"), HEALTHY)]);

    await expect(provider.repoFile(syncContext(), REPO, "west.yml")).resolves.toEqual({
      path: "west.yml",
      content: "manifest:\n  self: {}\n",
      size: 21,
    });
    expect(octokit.calls[0]).toEqual({
      route: CONTENTS_ROUTE,
      params: { owner: SOURCE_LOGIN, repo: SOURCE_REPO, path: "west.yml" },
    });
  });

  it("answers null for a file that is not there, and for a directory", async () => {
    const { provider } = build([httpError(404, HEALTHY), response([{ type: "file" }], HEALTHY)]);

    await expect(provider.repoFile(syncContext(), REPO, "CONTRIBUTING.md")).resolves.toBeNull();
    await expect(provider.repoFile(syncContext(), REPO, "tests")).resolves.toBeNull();
  });

  it("refuses a path that is not relative before asking GitHub", async () => {
    const { provider, octokit } = build([]);

    for (const path of ["/etc/passwd", "../other/secret", "a/../../b", "tests/*.c", ""]) {
      expect((await refusal(provider.repoFile(syncContext(), REPO, path))).errorClass).toBe(
        "validation",
      );
    }

    expect(octokit.calls).toEqual([]);
  });

  it("cuts a file at the probe limit", () => {
    const long = "x".repeat(MAX_PROBE_FILE_BYTES + 10);

    expect(decodeBase64(Buffer.from(long).toString("base64"))).toHaveLength(MAX_PROBE_FILE_BYTES);
  });
});

describe("every probe", () => {
  it("refuses a repository the source does not cover, without a request", async () => {
    const { provider, octokit } = build([]);

    expect(
      (await refusal(provider.repoLanguages(syncContext(), "someone-else/private"))).errorClass,
    ).toBe("not_found");
    expect(octokit.calls).toEqual([]);
  });

  it("fails auth for a source with no token", async () => {
    const { provider } = build([]);

    expect(
      (await refusal(provider.repoTree(syncContext({ credentials: null }), REPO))).errorClass,
    ).toBe("auth");
  });

  it("respects the workspace's rate budget (#101): refused before the request at the floor", async () => {
    const { provider, octokit, limiter } = build([response({}, HEALTHY)]);

    limiter.observe(SOURCE_WORKSPACE, headerReader(budgetHeaders({ remaining: 10 })));

    expect((await refusal(provider.repoLanguages(syncContext(), REPO))).errorClass).toBe(
      "rate_limit",
    );
    expect(octokit.calls).toEqual([]);
  });

  it("classifies GitHub's own rate refusal as rate_limit", async () => {
    const { provider } = build([httpError(429, { ...HEALTHY, "retry-after": "30" })]);

    expect((await refusal(provider.repoFile(syncContext(), REPO, "go.mod"))).errorClass).toBe(
      "rate_limit",
    );
  });
});
