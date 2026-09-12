import type {
  WorkflowRegistryRow,
  WorkflowRunShare,
  WorkflowStatsRepository,
} from "./stats.repository";
import { USAGE_WINDOW_DAYS, usageWindowStart, WorkflowStatsService } from "./stats.service";

/**
 * The composition — two reads, one instant, and the shares that come out of them
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * The statements are `stats.repository.spec.ts`' subject and the strings are
 * `stats.captions.spec.ts`'. What is left here is what this layer actually decides: which
 * instant the window is measured from, what the denominator is, and which workflow each count
 * belongs to.
 */

const WORKSPACE = "acme-robotics-id";
const NOW = new Date("2026-09-12T14:37:41.532Z");

/**
 * One registry row.
 *
 * @param overrides - What this case is about.
 * @returns The row.
 */
function row(overrides: Partial<WorkflowRegistryRow> = {}): WorkflowRegistryRow {
  return {
    id: "workflow-1",
    slug: "standard-fix",
    name: "standard-fix",
    status: "active",
    current_version: 14,
    stage_count: 6,
    terminal_actions: ["open_pr_automerge"],
    ...overrides,
  };
}

/**
 * A service over a repository a spec writes.
 *
 * @param entries - What the registry read answers.
 * @param shares - What the run counts answer.
 * @returns The service, and the arguments each read was called with.
 */
function build(entries: WorkflowRegistryRow[], shares: WorkflowRunShare[]) {
  const calls: { registry: string[]; shares: { organizationId: string; since: Date }[] } = {
    registry: [],
    shares: [],
  };

  const repository = {
    registryEntries: (organizationId: string) => {
      calls.registry.push(organizationId);
      return Promise.resolve(entries);
    },
    runShares: (organizationId: string, since: Date) => {
      calls.shares.push({ organizationId, since });
      return Promise.resolve(shares);
    },
  } as unknown as WorkflowStatsRepository;

  return { service: new WorkflowStatsService(repository), calls };
}

describe("the usage window", () => {
  it("looks back thirty days from the request instant", () => {
    expect(USAGE_WINDOW_DAYS).toBe(30);
    expect(usageWindowStart(NOW)).toEqual(new Date("2026-08-13T14:37:41.532Z"));
  });

  it("is a duration rather than a calendar month, so no clock change moves it", () => {
    // A month has no fixed length and needs a timezone; "the last thirty days" has neither
    // problem. The boundary across a European DST change is exactly 30 × 24h later.
    const beforeSpringForward = new Date("2026-03-15T12:00:00.000Z");

    expect(usageWindowStart(beforeSpringForward).getUTCHours()).toBe(12);
  });
});

describe("the rail", () => {
  it("measures both reads from one instant, scoped to one workspace", async () => {
    // Two statements computing the boundary independently would put a run that started on it
    // inside one number and outside the other — `windows.ts`' warning, and the reason `now`
    // is a parameter rather than a clock read.
    const { service, calls } = build([row()], []);

    await service.forWorkspace(WORKSPACE, NOW);

    expect(calls.registry).toEqual([WORKSPACE]);
    expect(calls.shares).toEqual([{ organizationId: WORKSPACE, since: usageWindowStart(NOW) }]);
  });

  it("shares each workflow's runs against every run in the window", async () => {
    // 47 of 77: the other 30 ran under other workflows, including a tag no workflow resolves.
    const { service } = build(
      [row(), row({ id: "workflow-2", slug: "docs-loop", name: "docs-loop", stage_count: 4 })],
      [
        { workflow_tag: "standard-fix", runs: 47 },
        { workflow_tag: "docs-loop", runs: 20 },
        { workflow_tag: "retired-experiment", runs: 10 },
      ],
    );

    const rail = await service.forWorkspace(WORKSPACE, NOW);

    expect(rail.map((entry) => [entry.slug, entry.runs, entry.usagePercent])).toEqual([
      ["standard-fix", 47, 61],
      ["docs-loop", 20, 26],
    ]);
  });

  it("counts a workflow with no runs as zero, not as missing", async () => {
    const { service } = build(
      [row(), row({ id: "workflow-2", slug: "hotfix-p0", name: "hotfix-p0", status: "paused" })],
      [{ workflow_tag: "standard-fix", runs: 4 }],
    );

    const rail = await service.forWorkspace(WORKSPACE, NOW);

    expect(rail[1]).toMatchObject({
      slug: "hotfix-p0",
      runs: 0,
      usagePercent: 0,
      usageCaption: "used by 0% of runs",
      caption: "6 stages · paused",
    });
  });

  it("says `no runs yet` for every entry when the window holds no runs", async () => {
    // The ticket's second criterion end to end: a workspace with workflows and no runs. Never
    // a fabricated percentage, for any of them.
    const { service } = build([row(), row({ id: "workflow-2", slug: "docs-loop" })], []);

    const rail = await service.forWorkspace(WORKSPACE, NOW);

    expect(rail).toHaveLength(2);
    expect(rail.every((entry) => entry.usagePercent === null)).toBe(true);
    expect(rail.every((entry) => entry.usageCaption === "no runs yet")).toBe(true);
  });

  it("answers an empty rail for a workspace with no workflows", async () => {
    // The studio's empty state, and not an error: a workspace that has never opened it has
    // nothing on the rail.
    const { service } = build([], [{ workflow_tag: "standard-fix", runs: 4 }]);

    await expect(service.forWorkspace(WORKSPACE, NOW)).resolves.toEqual([]);
  });

  it("keeps the registry's order, which is the rail's", async () => {
    const { service } = build(
      [
        row({ slug: "standard-fix" }),
        row({ id: "workflow-2", slug: "feature-loop" }),
        row({ id: "workflow-3", slug: "deps-refresh" }),
      ],
      [],
    );

    const rail = await service.forWorkspace(WORKSPACE, NOW);

    expect(rail.map((entry) => entry.slug)).toEqual([
      "standard-fix",
      "feature-loop",
      "deps-refresh",
    ]);
  });

  it("reads the clock when the caller does not state an instant", async () => {
    // The ordinary call. Asserted only loosely — the point is that the window is measured from
    // *now* rather than from a fixed date somebody wrote down.
    const { service, calls } = build([row()], []);
    const before = Date.now();

    await service.forWorkspace(WORKSPACE);

    const since = calls.shares[0].since.getTime();
    expect(since).toBeGreaterThanOrEqual(before - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(since).toBeLessThanOrEqual(Date.now());
  });
});
