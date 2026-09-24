import { budgetHeaders, httpError, response } from "../../github/github.fixture";
import type { OctokitLike, OctokitResponseLike } from "../../github/github.client";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { TicketSourceError } from "../ticket-source.errors";
import { FIRST_PUSH, SECOND_PUSH } from "../conformance.pr.fixture";
import { GithubTicketSourceProvider } from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_TOKEN,
  recordingFactory,
  syncContext,
} from "./github.provider.fixture";
import {
  DELETE_REF_ROUTE,
  GITHUB_PR_CAPABILITIES,
  MAX_COMMENT_LENGTH,
  MAX_PR_EVENTS,
  MERGE_PULL_ROUTE,
  PULL_ROUTE,
  hostStateOf,
  snapshotOf,
  type PullPayload,
} from "./github.pr";
import { ISSUES_ROUTE } from "./github.mapping";
import {
  RECORDED_DEFAULT_BRANCH,
  prRecording,
  type PrRecording,
} from "./github.pr-recordings.fixture";

/**
 * What `github.pr.ts` does that the kit states only as an outcome
 * ([#357](https://github.com/NobuData/ouroboros/issues/357)) — which request carries what, and the
 * GitHub-shaped edges: a squash message split into title and body, a fork's branch left alone, a
 * repository's own auto-delete, a keyword that closed nothing, and an event cursor that pages.
 */

/** Healthy budget headers. */
const HEALTHY = budgetHeaders({ remaining: 4999 });

/**
 * The real provider over a fresh recording.
 *
 * @returns Both.
 */
function build(): { github: PrRecording; provider: GithubTicketSourceProvider } {
  const github = prRecording();

  return {
    github,
    provider: new GithubTicketSourceProvider(
      recordingFactory(github.octokit).factory,
      new GithubRateLimiter(),
    ),
  };
}

/**
 * A recorded repository with one open PR on a pushed branch.
 *
 * @returns The recording, the provider and the PR's number.
 */
function withPR(): { github: PrRecording; provider: GithubTicketSourceProvider; prNumber: number } {
  const built = build();

  built.github.push("loop/482-canbus-flake", FIRST_PUSH);

  return { ...built, prNumber: built.github.open("loop/482-canbus-flake", "can: fix frame order") };
}

/**
 * The error a promise rejected with.
 *
 * @param promise - The call.
 * @returns The `TicketSourceError`.
 */
async function refusal(promise: Promise<unknown>): Promise<TicketSourceError> {
  const error: unknown = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(TicketSourceError.is(error)).toBe(true);

  return error as TicketSourceError;
}

describe("GITHUB_PR_CAPABILITIES", () => {
  it("declares every strategy, reviews and a poll, frozen", () => {
    expect(GITHUB_PR_CAPABILITIES).toStrictEqual({
      pullRequests: true,
      create: true,
      mergeStrategies: ["merge", "squash", "rebase"],
      reviews: true,
      events: "poll",
    });
    expect(Object.isFrozen(GITHUB_PR_CAPABILITIES.mergeStrategies)).toBe(true);
  });
});

describe("the GitHub PR members", () => {
  it("creates a PR in the push target and finds it again rather than opening a second", async () => {
    const { github, provider } = build();

    github.push("loop/482-canbus-flake", FIRST_PUSH);

    const input = { branch: "loop/482-canbus-flake", base: "main", title: "can: fix", body: "x" };
    const first = await provider.createPR(syncContext(), input);
    const second = await provider.createPR(syncContext(), input);

    expect(first).toEqual({
      number: 1,
      url: `https://github.com/${SOURCE_LOGIN}/${SOURCE_REPO}/pull/1`,
    });
    expect(second).toEqual(first);
    expect(github.pulls.size).toBe(1);
  });

  it("refuses a PR it could not open before sending anything", async () => {
    const { github, provider } = build();

    for (const input of [
      { branch: "loop/x", base: "main", title: "  ", body: null },
      { branch: "main", base: "main", title: "t", body: null },
      { branch: "has space", base: "main", title: "t", body: null },
      { branch: "a..b", base: "main", title: "t", body: null },
      { branch: "-flag", base: "main", title: "t", body: null },
    ]) {
      expect((await refusal(provider.createPR(syncContext(), input))).errorClass).toBe(
        "validation",
      );
    }

    expect(github.calls).toEqual([]);
  });

  it("answers a snapshot with the host's totals, and a revision only when the head moved", async () => {
    const { github, provider, prNumber } = withPR();
    const first = await provider.syncPR(syncContext(), prNumber, null);

    expect(first.pr).toMatchObject({
      number: prNumber,
      state: "open",
      headBranch: "loop/482-canbus-flake",
      baseBranch: RECORDED_DEFAULT_BRANCH,
      additions: 47,
      deletions: 11,
      changedFiles: 2,
      mergedAt: null,
      mergedBy: null,
    });
    expect(first.revision?.headSha).toBe(first.pr.headSha);

    // Case-insensitively the same head: no revision, and no file walk.
    const calls = github.calls.length;

    expect(
      (await provider.syncPR(syncContext(), prNumber, first.pr.headSha.toUpperCase())).revision,
    ).toBeNull();
    expect(github.calls.length - calls).toBe(1);

    github.push("loop/482-canbus-flake", SECOND_PUSH);

    const second = await provider.syncPR(syncContext(), prNumber, first.pr.headSha);

    expect(second.revision?.files).toHaveLength(3);
    expect(second.pr.additions).toBe(68);
    expect(second.pr.deletions).toBe(15);
  });

  it("keeps a bounded diff excerpt from the patches GitHub answered", async () => {
    const { github, provider } = build();

    github.push("loop/diff", [
      { path: "a.c", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-x\n+y" },
      { path: "logo.png", additions: 0, deletions: 0, patch: null },
    ]);

    const prNumber = github.open("loop/diff", "diff");
    const { revision } = await provider.syncPR(syncContext(), prNumber, null);

    expect(revision?.diffExcerpt).toBe("--- a.c\n@@ -1 +1 @@\n-x\n+y");
  });

  it("refuses an unadvertised strategy with no request sent", async () => {
    const { github, provider } = withPR();
    const calls = github.calls.length;
    const refused = await refusal(
      provider.mergePR(syncContext(), 1, {
        strategy: "octopus" as never,
        message: "fix: x",
        deleteBranch: true,
      }),
    );

    expect(refused.errorClass).toBe("validation");
    expect(refused.detail).toContain("merge, squash, rebase");
    expect(github.calls.length).toBe(calls);
  });

  it("squash-merges with the message's first line as the title and the rest as the body", async () => {
    const { github, provider, prNumber } = withPR();
    const issue = github.openIssue();
    const result = await provider.mergePR(syncContext(), prNumber, {
      strategy: "squash",
      message: `fix(can): order telemetry frames\n\nCloses #${String(issue)}.`,
      deleteBranch: true,
    });
    const merge = github.calls.find((call) => call.route === MERGE_PULL_ROUTE);

    expect(merge?.params).toMatchObject({
      merge_method: "squash",
      commit_title: "fix(can): order telemetry frames",
      commit_message: `Closes #${String(issue)}.`,
    });
    expect(result).toMatchObject({
      alreadyMerged: false,
      branchDeleted: true,
      closures: [{ reference: `#${String(issue)}`, closed: true, detail: null }],
    });
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(github.calls.find((call) => call.route === DELETE_REF_ROUTE)?.params.ref).toBe(
      "heads/loop/482-canbus-flake",
    );
  });

  it("reports a keyword that closed nothing — a non-default base — with the reason", async () => {
    const { github, provider } = build();

    github.push("release/2.1", []);
    github.push("loop/backport", FIRST_PUSH);

    const issue = github.openIssue();
    const prNumber = (
      await provider.createPR(syncContext(), {
        branch: "loop/backport",
        base: "release/2.1",
        title: "backport",
        body: `Closes #${String(issue)}`,
      })
    )?.number;

    const result = await provider.mergePR(syncContext(), prNumber ?? 0, {
      strategy: "merge",
      message: "backport the frame-order fix",
      deleteBranch: false,
    });

    expect(result.branchDeleted).toBe(false);
    expect(result.closures).toEqual([
      {
        reference: `#${String(issue)}`,
        closed: false,
        detail: `#${String(issue)} is still open after the merge`,
      },
    ]);
  });

  it("reports a reference in another repository as unverifiable rather than failing the merge", async () => {
    const { provider, prNumber } = withPR();
    const result = await provider.mergePR(syncContext(), prNumber, {
      strategy: "rebase",
      message: "fix: x\n\nFixes acme-robotics/helios-bootloader#7",
      deleteBranch: false,
    });

    expect(result.closures).toEqual([
      {
        reference: "acme-robotics/helios-bootloader#7",
        closed: false,
        detail:
          "acme-robotics/helios-bootloader#7 could not be verified after the merge (not_found)",
      },
    ]);
  });

  it("merges a merged PR no second time, and counts a branch already gone as deleted", async () => {
    const { github, provider, prNumber } = withPR();
    const input = { strategy: "squash" as const, message: "fix: x", deleteBranch: true };

    await provider.mergePR(syncContext(), prNumber, input);

    const again = await provider.mergePR(syncContext(), prNumber, input);

    expect(again).toEqual({ sha: null, alreadyMerged: true, branchDeleted: true, closures: [] });
    expect(github.calls.filter((call) => call.route === MERGE_PULL_ROUTE)).toHaveLength(1);
  });

  it("leaves a fork's branch alone — it is not this repository's to delete", async () => {
    const { github, prNumber } = withPR();
    const forked: OctokitLike = {
      request: async (route, params) => {
        const answered = await github.octokit.request(route, params);

        return route === PULL_ROUTE
          ? {
              ...answered,
              data: {
                ...(answered.data as Record<string, unknown>),
                head: {
                  ...(answered.data as { head: Record<string, unknown> }).head,
                  repo: { full_name: "contributor/helios-firmware" },
                },
              },
            }
          : answered;
      },
      paginate: github.octokit.paginate,
    };
    const provider = new GithubTicketSourceProvider(
      recordingFactory(forked).factory,
      new GithubRateLimiter(),
    );
    const result = await provider.mergePR(syncContext(), prNumber, {
      strategy: "merge",
      message: "fix: x",
      deleteBranch: true,
    });

    expect(result.branchDeleted).toBe(false);
    expect(github.calls.some((call) => call.route === DELETE_REF_ROUTE)).toBe(false);
    expect(github.ledger().branches).toContain("loop/482-canbus-flake");
  });

  it("classifies GitHub refusing the merge — checks red, protection unmet — as validation", async () => {
    const github = prRecording({ strategies: ["merge"] });
    const provider = new GithubTicketSourceProvider(
      recordingFactory(github.octokit).factory,
      new GithubRateLimiter(),
    );

    github.push("loop/x", FIRST_PUSH);

    const refused = await refusal(
      provider.mergePR(syncContext(), github.open("loop/x", "x"), {
        strategy: "squash",
        message: "fix: x",
        deleteBranch: false,
      }),
    );

    expect(refused.errorClass).toBe("validation");
    expect(refused.httpStatus).toBe(405);
  });

  it("refuses a blank merge message and a bad PR number before sending anything", async () => {
    const { github, provider } = build();

    for (const run of [
      () =>
        provider.mergePR(syncContext(), 1, {
          strategy: "squash",
          message: " \n ",
          deleteBranch: false,
        }),
      () => provider.getPR(syncContext(), 0),
      () => provider.getPR(syncContext(), 1.5),
    ]) {
      expect((await refusal(run())).errorClass).toBe("validation");
    }

    expect(github.calls).toEqual([]);
  });

  it("edits the marked comment, and refuses one GitHub could not store", async () => {
    const { provider, prNumber } = withPR();
    const first = await provider.commentPR(syncContext(), prNumber, { key: "evidence", body: "a" });
    const edited = await provider.commentPR(syncContext(), prNumber, {
      key: "evidence",
      body: "b",
    });

    expect(edited).toEqual({ commentId: first.commentId, mode: "edited" });
    expect(
      (
        await refusal(
          provider.commentPR(syncContext(), prNumber, {
            key: "evidence",
            body: "x".repeat(MAX_COMMENT_LENGTH),
          }),
        )
      ).errorClass,
    ).toBe("validation");
  });

  it("asks a reviewer by login and refuses something that is not one", async () => {
    const { provider, prNumber } = withPR();

    await expect(provider.requestReview(syncContext(), prNumber, " mara-okafor ")).resolves.toEqual(
      {
        requested: ["mara-okafor"],
      },
    );

    for (const bad of ["", "-lead", "a--b", "has space", "x".repeat(40)]) {
      expect((await refusal(provider.requestReview(syncContext(), prNumber, bad))).errorClass).toBe(
        "validation",
      );
    }
  });

  it("holds no token between calls, and hands the seam the source's", async () => {
    const github = prRecording();
    const factory = recordingFactory(github.octokit);
    const provider = new GithubTicketSourceProvider(factory.factory, new GithubRateLimiter());

    github.push("loop/x", FIRST_PUSH);
    await provider.getPR(syncContext(), github.open("loop/x", "x"));

    expect(factory.tokens).toEqual([SOURCE_TOKEN]);
    expect(JSON.stringify(provider)).not.toContain(SOURCE_TOKEN);
  });
});

describe("prEvents on GitHub", () => {
  /**
   * An Octokit answering the issues listing with these rows and recording every request.
   *
   * @param rows - The listing, oldest first.
   * @returns The Octokit and its calls.
   */
  function listing(rows: readonly Record<string, unknown>[]): {
    octokit: OctokitLike;
    calls: Readonly<Record<string, unknown>>[];
  } {
    const calls: Readonly<Record<string, unknown>>[] = [];
    const respond = (
      route: string,
      params: Readonly<Record<string, unknown>> = {},
    ): OctokitResponseLike<unknown> => {
      if (route !== ISSUES_ROUTE) {
        throw httpError(404, HEALTHY);
      }

      calls.push(params);

      const since = typeof params.since === "string" ? Date.parse(params.since) : -Infinity;

      return response(
        rows.filter((row) => Date.parse(String(row.updated_at)) >= since),
        HEALTHY,
      );
    };

    return {
      calls,
      octokit: {
        request: (route, params) => Promise.resolve(respond(route, params)),
        paginate: {
          iterator: (route, params) => ({
            [Symbol.asyncIterator]: async function* () {
              yield await Promise.resolve(respond(route, params));
            },
          }),
        },
      },
    };
  }

  /**
   * A listing row.
   *
   * @param number - The number.
   * @param minute - Minutes past a fixed instant.
   * @param pull - Whether it is a PR, and whether merged.
   * @returns The row.
   */
  function row(
    number: number,
    minute: number,
    pull: "open" | "merged" | null,
  ): Record<string, unknown> {
    return {
      number,
      state: pull === "merged" ? "closed" : "open",
      updated_at: new Date(Date.UTC(2026, 8, 24, 9, minute)).toISOString(),
      ...(pull === null
        ? {}
        : { pull_request: { merged_at: pull === "merged" ? "2026-09-24T09:30:00Z" : null } }),
    };
  }

  it("answers PRs only, oldest first, with the since and order that make the cursor resumable", async () => {
    const { octokit, calls } = listing([row(1, 1, "open"), row(2, 2, null), row(3, 3, "merged")]);
    const provider = new GithubTicketSourceProvider(
      recordingFactory(octokit).factory,
      new GithubRateLimiter(),
    );
    const page = await provider.prEvents(syncContext(), null);

    expect(page.events).toEqual([
      { number: 1, state: "open", updatedAt: new Date(Date.UTC(2026, 8, 24, 9, 1)) },
      { number: 3, state: "merged", updatedAt: new Date(Date.UTC(2026, 8, 24, 9, 3)) },
    ]);
    expect(page).toMatchObject({ nextCursor: "2026-09-24T09:03:00.000Z", hasMore: false });
    expect(calls[0]).toMatchObject({ state: "all", sort: "updated", direction: "asc" });
    expect(calls[0]).not.toHaveProperty("since");

    const next = await provider.prEvents(syncContext(), page.nextCursor);

    // Inclusive: the PR on the cursor's instant repeats rather than risking a skip.
    expect(next.events.map((event) => event.number)).toEqual([3]);
    expect(calls[1]).toMatchObject({ since: "2026-09-24T09:03:00.000Z" });
  });

  it("caps a page, says there is more, and resumes from the last event it kept", async () => {
    const rows = Array.from({ length: MAX_PR_EVENTS + 5 }, (_, index) =>
      row(index + 1, index, "open"),
    );
    const { octokit } = listing(rows);
    const provider = new GithubTicketSourceProvider(
      recordingFactory(octokit).factory,
      new GithubRateLimiter(),
    );
    const page = await provider.prEvents(syncContext(), null);
    const next = await provider.prEvents(syncContext(), page.nextCursor);

    expect(page.events).toHaveLength(MAX_PR_EVENTS);
    expect(page.hasMore).toBe(true);
    expect(next.events.map((event) => event.number)).toEqual([100, 101, 102, 103, 104, 105]);
    expect(next.hasMore).toBe(false);
  });

  it("treats an unreadable cursor as none, and keeps a cursor when nothing changed", async () => {
    const { octokit, calls } = listing([]);
    const provider = new GithubTicketSourceProvider(
      recordingFactory(octokit).factory,
      new GithubRateLimiter(),
    );

    expect((await provider.prEvents(syncContext(), "not-a-date")).nextCursor).toBe(
      new Date(0).toISOString(),
    );
    expect(calls[0]).not.toHaveProperty("since");
    expect((await provider.prEvents(syncContext(), "2026-09-24T09:03:00.000Z")).nextCursor).toBe(
      "2026-09-24T09:03:00.000Z",
    );
  });
});

describe("snapshotOf and hostStateOf", () => {
  /** A PR payload GitHub could answer. */
  const PULL: PullPayload = {
    number: 514,
    html_url: "https://github.com/acme-robotics/helios-firmware/pull/514",
    title: "can: fix flaky telemetry frame order under ISR load",
    body: null,
    state: "closed",
    merged_at: "2026-09-24T10:00:00Z",
    merged_by: { login: "mara-okafor" },
    head: { ref: "loop/482-canbus-flake", sha: "B7E41D0", repo: null },
    base: { ref: "main" },
    additions: 68,
    deletions: 15,
    changed_files: 3,
    updated_at: "2026-09-24T10:00:00Z",
  };

  it("reads a merged PR — closed with a merge time — as merged, sha lower-cased", () => {
    expect(hostStateOf(PULL)).toBe("merged");
    expect(hostStateOf({ state: "closed", merged_at: null })).toBe("closed");
    expect(snapshotOf(PULL)).toMatchObject({
      state: "merged",
      headSha: "b7e41d0",
      mergedBy: "mara-okafor",
      mergedAt: new Date("2026-09-24T10:00:00Z"),
    });
  });

  it("drops merged_by on a PR that is not merged, and defaults counts a listing leaves out", () => {
    const open = snapshotOf({
      ...PULL,
      state: "open",
      merged_at: null,
      additions: undefined,
      deletions: undefined,
      changed_files: undefined,
    });

    expect(open).toMatchObject({ mergedBy: null, mergedAt: null, additions: 0, changedFiles: 0 });
  });

  it("refuses a PR V052 could not store", () => {
    for (const bad of [
      { ...PULL, html_url: "http://github.com/x" },
      { ...PULL, title: " " },
      { ...PULL, head: { ...PULL.head, sha: "not-hex" } },
      { ...PULL, updated_at: "yesterday" },
    ]) {
      expect(() => snapshotOf(bad)).toThrow();
    }
  });

  it("classifies a PR route's failure the write-side way", async () => {
    const octokit: OctokitLike = {
      request: (route) =>
        route === PULL_ROUTE
          ? Promise.reject(httpError(403, HEALTHY))
          : Promise.reject(httpError(404)),
      paginate: { iterator: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
    };
    const provider = new GithubTicketSourceProvider(
      recordingFactory(octokit).factory,
      new GithubRateLimiter(),
    );

    expect((await refusal(provider.getPR(syncContext(), 1))).errorClass).toBe("permission");
    expect((await refusal(provider.getPR(syncContext({ credentials: null }), 1))).errorClass).toBe(
      "auth",
    );
  });
});
