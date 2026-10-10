import { KEN, MAYA, featured, record, rs118, rs121, rs124, uuid } from "./lifecycle.fixture";
import {
  ACTIVE_STATUSES,
  deliverablesOf,
  inFlight,
  investigationDetailResource,
  investigationResource,
  linksOf,
  mayCancel,
  pillOf,
  primaryLink,
  progressResource,
  quarterResource,
} from "./lifecycle.resources";
import { quarterOf } from "./quarter";

const VIEWER = { userId: MAYA, administrator: false };

describe("the investigations card's rows", () => {
  it("reproduces mockup 22's four rows: ids, kinds, source counts, pills and links", () => {
    const rows = featured()
      .map(investigationResource)
      .map((row) => [
        row.displayId,
        row.kind.tint,
        row.sources,
        row.pill.label,
        row.link?.label ?? null,
      ]);

    expect(rows).toEqual([
      ["RS-127", "gap", 44, "✓ brief ready", "brief ↑"],
      ["RS-124", "road", 312, "✓ issues filed", "to roadmap →"],
      ["RS-121", "reg", 9, "queued", "evidence →"],
      ["RS-118", "bug", 18, "fix loop live", "open run →"],
    ]);
  });

  it("publishes a row's identity, question, depth, tools, origin, starter and times", () => {
    expect(investigationResource(record())).toMatchObject({
      id: record().id,
      displayId: "RS-127",
      kind: { slug: "gap_analysis", name: "Gap analysis", tint: "gap" },
      question: "Autonomous docking vs. Skylink / AeroMesh / Novum",
      depth: "deep_dive",
      tools: ["web", "competitor", "code", "tickets", "telemetry"],
      origin: "user",
      status: "brief_ready",
      startedBy: { id: KEN, name: "Ken Suenobu" },
      createdAt: "2026-10-08T09:00:00.000Z",
      updatedAt: "2026-10-08T09:42:00.000Z",
    });
  });
});

describe("pillOf", () => {
  it.each([
    ["queued", "queued", "warn", false],
    ["running", "running", "run", true],
    ["brief_ready", "✓ brief ready", "ok", false],
    ["issues_filed", "✓ issues filed", "ok", false],
    ["failed", "failed", "err", false],
    ["cancelled", "cancelled", "idle", false],
  ] as const)("reads %s as `%s`", (status, label, tone, live) => {
    expect(pillOf(record({ status }))).toEqual({ state: status, label, tone, live });
  });

  it("reads a finished investigation with a live fix run as `fix loop live`", () => {
    expect(pillOf(rs118())).toEqual({
      state: "fix_loop_live",
      label: "fix loop live",
      tone: "run",
      live: true,
    });
    expect(pillOf(rs118({ fixRunId: null })).label).toBe("✓ brief ready");
  });

  it("does not let a fix run hide that the investigation itself is still running", () => {
    expect(pillOf(rs118({ status: "running" })).state).toBe("running");
  });

  it("reads a running investigation asked to stop as `cancelling`", () => {
    const loop = {
      iteration: 1,
      cancelRequestedAt: new Date("2026-10-08T09:10:00Z"),
      failureReason: null,
      failureDetail: null,
      updatedAt: new Date("2026-10-08T09:10:00Z"),
    };

    expect(pillOf(record({ status: "running", loop }))).toEqual({
      state: "cancelling",
      label: "cancelling",
      tone: "warn",
      live: true,
    });
    // Once it has stopped, the request is history.
    expect(pillOf(record({ status: "cancelled", loop })).state).toBe("cancelled");
  });
});

describe("linksOf and primaryLink", () => {
  it("names every target an investigation has", () => {
    expect(linksOf(rs118())).toEqual({
      run: { kind: "run", label: "open run →", runId: uuid("5eed0010", 498) },
      roadmap: null,
      brief: { kind: "brief", label: "brief ↑", briefId: uuid("5eed0093", 118), version: 1 },
      evidence: null,
    });
    expect(linksOf(rs124()).roadmap).toEqual({
      kind: "roadmap",
      label: "to roadmap →",
      roadmapDocId: uuid("5eed0097", 124),
    });
    expect(linksOf(rs121()).evidence).toEqual({
      kind: "evidence",
      label: "evidence →",
      testRunId: uuid("5eed0020", 1),
      runId: uuid("5eed0010", 512),
    });
  });

  it("prefers the run, then the roadmap, then the brief, then the evidence", () => {
    const everything = rs118({
      brief: {
        id: "brief",
        version: 2,
        createdAt: new Date(0),
        deliverables: { roadmap_doc: "doc", fix_draft: "draft" },
      },
      evidence: { testRunId: "test-run", runId: "run" },
    });

    expect(primaryLink(linksOf(everything))?.kind).toBe("run");
    expect(primaryLink(linksOf({ ...everything, fixRunId: null }))?.kind).toBe("roadmap");
    expect(
      primaryLink(linksOf(rs118({ fixRunId: null, evidence: everything.evidence })))?.kind,
    ).toBe("brief");
    expect(primaryLink(linksOf(rs121()))?.kind).toBe("evidence");
  });

  it("has no link for an investigation that has led nowhere yet", () => {
    expect(primaryLink(linksOf(rs121({ evidence: null })))).toBeNull();
    expect(investigationResource(rs121({ evidence: null })).link).toBeNull();
  });
});

describe("progressResource", () => {
  const loop = {
    iteration: 0,
    cancelRequestedAt: null,
    failureReason: null,
    failureDetail: null,
    updatedAt: new Date("2026-10-08T09:05:00Z"),
  };

  it("reads a queued investigation as not started", () => {
    expect(progressResource(rs121())).toEqual({
      status: "queued",
      iteration: null,
      iterations: 2,
      sources: 9,
      spendCents: 0,
      cancelRequested: false,
      updatedAt: "2026-10-08T09:42:00.000Z",
    });
  });

  it("counts rounds from one, out of the depth's rounds", () => {
    const running = record({ status: "running", sources: 12, spendCents: 140, loop });

    expect(progressResource(running)).toMatchObject({ iteration: 1, iterations: 4, sources: 12 });
    expect(progressResource({ ...running, loop: { ...loop, iteration: 3 } }).iteration).toBe(4);
  });

  it("holds the round at the last one while the loop synthesizes", () => {
    const synthesizing = record({ status: "running", loop: { ...loop, iteration: 4 } });

    expect(progressResource(synthesizing).iteration).toBe(4);
    expect(progressResource({ ...synthesizing, loop: { ...loop, iteration: -1 } }).iteration).toBe(
      1,
    );
  });

  it("reads a finished run's spend from its actuals, not from the usage rows", () => {
    const finished = record({
      spendCents: 0,
      actuals: { sources_used: 44, spend_cents: 612, duration_ms: 1 },
    });
    const unpriced = record({
      spendCents: 5,
      actuals: { sources_used: 44, spend_cents: null, duration_ms: 1 },
    });

    expect(progressResource(finished).spendCents).toBe(612);
    expect(progressResource(unpriced).spendCents).toBeNull();
    expect(
      progressResource(record({ status: "running", actuals: null, spendCents: 140 })).spendCents,
    ).toBe(140);
  });

  it("keeps a null spend null — unpriced is not free", () => {
    expect(
      progressResource(record({ status: "running", actuals: null, spendCents: null })).spendCents,
    ).toBeNull();
  });

  it("reports a cancel request only while the run can still stop", () => {
    const asked = { ...loop, cancelRequestedAt: new Date("2026-10-08T09:06:00Z") };

    expect(progressResource(record({ status: "running", loop: asked })).cancelRequested).toBe(true);
    expect(progressResource(record({ status: "cancelled", loop: asked })).cancelRequested).toBe(
      false,
    );
  });

  it("stamps the later of the investigation's and the loop's last write", () => {
    const later = { ...loop, updatedAt: new Date("2026-10-08T10:00:00Z") };

    expect(progressResource(record({ loop: later })).updatedAt).toBe("2026-10-08T10:00:00.000Z");
    expect(progressResource(record({ loop })).updatedAt).toBe("2026-10-08T09:42:00.000Z");
  });
});

describe("deliverablesOf", () => {
  it("lists nothing before there is a brief", () => {
    expect(deliverablesOf(rs121())).toEqual([]);
  });

  it("lists the brief, then the matrix, then what the brief references", () => {
    expect(deliverablesOf(record())).toEqual([
      { kind: "brief", id: uuid("5eed0093", 127) },
      { kind: "matrix", id: uuid("5eed0095", 127) },
    ]);
    expect(deliverablesOf(rs124())).toEqual([
      { kind: "brief", id: uuid("5eed0093", 124) },
      { kind: "draft_batch", id: uuid("5eed0090", 124) },
      { kind: "roadmap_doc", id: uuid("5eed0097", 124) },
    ]);
  });

  it("names the matrix once when a brief references it too", () => {
    const both = record({
      brief: { id: "b", version: 2, createdAt: new Date(0), deliverables: { matrix: "old" } },
    });

    expect(deliverablesOf(both).filter((entry) => entry.kind === "matrix")).toEqual([
      { kind: "matrix", id: uuid("5eed0095", 127) },
    ]);
  });
});

describe("mayCancel", () => {
  it("lets the starter and an administrator, and nobody else", () => {
    expect(mayCancel(record(), { userId: KEN, administrator: false })).toBe(true);
    expect(mayCancel(record(), { userId: MAYA, administrator: true })).toBe(true);
    expect(mayCancel(record(), VIEWER)).toBe(false);
  });

  it("gives a service account and a starterless investigation no starter's right", () => {
    expect(mayCancel(record(), { userId: null, administrator: false })).toBe(false);
    expect(mayCancel(record({ startedBy: null }), { userId: null, administrator: false })).toBe(
      false,
    );
    expect(mayCancel(record({ startedBy: null }), { userId: null, administrator: true })).toBe(
      true,
    );
  });
});

describe("investigationDetailResource", () => {
  it("opens RS-127: estimate, actuals, provenance, brief, deliverables, ledger and links", () => {
    const detail = investigationDetailResource(
      record(),
      [
        { tool: "web", count: 20 },
        { tool: "code", count: 24 },
      ],
      VIEWER,
    );

    expect(detail).toMatchObject({
      displayId: "RS-127",
      estimate: {
        sources: { min: 40, max: 60 },
        costCents: { min: 522, max: 687 },
        calibrationVersion: 1,
      },
      actuals: { sourcesUsed: 44, spendCents: 612, durationMs: 2_520_000 },
      provenance: { researcher: "loop-v1", alias: "researcher-long-ctx", resolutionRef: null },
      brief: { id: uuid("5eed0093", 127), version: 1, createdAt: "2026-10-08T09:42:00.000Z" },
      ledger: {
        total: 44,
        byTool: [
          { tool: "web", count: 20 },
          { tool: "code", count: 24 },
        ],
      },
      failure: null,
      mayCancel: false,
    });
    expect(detail.links.brief?.label).toBe("brief ↑");
    expect(detail.progress.status).toBe("brief_ready");
  });

  it("opens a queued investigation with nothing measured yet", () => {
    expect(investigationDetailResource(rs121(), [], VIEWER)).toMatchObject({
      estimate: null,
      actuals: null,
      provenance: null,
      brief: null,
      deliverables: [],
      ledger: { total: 9, byTool: [] },
    });
  });

  it("offers cancel only while in flight, to the starter or an administrator", () => {
    const starter = { userId: KEN, administrator: false };

    expect(investigationDetailResource(rs121(), [], starter).mayCancel).toBe(true);
    expect(investigationDetailResource(rs121(), [], VIEWER).mayCancel).toBe(false);
    expect(investigationDetailResource(record(), [], starter).mayCancel).toBe(false);
  });

  it("says why a failed investigation failed, and keeps its ledger", () => {
    const failed = record({
      status: "failed",
      sources: 31,
      actuals: null,
      loop: {
        iteration: 2,
        cancelRequestedAt: null,
        failureReason: "budget_breach",
        failureDetail: "Spend reached the ceiling.",
        updatedAt: new Date("2026-10-08T09:30:00Z"),
      },
    });

    const detail = investigationDetailResource(failed, [{ tool: "web", count: 31 }], VIEWER);

    expect(detail.failure).toEqual({
      reason: "budget_breach",
      detail: "Spend reached the ceiling.",
    });
    expect(detail.ledger.total).toBe(31);
  });

  it("names no failure for a run that did not fail, or failed without a recorded reason", () => {
    const loop = {
      iteration: 0,
      cancelRequestedAt: null,
      failureReason: null,
      failureDetail: null,
      updatedAt: new Date(0),
    };

    expect(
      investigationDetailResource(record({ status: "failed", loop }), [], VIEWER).failure,
    ).toBeNull();
    expect(
      investigationDetailResource(record({ status: "failed" }), [], VIEWER).failure,
    ).toBeNull();
  });
});

describe("the vocabulary", () => {
  it("counts everything that did not fail or get cancelled as active", () => {
    expect(ACTIVE_STATUSES).toEqual(["queued", "running", "brief_ready", "issues_filed"]);
  });

  it("calls only queued and running in flight", () => {
    expect((["queued", "running"] as const).every(inFlight)).toBe(true);
    expect((["brief_ready", "issues_filed", "failed", "cancelled"] as const).some(inFlight)).toBe(
      false,
    );
  });

  it("publishes a quarter's key and bounds", () => {
    expect(quarterResource(quarterOf(new Date("2026-10-10T00:00:00Z")))).toEqual({
      key: "2026-Q4",
      from: "2026-10-01T00:00:00.000Z",
      to: "2027-01-01T00:00:00.000Z",
    });
  });
});
