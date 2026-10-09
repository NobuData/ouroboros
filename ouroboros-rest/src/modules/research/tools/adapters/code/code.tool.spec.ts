/* eslint-disable @typescript-eslint/require-await -- fakes answer at once; async keeps the real signatures */
/**
 * The code & git mining tool (CL.4, #617) — its operations over recorded engine answers, its
 * citations, its honest `unsupported`, its card.
 */

import { resultViolations } from "../../research-tool.citations";
import { ResearchToolError } from "../../research-tool.errors";
import { conformanceContext } from "../../conformance.fixture";
import { CodeRefusal } from "../../../code/code.reader";
import type { BisectView } from "../../../code/code-bisect.service";
import type { DetectedStack, EnabledRepository } from "../../../code/code.workspace";
import { CodeResearchTool, range, repositoriesPhrase } from "./code.tool";
import {
  BISECT_COMMITS,
  BLAME,
  DEP_GRAPH,
  DEP_GRAPH_WIRE,
  HELIOS,
  ORG,
  recordedReader,
} from "./code.recordings.fixture";
import { depGraphSchema } from "../../../../engine/engine.code.contract";

/**
 * An asymmetric matcher for a substring, typed as the field it stands in for.
 *
 * @param text - The substring.
 * @returns The matcher.
 */
function containing(text: string): string {
  return expect.stringContaining(text) as string;
}

const CONTEXT = { ...conformanceContext({ config: {}, secret: null }), organizationId: ORG };

const CULPRIT = BISECT_COMMITS.commits[0];
const JOB = "a1180004-0000-4000-8000-000000000001";

function converged(): BisectView {
  return {
    bisect: {
      id: "b1500000-0000-4000-8000-000000000001",
      organizationId: ORG,
      investigationId: CONTEXT.investigationId,
      githubRepoId: HELIOS.id,
      repository: HELIOS.slug,
      pool: "hil-rig",
      testRef: "hil:hover_drift",
      command: null,
      goodRef: "v2.0.4",
      badRef: "nightly",
      goodSha: BISECT_COMMITS.goodSha,
      badSha: BISECT_COMMITS.badSha,
      buildRef: "refs/heads/nightly",
      commits: BISECT_COMMITS.commits,
      lo: 0,
      hi: 0,
      maxSteps: 3,
      status: "converged",
      culpritSha: CULPRIT,
      note: null,
      createdAt: new Date("2026-10-09T06:00:00Z"),
      finishedAt: new Date("2026-10-09T09:00:00Z"),
    },
    steps: [
      {
        step: 1,
        candidate: 0,
        commitSha: CULPRIT,
        buildJobId: JOB,
        jobNumber: 4411,
        jobStatus: "failed",
        verdict: "bad",
        decidedAt: new Date("2026-10-09T09:00:00Z"),
      },
    ],
  };
}

function tool(
  options: {
    reader?: ReturnType<typeof recordedReader>;
    repositories?: EnabledRepository[];
    stack?: DetectedStack;
    engineUp?: boolean;
  } = {},
) {
  const reader = options.reader ?? recordedReader();
  const bisects = {
    start: jest.fn(async () => converged()),
    get: jest.fn(async (_org: string, id: string) =>
      id === converged().bisect.id ? converged() : undefined,
    ),
    cancel: jest.fn(async () => ({
      ...converged(),
      bisect: { ...converged().bisect, status: "canceled" as const, culpritSha: null },
    })),
  };
  const adapter = new CodeResearchTool({
    reader,
    bisects,
    workspace: {
      enabled: async () => options.repositories ?? [HELIOS],
      stack: async () => options.stack ?? { stack: "c", language: "C" },
    },
    engineUp: async () => options.engineUp ?? true,
  });
  return { adapter, reader, bisects };
}

describe("the code tool's card", () => {
  it("is mockup 22's third row", () => {
    expect(tool().adapter.displayMeta()).toEqual({
      name: "Codebase & git mining",
      glyph: "⌥",
      subLine: "blame, bisect, dependency graph over {repos}",
    });
  });

  it("names the workspace's enabled repositories in its sub-line", async () => {
    expect(await tool().adapter.counts(ORG)).toEqual({ repos: "helios-firmware" });
    const names = (list: string[]) =>
      repositoriesPhrase(list.map((name) => ({ ...HELIOS, name, slug: `acme/${name}` })));
    expect(names([])).toBe("no repositories enabled");
    expect(names(["a", "b"])).toBe("a and b");
    expect(names(["a", "b", "c"])).toBe("a, b and c");
    expect(names(["a", "b", "c", "d"])).toBe("4 repositories");
  });

  it("reports health from the repositories and the engine", async () => {
    expect((await tool().adapter.healthCheck({}, null, ORG)).state).toBe("healthy");
    expect((await tool({ repositories: [] }).adapter.healthCheck({}, null, ORG)).state).toBe(
      "not_configured",
    );
    expect((await tool({ engineUp: false }).adapter.healthCheck({}, null, ORG)).state).toBe("down");
    expect((await tool().adapter.healthCheck(null, null, ORG)).state).toBe("not_configured");
  });
});

describe("the code tool's operations", () => {
  it("blames a range, cited at the exact commit and lines read", async () => {
    const { adapter, reader } = tool();

    const result = await adapter.query(CONTEXT, {
      op: "blame",
      repo: "helios-firmware",
      path: "src/dock/dock_ctrl.c",
      range: "213-215",
    });

    expect(reader.calls[0]).toEqual({
      operation: "blame",
      body: { ref: "main", path: "src/dock/dock_ctrl.c", start: 213, end: 215 },
    });
    expect(result.payload).toBe(BLAME);
    expect(BLAME.unchanged.phrase).toBe("unchanged in 14 months");
    expect(result.sources[0]?.locator).toBe(
      `git://acme-robotics/helios-firmware@${BLAME.sha}/src/dock/dock_ctrl.c#L213-L215`,
    );
    expect(result.sources[0]?.title).toContain("unchanged in 14 months");
    expect(resultViolations(result, null)).toEqual([]);
  });

  it("answers every read op within the citation contract", async () => {
    const { adapter, reader } = tool();
    const inputs = [
      { op: "history", repo: "helios-firmware", path: "src/motor/pid.c", windowDays: 180 },
      { op: "history", repo: "helios-firmware", symbol: "approach_kp" },
      {
        op: "changed_between",
        repo: "helios-firmware",
        refA: "v2.0.4",
        refB: "nightly",
        scope: "src/motor",
      },
      { op: "dep_graph", repo: "helios-firmware", module: "src/dock", ref: "nightly" },
    ];

    for (const input of inputs) {
      expect(resultViolations(await adapter.query(CONTEXT, input), null)).toEqual([]);
    }
    expect(reader.calls.map((call) => call.operation)).toEqual([
      "history",
      "history",
      "changed-between",
      "dep-graph",
    ]);
    expect(reader.calls[1]?.body).toMatchObject({
      symbol: "approach_kp",
      path: null,
      window_days: 90,
    });
    expect(reader.calls[2]?.body).toEqual({ base: "v2.0.4", head: "nightly", scope: "src/motor" });
    expect(reader.calls[3]?.body).toEqual({ ref: "nightly", module: "src/dock", stack: "c" });
  });

  it("reads history over the workspace's configured window when the call names none", async () => {
    const { adapter, reader } = tool();

    await adapter.query(
      { ...CONTEXT, config: { windowDays: "365" } },
      { op: "history", repo: "helios-firmware", path: "src" },
    );

    expect(reader.calls[0]?.body.window_days).toBe(365);
  });

  it("answers a stack detection does not support with unsupported — never an empty graph", async () => {
    const rust = tool({ stack: { stack: null, language: "Rust" } });
    await expect(
      rust.adapter.query(CONTEXT, { op: "dep_graph", repo: "helios-firmware" }),
    ).rejects.toMatchObject({
      errorClass: "unsupported",
      detail: containing("Rust"),
    });
    expect(rust.reader.calls).toEqual([]);

    const unscanned = tool({ stack: { stack: null, language: null } });
    await expect(
      unscanned.adapter.query(CONTEXT, { op: "dep_graph", repo: "helios-firmware" }),
    ).rejects.toMatchObject({
      errorClass: "unsupported",
      detail: containing("not scanned"),
    });
  });

  it("passes the engine's unsupported through as unsupported", async () => {
    const empty = depGraphSchema.parse({
      ...DEP_GRAPH_WIRE,
      status: "unsupported",
      reason: "there are no C/C++ sources under docs",
      nodes: [],
      edges: [],
      module_edges: [],
      external: [],
    });
    const { adapter } = tool({ reader: recordedReader({ "dep-graph": empty }) });

    await expect(
      adapter.query(CONTEXT, { op: "dep_graph", repo: "helios-firmware", module: "docs" }),
    ).rejects.toEqual(
      new ResearchToolError("unsupported", "there are no C/C++ sources under docs"),
    );
    expect(DEP_GRAPH.status).toBe("ok");
  });

  it("starts the bisect primitive and cites the culprit with the jobs that proved it", async () => {
    const { adapter, bisects } = tool();

    const result = await adapter.query(CONTEXT, {
      op: "bisect",
      repo: "helios-firmware",
      good: "v2.0.4",
      bad: "nightly",
      testRef: "hil:hover_drift",
      pool: "hil-rig",
      command: ["west", "twister"],
    });

    expect(bisects.start).toHaveBeenCalledWith({
      organizationId: ORG,
      repository: "helios-firmware",
      good: "v2.0.4",
      bad: "nightly",
      testRef: "hil:hover_drift",
      pool: "hil-rig",
      command: ["west", "twister"],
      investigationId: CONTEXT.investigationId,
      createdBy: null,
    });
    expect(result.payload).toMatchObject({ status: "converged", culprit: CULPRIT });
    expect(result.sources[0]?.locator).toBe(
      `bisect://acme-robotics/helios-firmware@${CULPRIT}?jobs=${JOB}`,
    );
    expect(resultViolations(result, null)).toEqual([]);
  });

  it("re-reads and cancels a bisect by id", async () => {
    const { adapter } = tool();
    const id = converged().bisect.id;

    expect(
      (await adapter.query(CONTEXT, { op: "bisect_status", bisectId: id })).payload,
    ).toMatchObject({
      status: "converged",
    });
    const canceled = await adapter.query(CONTEXT, { op: "bisect_cancel", bisectId: id });
    expect(canceled.payload).toMatchObject({ status: "canceled", culprit: null });
    expect(canceled.sources[0]?.locator).toMatch(/^git:\/\//);
    await expect(
      adapter.query(CONTEXT, { op: "bisect_status", bisectId: "nope" }),
    ).rejects.toMatchObject({
      errorClass: "unsupported",
    });
  });

  it.each([
    [{ op: "grep" }, "the code tool answers"],
    [{ op: "blame", repo: "helios-firmware", path: "x.c", range: "9-1" }, "range"],
    [{ op: "blame", repo: "helios-firmware", path: "x.c" }, "range"],
    [{ op: "blame", repo: "helios-firmware", range: "1" }, "path is required"],
    [{ op: "history", repo: "helios-firmware" }, "path or a symbol"],
    [{ op: "history", repo: "helios-firmware", path: "src", windowDays: 0 }, "windowDays"],
    [{ op: "changed_between", repo: "helios-firmware", refA: "v2.0.4" }, "refB is required"],
    [{ op: "blame", repo: "acme/other", path: "x.c", range: "1" }, "not a repository"],
    [
      {
        op: "bisect",
        repo: "helios-firmware",
        good: "a",
        bad: "b",
        testRef: "t",
        pool: "p",
        command: [],
      },
      "argv",
    ],
  ])("refuses %j as unsupported", async (input, detail) => {
    await expect(tool().adapter.query(CONTEXT, input)).rejects.toMatchObject({
      errorClass: "unsupported",
      detail: containing(detail),
    });
  });

  it("classifies a refused token as auth and an unreachable engine as network", async () => {
    const auth = tool({
      reader: recordedReader({ blame: new CodeRefusal("auth", "GitHub refused") }),
    });
    await expect(
      auth.adapter.query(CONTEXT, {
        op: "blame",
        repo: "helios-firmware",
        path: "x.c",
        range: "1",
      }),
    ).rejects.toMatchObject({ errorClass: "auth" });

    const down = tool({
      reader: recordedReader({ blame: new CodeRefusal("network", "engine down") }),
    });
    await expect(
      down.adapter.query(CONTEXT, {
        op: "blame",
        repo: "helios-firmware",
        path: "x.c",
        range: "1",
      }),
    ).rejects.toMatchObject({ errorClass: "network" });

    const broken = tool({ reader: recordedReader({ blame: new Error("socket") }) });
    await expect(
      broken.adapter.query(CONTEXT, {
        op: "blame",
        repo: "helios-firmware",
        path: "x.c",
        range: "1",
      }),
    ).rejects.toEqual(new ResearchToolError("upstream", "the code tool could not answer"));
  });
});

describe("a blame range", () => {
  it.each([
    ["214", [214, 214]],
    ["200-230", [200, 230]],
    [
      [200, 230],
      [200, 230],
    ],
    [[7], [7, 7]],
  ])("reads %j", (value, expected) => {
    expect(range(value)).toEqual(expected);
  });
});
