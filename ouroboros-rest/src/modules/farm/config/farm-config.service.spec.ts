import type { AuditRecord } from "../../audit/audit.events";
import type { AuditService } from "../../audit/audit.service";
import type { BuildJobRequest } from "../dispatch/jobs.dto";
import type { FarmJobsService } from "../dispatch/jobs.service";
import { FarmAudit } from "../farm.audit";
import type { CreateJobHookBody, CreatePoolWindowBody } from "./farm-config.dto";
import type {
  FarmConfigRepository,
  JobHookRow,
  MergedPullRequest,
  NewJobHook,
  NewPoolWindow,
  PoolWindowRow,
} from "./farm-config.repository";
import { JobHooksService, repositoryFromUrl } from "./job-hooks.service";
import { PoolWindowsService } from "./pool-windows.service";

/**
 * The farm configuration the Build Analyzer composes (BV.5, #514): pool windows and job hooks are
 * written idempotently and audited once, refuse names the workspace does not have, and a merge
 * fires exactly the hooks whose repository and title filter it matches.
 */

const ORG = "org_5eed0001";
const ACTOR = "user_maya";
const SHA = "a".repeat(40);

/** A stored window. */
function windowRow(overrides: Partial<PoolWindowRow> = {}): PoolWindowRow {
  return {
    id: "w-1",
    runner_id: "r-1",
    runner: "forge-02",
    pool_id: "p-a",
    pool: "pool-a",
    days_of_week: [1, 2, 3, 4, 5],
    starts_at: "14:00",
    ends_at: "16:00",
    enabled: true,
    created_by: ACTOR,
    created_at: new Date("2026-10-02T12:00:00Z"),
    ...overrides,
  };
}

/** A stored hook. */
function hookRow(overrides: Partial<JobHookRow> = {}): JobHookRow {
  return {
    id: "h-1",
    github_repo_id: "repo-1",
    repository: "acme/helios-firmware",
    pool_id: "p-a",
    pool: "pool-a",
    event: "merge",
    title_contains: "deps-refresh",
    label: "ccache warm",
    title: "Re-warm ccache after deps-refresh",
    command: "west build -t ccache-warm",
    enabled: true,
    created_by: ACTOR,
    created_at: new Date("2026-10-02T12:00:00Z"),
    ...overrides,
  };
}

/** What a case sets up and reads back. */
interface Harness {
  windows: PoolWindowsService;
  hooks: JobHooksService;
  written: AuditRecord[];
  insertedWindows: NewPoolWindow[];
  insertedHooks: NewJobHook[];
  submitted: { hookId: string; request: BuildJobRequest }[];
}

/**
 * Both services over stubs.
 *
 * @param shape - What exists and how writes land.
 * @returns The services and what the stubs recorded.
 */
function harness(
  shape: {
    exists?: boolean;
    created?: boolean;
    merged?: MergedPullRequest;
    hooks?: JobHookRow[];
    failSubmit?: boolean;
  } = {},
): Harness {
  const exists = shape.exists ?? true;
  const written: AuditRecord[] = [];
  const insertedWindows: NewPoolWindow[] = [];
  const insertedHooks: NewJobHook[] = [];
  const submitted: { hookId: string; request: BuildJobRequest }[] = [];

  const repository = {
    runnerByName: jest.fn((_org: string, name: string) =>
      Promise.resolve(exists ? { id: "r-1", name } : undefined),
    ),
    poolByName: jest.fn((_org: string, name: string) =>
      Promise.resolve(exists ? { id: "p-a", name } : undefined),
    ),
    repositoryByRef: jest.fn((_org: string, ref: string) =>
      Promise.resolve(exists ? { id: "repo-1", repository: ref } : undefined),
    ),
    insertWindow: jest.fn((window: NewPoolWindow) => {
      insertedWindows.push(window);
      return Promise.resolve({ id: "w-1", created: shape.created ?? true });
    }),
    window: jest.fn(() => Promise.resolve(exists ? windowRow() : undefined)),
    deleteWindow: jest.fn(() => Promise.resolve(true)),
    insertHook: jest.fn((hook: NewJobHook) => {
      insertedHooks.push(hook);
      return Promise.resolve({ id: "h-1", created: shape.created ?? true });
    }),
    hook: jest.fn(() => Promise.resolve(exists ? hookRow() : undefined)),
    deleteHook: jest.fn(() => Promise.resolve(true)),
    mergedPullRequest: jest.fn(() => Promise.resolve(shape.merged)),
    mergeHooks: jest.fn(() => Promise.resolve(shape.hooks ?? [])),
  } as unknown as FarmConfigRepository;

  const audit = new FarmAudit({
    record: (event: AuditRecord) => {
      written.push(event);
      return Promise.resolve("event-1");
    },
  } as unknown as AuditService);

  const jobs = {
    submitForHook: jest.fn((_org: string, hookId: string, request: BuildJobRequest) => {
      if (shape.failSubmit === true) return Promise.reject(new Error("pool disabled"));
      submitted.push({ hookId, request });
      return Promise.resolve({});
    }),
  } as unknown as FarmJobsService;

  return {
    windows: new PoolWindowsService(repository, audit),
    hooks: new JobHooksService(repository, jobs, audit),
    written,
    insertedWindows,
    insertedHooks,
    submitted,
  };
}

const WINDOW: CreatePoolWindowBody = {
  runner: "forge-02",
  pool: "pool-a",
  daysOfWeek: [5, 1, 3, 2, 4],
  startsAt: "14:00",
  endsAt: "16:00",
};

const HOOK: CreateJobHookBody = {
  repo: "acme/helios-firmware",
  pool: "pool-a",
  event: "merge",
  titleContains: " deps-refresh ",
  label: "ccache warm",
  title: "Re-warm ccache after deps-refresh",
  command: ["west", "build", "-t", "ccache-warm"],
};

describe("PoolWindowsService", () => {
  it("adds a window by names, days sorted, and audits it once", async () => {
    const h = harness();

    const { window, created } = await h.windows.add(ORG, ACTOR, WINDOW);

    expect(created).toBe(true);
    expect(window).toMatchObject({ runner: { name: "forge-02" }, pool: { name: "pool-a" } });
    expect(h.insertedWindows[0]).toMatchObject({
      runnerId: "r-1",
      poolId: "p-a",
      daysOfWeek: [1, 2, 3, 4, 5],
      createdBy: ACTOR,
    });
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({
      action: "runner.pool_window_added",
      subjectType: "runner_pool_window",
      detail: { runner: "forge-02", days: "1,2,3,4,5" },
    });
  });

  it("answers an identical window as is, and records nothing new", async () => {
    const h = harness({ created: false });

    const { created } = await h.windows.add(ORG, ACTOR, WINDOW);

    expect(created).toBe(false);
    expect(h.written).toEqual([]);
  });

  it("refuses a window that does not end after it starts", async () => {
    await expect(
      harness().windows.add(ORG, ACTOR, { ...WINDOW, startsAt: "16:00", endsAt: "14:00" }),
    ).rejects.toMatchObject({ code: "farm_pool_window_unordered" });
  });

  it("refuses a runner the workspace does not have", async () => {
    await expect(harness({ exists: false }).windows.add(ORG, ACTOR, WINDOW)).rejects.toMatchObject({
      code: "farm_runner_not_found",
    });
  });

  it("removes a window and audits the removal; an unknown one is a 404", async () => {
    const h = harness();
    await h.windows.remove(ORG, ACTOR, "w-1");
    expect(h.written[0]).toMatchObject({ action: "runner.pool_window_removed", subjectId: "w-1" });

    await expect(
      harness({ exists: false }).windows.remove(ORG, ACTOR, "w-9"),
    ).rejects.toMatchObject({ code: "farm_pool_window_not_found" });
  });
});

describe("JobHooksService", () => {
  it("registers a hook with its command rendered and the filter trimmed, and never audits the command", async () => {
    const h = harness();

    const { hook, created } = await h.hooks.register(ORG, ACTOR, HOOK);

    expect(created).toBe(true);
    expect(hook.command).toEqual(["west", "build", "-t", "ccache-warm"]);
    expect(h.insertedHooks[0]).toMatchObject({
      githubRepoId: "repo-1",
      titleContains: "deps-refresh",
      command: "west build -t ccache-warm",
    });
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({ action: "runner.job_hook_registered" });
    expect(JSON.stringify(h.written[0].detail)).not.toContain("ccache-warm");
  });

  it("refuses a repository the workspace does not mirror", async () => {
    await expect(harness({ exists: false }).hooks.register(ORG, ACTOR, HOOK)).rejects.toMatchObject(
      { code: "farm_repository_not_found" },
    );
  });

  it("fires every matching hook on a merge, at the base branch and the merged head", async () => {
    const h = harness({
      merged: {
        title: "deps-refresh: bump west manifest",
        base_branch: "main",
        run_repo_id: null,
        external_url: "https://github.com/acme/helios-firmware/pull/12",
        head_sha: SHA,
      },
      hooks: [hookRow()],
    });

    await h.hooks.mergeObserved(ORG, "pr-1");

    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]).toMatchObject({
      hookId: "h-1",
      request: {
        pool: "pool-a",
        repository: "acme/helios-firmware",
        ref: "refs/heads/main",
        commit: SHA,
        command: ["west", "build", "-t", "ccache-warm"],
      },
    });
  });

  it("fires nothing for a PR that is not merged, or with no head commit", async () => {
    const unmerged = harness({ hooks: [hookRow()] });
    await unmerged.hooks.mergeObserved(ORG, "pr-1");
    expect(unmerged.submitted).toEqual([]);

    const headless = harness({
      merged: {
        title: "deps-refresh",
        base_branch: "main",
        run_repo_id: "repo-1",
        external_url: "https://github.com/acme/helios-firmware/pull/12",
        head_sha: null,
      },
      hooks: [hookRow()],
    });
    await headless.hooks.mergeObserved(ORG, "pr-1");
    expect(headless.submitted).toEqual([]);
  });

  it("lets a refused submission cost only itself", async () => {
    const h = harness({
      merged: {
        title: "deps-refresh",
        base_branch: "main",
        run_repo_id: "repo-1",
        external_url: "x",
        head_sha: SHA,
      },
      hooks: [hookRow()],
      failSubmit: true,
    });

    await expect(h.hooks.mergeObserved(ORG, "pr-1")).resolves.toBeUndefined();
  });

  it.each([
    ["https://github.com/acme/helios/pull/12", "acme/helios"],
    ["https://github.com/acme", undefined],
    ["not a url", undefined],
  ])("reads the repository of %s as %s", (url, expected) => {
    expect(repositoryFromUrl(url)).toBe(expected);
  });
});
