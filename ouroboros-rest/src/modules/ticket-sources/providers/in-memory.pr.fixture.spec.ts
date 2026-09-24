import { TicketSourceError } from "../ticket-source.errors";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  IN_MEMORY_MERGER,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
} from "./in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
  InMemoryTrackerRefusal,
} from "./in-memory.provider.fixture";

/**
 * The in-memory git host behaves like a host (AX.1, [#357](https://github.com/NobuData/ouroboros/issues/357))
 * — the refusals and the keyword rule the gate engine's and merge executor's suites will lean on,
 * pinned down here so a fake that drifted into agreeing with everything would fail on its own.
 */

/** The source every call runs against. */
const CONTEXT = {
  sourceId: "s-357",
  organizationId: "o-357",
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
} as const;

/**
 * A host, its provider and one open PR.
 *
 * @param base - The PR's base branch.
 * @returns All three.
 */
function build(base = IN_MEMORY_DEFAULT_BRANCH): {
  host: InMemoryPrHost;
  provider: InMemoryPrTicketSourceProvider;
  prNumber: number;
} {
  const host = new InMemoryPrHost();

  host.push("loop/482", [{ path: "a.c", additions: 3, deletions: 1, patch: "+x" }]);

  if (base !== IN_MEMORY_DEFAULT_BRANCH) {
    host.push(base, []);
  }

  return {
    host,
    provider: new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host),
    prNumber: host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
      branch: "loop/482",
      base,
      title: "can: fix",
      body: null,
    }).number,
  };
}

/**
 * The status a host call refused with.
 *
 * @param run - The call.
 * @returns The status.
 */
function statusOf(run: () => unknown): number | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof InMemoryTrackerRefusal ? error.status : undefined;
  }

  return undefined;
}

describe("InMemoryPrHost", () => {
  it("refuses a PR for a missing branch, into itself, or a second for the same pair", () => {
    const { host } = build();

    for (const branch of ["nope", IN_MEMORY_DEFAULT_BRANCH, "loop/482"]) {
      expect(
        statusOf(() =>
          host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
            branch,
            base: IN_MEMORY_DEFAULT_BRANCH,
            title: "t",
            body: null,
          }),
        ),
      ).toBe(422);
    }
  });

  it("refuses a wrong token, another project, a merge of a merged PR and a switched-off strategy", () => {
    const host = new InMemoryPrHost({ strategies: ["squash"] });

    host.push("loop/x", []);

    const pull = host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
      branch: "loop/x",
      base: IN_MEMORY_DEFAULT_BRANCH,
      title: "t",
      body: null,
    });

    expect(statusOf(() => host.pull("wrong", IN_MEMORY_PROJECT, pull.number))).toBe(401);
    expect(statusOf(() => host.pull(IN_MEMORY_TOKEN, "OTHER", pull.number))).toBe(404);
    expect(
      statusOf(() => host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, pull.number, "merge", "m")),
    ).toBe(405);

    host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, pull.number, "squash", "m");

    expect(
      statusOf(() => host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, pull.number, "squash", "m")),
    ).toBe(405);
    expect(
      statusOf(() =>
        host.deleteBranch(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, IN_MEMORY_DEFAULT_BRANCH),
      ),
    ).toBe(422);
  });

  it("closes a keyword's issue on a merge into the default branch, in its own repository only", async () => {
    const { host, provider, prNumber } = build();
    const issue = host.openIssue();
    const result = await provider.mergePR(CONTEXT, prNumber, {
      strategy: "squash",
      message: `fix: x\n\nCloses #${String(issue)}. Fixes acme/other#7. Closes #999.`,
      deleteBranch: true,
    });

    expect(result.closures).toEqual([
      { reference: `#${String(issue)}`, closed: true, detail: null },
      {
        reference: "acme/other#7",
        closed: false,
        detail: "acme/other#7 is in another repository, which this host cannot see",
      },
      { reference: "#999", closed: false, detail: "#999 could not be verified after the merge" },
    ]);
    expect(host.ledger().closedIssues).toEqual([issue]);
    expect(host.ledger().branches).not.toContain("loop/482");

    const merged = await provider.getPR(CONTEXT, prNumber);

    // The branch is gone and the snapshot still has its head and files — frozen at the merge.
    expect(merged).toMatchObject({ state: "merged", mergedBy: IN_MEMORY_MERGER, additions: 3 });
    expect(merged.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("leaves a keyword's issue open on a merge into another branch, and says so", async () => {
    const { host, provider, prNumber } = build("release/2.1");
    const issue = host.openIssue();
    const result = await provider.mergePR(CONTEXT, prNumber, {
      strategy: "merge",
      message: `backport\n\nCloses #${String(issue)}`,
      deleteBranch: false,
    });

    expect(result).toMatchObject({
      branchDeleted: false,
      closures: [{ closed: false, detail: `#${String(issue)} is still open after the merge` }],
    });
  });

  it("pages its change log exactly, and treats a cursor it did not write as none", async () => {
    const host = new InMemoryPrHost();
    const provider = new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host, {
      eventPage: 2,
    });

    for (const branch of ["a", "b", "c"]) {
      host.push(branch, []);
      host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
        branch,
        base: IN_MEMORY_DEFAULT_BRANCH,
        title: branch,
        body: null,
      });
    }

    const first = await provider.prEvents(CONTEXT, null);
    const second = await provider.prEvents(CONTEXT, first.nextCursor);

    expect(first).toMatchObject({ nextCursor: "2", hasMore: true });
    expect(first.events.map((event) => event.number)).toEqual([1, 2]);
    expect(second).toMatchObject({ nextCursor: "3", hasMore: false });
    expect(second.events.map((event) => event.number)).toEqual([3]);
    expect((await provider.prEvents(CONTEXT, "garbage")).events).toHaveLength(2);
  });

  it("refuses a PR it cannot open before asking the host", async () => {
    const { host, provider } = build();
    const before = host.ledger().requests;

    for (const input of [
      { branch: "loop/482", base: "main", title: " ", body: null },
      { branch: "main", base: "main", title: "t", body: null },
    ]) {
      await expect(provider.createPR(CONTEXT, input)).rejects.toBeInstanceOf(TicketSourceError);
    }

    await expect(provider.requestReview(CONTEXT, 1, " ")).rejects.toBeInstanceOf(TicketSourceError);
    expect(host.ledger().requests).toBe(before);
  });
});
