import type { PublishedOrgPolicy } from "./org-policy.document";
import {
  POLICY_CACHE_TTL_MS,
  PolicyResolutionService,
  snapshotOf,
} from "./policy-resolution.service";

/**
 * The one reader of the published org policy (BQ.2, #481): a short-lived cache that a publish
 * clears, an uncached read for execution, and one version held for a whole decision.
 */

/**
 * A version.
 *
 * @param version - Its number.
 * @param autoMerge - Whether its auto_merge rule is on.
 * @returns The policy.
 */
function policyAt(version: number, autoMerge = true): PublishedOrgPolicy {
  return {
    version,
    publishedAt: new Date("2026-10-04T13:48:00Z"),
    rules: {
      auto_merge: { enabled: autoMerge, conditions: { effort_lte: "m" } },
      dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
    },
  };
}

/** A store answering whatever version is current, counting its reads. */
function store(start: PublishedOrgPolicy | null) {
  const state = { current: start, reads: 0, loops: 0 };

  return {
    state,
    current: jest.fn(() => {
      state.reads += 1;
      return Promise.resolve(state.current);
    }),
    loopsOpened: jest.fn(() => Promise.resolve(state.loops)),
  };
}

describe("PolicyResolutionService", () => {
  let now = 0;
  const clock = (): number => now;

  beforeEach(() => {
    now = 1_000;
  });

  it("serves a cached read while it stands, and reads again once it lapses", async () => {
    const documents = store(policyAt(7));
    const service = new PolicyResolutionService(documents, clock);

    await service.current("org");
    documents.state.current = policyAt(8);
    now += POLICY_CACHE_TTL_MS - 1;

    expect((await service.current("org"))?.version).toBe(7);
    expect(documents.state.reads).toBe(1);

    now += 1;

    expect((await service.current("org"))?.version).toBe(8);
    expect(documents.state.reads).toBe(2);
  });

  it("keys the cache by workspace", async () => {
    const documents = store(policyAt(7));
    const service = new PolicyResolutionService(documents, clock);

    await service.current("org-a");
    await service.current("org-b");

    expect(documents.current.mock.calls).toEqual([["org-a"], ["org-b"]]);
  });

  it("caches a workspace with nothing published too", async () => {
    const documents = store(null);
    const service = new PolicyResolutionService(documents, clock);

    expect(await service.current("org")).toBeNull();
    expect(await service.current("org")).toBeNull();
    expect(documents.state.reads).toBe(1);
  });

  it("sees a publish at once once the publish flow invalidates", async () => {
    const documents = store(policyAt(7));
    const service = new PolicyResolutionService(documents, clock);

    await service.current("org");
    documents.state.current = policyAt(8);
    service.invalidate("org");

    expect((await service.current("org"))?.version).toBe(8);
  });

  it("reads uncached for an execution, and refreshes the cache with it", async () => {
    const documents = store(policyAt(7));
    const service = new PolicyResolutionService(documents, clock);

    await service.current("org");
    documents.state.current = policyAt(8);

    expect((await service.currentNow("org"))?.version).toBe(8);
    expect((await service.current("org"))?.version).toBe(8);
    expect(documents.state.reads).toBe(2);
  });

  it("resolves a rule, attributed to the version it read", async () => {
    const service = new PolicyResolutionService(store(policyAt(7)), clock);

    expect(
      await service.resolve("org", "auto_merge", { ticket: { labels: [], effort: "s" } }),
    ).toMatchObject({
      ruleId: "auto_merge",
      version: 7,
      value: { eligible: true },
    });
  });

  it("holds one version for a whole decision — a publish mid-flight cannot split it", async () => {
    const documents = store(policyAt(7));
    const service = new PolicyResolutionService(documents, clock);
    const snapshot = await service.snapshot("org", true);

    documents.state.current = policyAt(8, false);
    service.invalidate("org");

    expect(snapshot.resolve("auto_merge", { ticket: { labels: [], effort: "s" } })).toMatchObject({
      version: 7,
      value: { eligible: true },
    });
    expect(snapshot.resolve("dry_run_new_repos", { loop: 11 }).version).toBe(7);
    expect(
      (await service.resolve("org", "auto_merge", { ticket: { labels: [], effort: "s" } })).version,
    ).toBe(8);
  });

  it("snapshots from the cache unless asked to read fresh", async () => {
    const documents = store(policyAt(7));
    const service = new PolicyResolutionService(documents, clock);

    await service.snapshot("org");
    await service.snapshot("org");
    expect(documents.state.reads).toBe(1);

    await service.snapshot("org", true);
    expect(documents.state.reads).toBe(2);
  });

  it("numbers the next loop of a repository, and knows nothing of an unknown one", async () => {
    const documents = store(policyAt(7));
    const service = new PolicyResolutionService(documents, clock);

    documents.state.loops = 9;

    expect(await service.nextLoop("org", "repo-1")).toBe(10);
    expect(documents.loopsOpened).toHaveBeenCalledWith("org", "repo-1");
    expect(await service.nextLoop("org", null)).toBeNull();
  });

  it("reads the wall clock when no suite binds one", async () => {
    const documents = store(policyAt(7));

    await new PolicyResolutionService(documents).current("org");
    await new PolicyResolutionService(documents).current("org");

    expect(documents.state.reads).toBe(2);
  });
});

describe("snapshotOf", () => {
  it("resolves against the one policy it holds", () => {
    expect(snapshotOf(null).resolve("human_review").version).toBeNull();
    expect(snapshotOf(policyAt(3)).policy?.version).toBe(3);
  });
});
