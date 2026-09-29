import { NotFoundError } from "../../errors/error.envelope";
import { PageService } from "./page.service";
import { FakePageStore, ORG, OTHER_ORG, PR, REV_1, REV_2, RUN } from "./page.store.fixture";

/**
 * `PageService` over the in-memory store (AX.5, [#361](https://github.com/NobuData/ouroboros/issues/361))
 * — the page payload reproduces mockup 12's regions, and the listing serves the nav and needs-you
 * surfaces. The criteria matrix and merge plan are their services' answers, passed through.
 */

const MATRIX = { counts: { total: 5 } } as never;
const PLAN = { strategy: "squash" } as never;

/**
 * @param store - The store.
 * @returns The service, with the matrix and plan stubbed.
 */
function service(store = new FakePageStore()): PageService {
  return new PageService(
    store,
    { matrix: () => Promise.resolve(MATRIX) },
    { plan: () => Promise.resolve(PLAN) },
  );
}

describe("PageService.page", () => {
  it("reproduces mockup 12's head, strip, gates, files, thread and spend", async () => {
    const page = await service().page(ORG, PR);

    expect(page.pullRequest).toMatchObject({
      number: 514,
      title: "can: fix flaky telemetry frame order under ISR load",
      state: "verifying",
      headBranch: "loop/482-canbus-flake",
      baseBranch: "main",
      additions: 68,
      deletions: 15,
      changedFiles: 3,
      run: { loopSeq: 1847, model: "claude-fable-5" },
      ticket: { key: "#482" },
    });
    expect(page.revisions.map((revision) => [revision.seq, revision.headSha])).toEqual([
      [1, "3f9c2ae"],
      [2, "b7e41d0"],
    ]);
    expect(page.revisions[0].gates.aggregate?.redCount).toBe(2);
    expect(page.gates).toEqual(page.revisions[1].gates);
    expect(page.gates?.aggregate).toMatchObject({ greenCount: 5, requiredCount: 7 });
    expect(page.files).toMatchObject({ revisionId: REV_2, additions: 68, deletions: 15 });
    expect(page.thread).toMatchObject({ entryCount: 3, openCount: 0 });
    expect(page.thread.entries.map((entry) => entry.authorName)).toEqual([
      "cursor/composer-2",
      "claude-fable-5",
      "ouroboros policy bot",
    ]);
    expect(page.spend).toMatchObject({
      loop: { tokens: 284_000, costCents: "152.0000" },
      verification: { tokens: 41_000, costCents: "19.0000" },
      cap: { cents: 250 },
      withinCap: true,
    });
    expect(page.criteria).toBe(MATRIX);
    expect(page.plan).toBe(PLAN);
    expect(page.review).toBeNull();
    expect(page.loopReturn).toBeNull();
    expect(page.revisions[1].correction?.fromRevisionId).toBe(REV_1);
  });

  it("answers another workspace's PR as not found — 404, not 403", async () => {
    await expect(service().page(OTHER_ORG, PR)).rejects.toMatchObject({
      constructor: NotFoundError,
      response: { code: "pull_request_not_found" },
    });
  });

  it("says when the host was last asked, apart from when the PR last changed", async () => {
    const { pullRequest } = await service().page(ORG, PR);

    expect(pullRequest.updatedAt).toBe("2026-09-27T14:32:00.000Z");
    expect(pullRequest.syncedAt).toBe("2026-09-27T14:44:00.000Z");
  });

  it("claims no sync for a PR no sync has written", async () => {
    const store = new FakePageStore();
    store.head514 = { ...store.head514, syncedAt: null };

    expect((await service(store).page(ORG, PR)).pullRequest.syncedAt).toBeNull();
  });

  it("has no spend card for a PR no loop opened", async () => {
    const store = new FakePageStore();
    store.head514 = { ...store.head514, run: null };

    expect((await service(store).page(ORG, PR)).spend).toBeNull();
  });

  it("has no gates or files card before the first revision", async () => {
    const store = new FakePageStore();
    store.revisionRows = [];
    store.gates = [];

    const page = await service(store).page(ORG, PR);

    expect(page.gates).toBeNull();
    expect(page.files).toBeNull();
    expect(page.revisions).toEqual([]);
  });
});

describe("PageService.list", () => {
  it("lists the workspace's PRs with the latest aggregate, paged", async () => {
    const list = await service().list(ORG, {});

    expect(list).toMatchObject({ total: 1, limit: 25, offset: 0 });
    expect(list.items[0]).toMatchObject({
      number: 514,
      latestRevision: { seq: 2 },
      gates: { greenCount: 5, requiredCount: 7 },
      reviewRequested: false,
      syncedAt: "2026-09-27T14:44:00.000Z",
    });
  });

  it("filters by state and by the needs-you flag", async () => {
    expect((await service().list(ORG, { state: ["blocked"] })).total).toBe(0);
    expect((await service().list(ORG, { state: ["verifying", "blocked"] })).total).toBe(1);
    expect((await service().list(ORG, { reviewRequested: true })).total).toBe(0);
    expect((await service().list(ORG, { reviewRequested: false })).total).toBe(1);
  });

  it("narrows to the PRs the named runs opened — the by-run lookup (#363)", async () => {
    const other = "5eed0009-0000-4000-8000-000000000999";

    expect((await service().list(ORG, { runId: [RUN] })).items.map((row) => row.id)).toEqual([PR]);
    expect((await service().list(ORG, { runId: [other, RUN] })).items.map((row) => row.id)).toEqual(
      [PR],
    );
    expect((await service().list(ORG, { runId: [other] })).items).toEqual([]);
    expect((await service().list(OTHER_ORG, { runId: [RUN] })).items).toEqual([]);
  });

  it("lists nothing of another workspace", async () => {
    expect((await service().list(OTHER_ORG, {})).items).toEqual([]);
  });
});
