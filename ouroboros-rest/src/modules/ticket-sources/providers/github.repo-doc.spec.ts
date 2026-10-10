/**
 * The GitHub provider's repository-document operations (CM.5, #624): reading a file at a ref,
 * committing one idempotently — creating its branch when missing — and editing a PR.
 */

import { fakeOctokit, httpError, response, type ScriptedAnswer } from "../../github/github.fixture";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { TicketSourceError } from "../ticket-source.errors";
import { REPO_DOC_MEMBERS, isRepoDocPath, supportsRepoDocs } from "../ticket-source.repo-doc";
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "./github.mapping";
import { GithubTicketSourceProvider } from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  recordingFactory,
  syncContext,
} from "./github.provider.fixture";
import {
  BRANCH_REF_ROUTE,
  COMMITS_ROUTE,
  CONTENTS_AT_ROUTE,
  CREATE_REF_ROUTE,
  MAX_COMMIT_MESSAGE_LENGTH,
  MAX_DOC_BYTES,
  PUT_CONTENTS_ROUTE,
  REPO_ROUTE,
  UPDATE_PULL_ROUTE,
} from "./github.repo-doc";

const ADDRESS = { owner: SOURCE_LOGIN, repo: SOURCE_REPO };
const PATH = "docs/ROADMAP.md";
const BRANCH = "ouroboros/roadmap-5eed0097";
const HEAD = "1111111111111111111111111111111111111111";
const COMMIT = "2222222222222222222222222222222222222222";
const NEW = "3333333333333333333333333333333333333333";

function build(answers: readonly ScriptedAnswer[]) {
  const octokit = fakeOctokit(answers);

  return {
    octokit,
    provider: new GithubTicketSourceProvider(
      recordingFactory(octokit).factory,
      new GithubRateLimiter(),
    ),
  };
}

function contents(text: string, sha = "blob-1"): Record<string, unknown> {
  return { type: "file", sha, encoding: "base64", content: Buffer.from(text).toString("base64") };
}

async function refusal(promise: Promise<unknown>): Promise<TicketSourceError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(TicketSourceError.is(error)).toBe(true);

  return error as TicketSourceError;
}

const INPUT = {
  path: PATH,
  content: "# Roadmap\n",
  message: "docs: roadmap v1",
  branch: BRANCH,
  base: "main",
};

describe("the repository-document family", () => {
  it("is on the GitHub provider, behind a guard that also asks for pull requests", () => {
    const { provider } = build([]);

    expect(supportsRepoDocs(provider)).toBe(true);
    expect(REPO_DOC_MEMBERS).toEqual(["defaultBranch", "fileAt", "commitFile", "updatePR"]);
  });

  it("is not on a provider missing a member, or one that opens no pull requests", () => {
    const { provider } = build([]);
    const without = Object.create(provider) as Record<string, unknown>;

    without.commitFile = undefined;

    expect(supportsRepoDocs(without as never)).toBe(false);

    const noPrs = Object.create(provider) as { capabilities: () => unknown };

    noPrs.capabilities = () => ({
      ...provider.capabilities(),
      pr: { ...provider.capabilities().pr, pullRequests: false },
    });

    expect(supportsRepoDocs(noPrs as never)).toBe(false);
  });

  it.each(["docs/ROADMAP.md", "ROADMAP.md", "a/b.c/d_e-f.md"])("takes the path %s", (path) => {
    expect(isRepoDocPath(path)).toBe(true);
  });

  it.each([
    "/abs.md",
    "a//b.md",
    "../up.md",
    "a/../b.md",
    "./here.md",
    "a/./b.md",
    "with space.md",
    "",
    `${"a/".repeat(256)}x`,
  ])("refuses the path %p", (path) => {
    expect(isRepoDocPath(path)).toBe(false);
  });
});

describe("defaultBranch", () => {
  it("reads the push target's default branch", async () => {
    const { provider, octokit } = build([response({ default_branch: "trunk" })]);

    expect(await provider.defaultBranch(syncContext())).toBe("trunk");
    expect(octokit.calls).toEqual([{ route: REPO_ROUTE, params: ADDRESS }]);
  });

  it("classifies a refused token", async () => {
    const { provider } = build([httpError(401)]);

    expect((await refusal(provider.defaultBranch(syncContext()))).errorClass).toBe("auth");
  });

  it("refuses an answer that is not a repository", async () => {
    const { provider } = build([response({})]);

    expect((await refusal(provider.defaultBranch(syncContext()))).errorClass).toBe("upstream");
  });
});

describe("fileAt", () => {
  it("answers the file's text, blob and the commit that last touched it on that ref", async () => {
    const { provider, octokit } = build([
      response(contents("# Roadmap\n", "blob-9")),
      response([{ sha: COMMIT }]),
    ]);

    expect(await provider.fileAt(syncContext(), PATH, "main")).toEqual({
      content: "# Roadmap\n",
      blobSha: "blob-9",
      commitSha: COMMIT,
    });
    expect(octokit.calls).toEqual([
      { route: CONTENTS_AT_ROUTE, params: { ...ADDRESS, path: PATH, ref: "main" } },
      { route: COMMITS_ROUTE, params: { ...ADDRESS, path: PATH, sha: "main", per_page: 1 } },
    ]);
  });

  it("reads UTF-8", async () => {
    const { provider } = build([response(contents("# Helios — Q4 · ✓\n")), response([])]);

    expect(await provider.fileAt(syncContext(), PATH, "main")).toMatchObject({
      content: "# Helios — Q4 · ✓\n",
      commitSha: null,
    });
  });

  it.each([
    ["a missing file or ref", [httpError(404)]],
    ["a directory", [response([{ type: "file", name: "x" }])]],
    ["a submodule", [response({ type: "submodule", sha: "s" })]],
  ])("answers null for %s", async (_name, answers) => {
    const { provider } = build(answers);

    expect(await provider.fileAt(syncContext(), PATH, "main")).toBeNull();
  });

  it("refuses a bad path or a blank ref before asking GitHub anything", async () => {
    const { provider, octokit } = build([]);

    expect(
      (await refusal(provider.fileAt(syncContext(), "../etc/passwd", "main"))).errorClass,
    ).toBe("validation");
    expect((await refusal(provider.fileAt(syncContext(), PATH, " "))).errorClass).toBe(
      "validation",
    );
    expect(octokit.calls).toEqual([]);
  });

  it("classifies a refusal that is not a 404", async () => {
    const { provider } = build([httpError(403)]);

    expect((await refusal(provider.fileAt(syncContext(), PATH, "main"))).errorClass).toBe(
      "permission",
    );
  });
});

describe("commitFile", () => {
  it("creates the branch from its base, then the file", async () => {
    const { provider, octokit } = build([
      httpError(404), // the branch does not exist
      response({ object: { sha: HEAD } }), // the base's head
      response({}, {}, 201), // the branch is created
      httpError(404), // the file is not on it
      response({ commit: { sha: NEW } }, {}, 201),
    ]);

    expect(await provider.commitFile(syncContext(), INPUT)).toEqual({
      commitSha: NEW,
      changed: true,
    });
    expect(octokit.calls.map((call) => call.route)).toEqual([
      BRANCH_REF_ROUTE,
      BRANCH_REF_ROUTE,
      CREATE_REF_ROUTE,
      CONTENTS_AT_ROUTE,
      PUT_CONTENTS_ROUTE,
    ]);
    expect(octokit.calls[0]?.params).toEqual({ ...ADDRESS, ref: `heads/${BRANCH}` });
    expect(octokit.calls[2]?.params).toEqual({
      ...ADDRESS,
      ref: `refs/heads/${BRANCH}`,
      sha: HEAD,
    });
    expect(octokit.calls[4]?.params).toEqual({
      ...ADDRESS,
      path: PATH,
      message: "docs: roadmap v1",
      content: Buffer.from("# Roadmap\n").toString("base64"),
      branch: BRANCH,
    });
  });

  it("updates an existing file by naming its blob", async () => {
    const { provider, octokit } = build([
      response({ object: { sha: HEAD } }),
      response(contents("# Old\n", "blob-old")),
      response([{ sha: COMMIT }]),
      response({ commit: { sha: NEW } }),
    ]);

    expect(await provider.commitFile(syncContext(), INPUT)).toEqual({
      commitSha: NEW,
      changed: true,
    });
    expect(octokit.calls[3]?.params).toMatchObject({ sha: "blob-old", branch: BRANCH });
  });

  it("commits nothing when the branch already holds exactly this content", async () => {
    const { provider, octokit } = build([
      response({ object: { sha: HEAD } }),
      response(contents("# Roadmap\n")),
      response([{ sha: COMMIT }]),
    ]);

    expect(await provider.commitFile(syncContext(), INPUT)).toEqual({
      commitSha: COMMIT,
      changed: false,
    });
    expect(octokit.calls.map((call) => call.route)).not.toContain(PUT_CONTENTS_ROUTE);
  });

  it("answers the branch head when the history names no commit for an unchanged file", async () => {
    const { provider } = build([
      response({ object: { sha: HEAD } }),
      response(contents("# Roadmap\n")),
      response([]),
    ]);

    expect(await provider.commitFile(syncContext(), INPUT)).toEqual({
      commitSha: HEAD,
      changed: false,
    });
  });

  it("commits straight to a branch that is its own base", async () => {
    const { provider, octokit } = build([
      response({ object: { sha: HEAD } }),
      httpError(404),
      response({ commit: { sha: NEW } }),
    ]);

    await provider.commitFile(syncContext(), { ...INPUT, branch: "main" });

    expect(octokit.calls.map((call) => call.route)).toEqual([
      BRANCH_REF_ROUTE,
      CONTENTS_AT_ROUTE,
      PUT_CONTENTS_ROUTE,
    ]);
  });

  it("refuses when neither the branch nor its base exists", async () => {
    const { provider, octokit } = build([httpError(404), httpError(404)]);
    const error = await refusal(provider.commitFile(syncContext(), INPUT));

    expect(error.errorClass).toBe("validation");
    expect(error.detail).toContain("branch main does not exist");
    expect(octokit.calls.map((call) => call.route)).not.toContain(CREATE_REF_ROUTE);
  });

  it.each([
    ["a path outside the repository", { path: "../x.md" }],
    ["a branch git would refuse", { branch: "has space" }],
    ["a base git would refuse", { base: "-flag" }],
    ["a blank message", { message: "  " }],
    ["a message over the bound", { message: "x".repeat(MAX_COMMIT_MESSAGE_LENGTH + 1) }],
    ["a document over 512 KiB", { content: "x".repeat(MAX_DOC_BYTES + 1) }],
  ])("refuses %s before asking GitHub anything", async (_name, change) => {
    const { provider, octokit } = build([]);

    expect(
      (await refusal(provider.commitFile(syncContext(), { ...INPUT, ...change }))).errorClass,
    ).toBe("validation");
    expect(octokit.calls).toEqual([]);
  });

  it("classifies a token that may not write", async () => {
    const { provider } = build([
      response({ object: { sha: HEAD } }),
      httpError(404),
      httpError(403),
    ]);

    expect((await refusal(provider.commitFile(syncContext(), INPUT))).errorClass).toBe(
      "permission",
    );
  });
});

describe("updatePR", () => {
  it("sends only the fields that change", async () => {
    const { provider, octokit } = build([response({}), response({})]);

    await provider.updatePR(syncContext(), 88, {
      title: "  docs: roadmap (v2) ",
      body: "Version 2.",
    });
    await provider.updatePR(syncContext(), 88, { body: "" });

    expect(octokit.calls).toEqual([
      {
        route: UPDATE_PULL_ROUTE,
        params: { ...ADDRESS, pull_number: 88, title: "docs: roadmap (v2)", body: "Version 2." },
      },
      { route: UPDATE_PULL_ROUTE, params: { ...ADDRESS, pull_number: 88, body: "" } },
    ]);
  });

  it("asks GitHub nothing when nothing changes", async () => {
    const { provider, octokit } = build([]);

    await provider.updatePR(syncContext(), 88, {});

    expect(octokit.calls).toEqual([]);
  });

  it.each([
    ["a number that is not a PR's", 0, { title: "x" }],
    ["a blank title", 88, { title: " " }],
    ["a title over GitHub's bound", 88, { title: "x".repeat(MAX_TITLE_LENGTH + 1) }],
    ["a description over GitHub's bound", 88, { body: "x".repeat(MAX_BODY_LENGTH + 1) }],
  ])("refuses %s", async (_name, number, input) => {
    const { provider, octokit } = build([]);

    expect((await refusal(provider.updatePR(syncContext(), number, input))).errorClass).toBe(
      "validation",
    );
    expect(octokit.calls).toEqual([]);
  });

  it("classifies a PR GitHub does not have", async () => {
    const { provider } = build([httpError(404)]);

    expect((await refusal(provider.updatePR(syncContext(), 9999, { title: "x" }))).errorClass).toBe(
      "not_found",
    );
  });
});
