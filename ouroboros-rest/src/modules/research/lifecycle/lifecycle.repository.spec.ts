import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { WORKSPACE, investigationId, uuid } from "./lifecycle.fixture";
import { LifecycleRepository, recordOf } from "./lifecycle.repository";
import { quarterOf } from "./quarter";

/**
 * The lifecycle's statements, against a real Kysely over a recording driver — the SQL asserted
 * is the SQL PostgreSQL would receive. Whether the server accepts it is the integration suite's.
 */

const CREATED = new Date("2026-10-08T09:00:00Z");
const UPDATED = new Date("2026-10-08T09:42:00Z");
const QUARTER = quarterOf(new Date("2026-10-10T12:00:00Z"));

/** One row of the record query, RS-127's unless told otherwise. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: investigationId(127),
    display_id: "RS-127",
    question: "Docking?",
    depth: "deep_dive" as const,
    tools_enabled: ["web", "code"],
    status: "brief_ready" as const,
    origin: "user" as const,
    estimate: { sources: { min: 40, max: 60 }, cost_cents: null },
    estimate_calibration_version: 1,
    actuals: { sources_used: 44, spend_cents: 612, duration_ms: 1000 },
    provenance: { researcher: "loop-v1", alias: "research", resolution_ref: null },
    created_by: "user-ken",
    created_by_name: "Ken",
    created_at: CREATED,
    updated_at: UPDATED,
    kind_slug: "gap_analysis",
    kind_name: "Gap analysis",
    kind_tint: "gap",
    sources: 44,
    spend_cents: 612,
    brief_id: uuid("5eed0093", 127),
    brief_version: 2,
    brief_created_at: UPDATED,
    brief_deliverables: { roadmap_doc: "doc" },
    matrix_id: uuid("5eed0095", 127),
    loop_updated_at: UPDATED,
    iteration: 3,
    cancel_requested_at: null,
    failure_reason: null,
    failure_detail: null,
    evidence_test_run_id: "test-run",
    evidence_run_id: "run",
    fix_run_id: "fix-run",
    ...overrides,
  };
}

describe("the lifecycle repository", () => {
  let database: RecordingDatabase;
  let repository: LifecycleRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new LifecycleRepository(database.service);
  });

  describe("the starter role", () => {
    it("reads the effective view, so a workspace that never chose reads the default", async () => {
      database.answers({ rows: [{ research_start_role: "admin" }] });

      expect(await repository.startRole(WORKSPACE)).toBe("admin");
      const [{ sql, parameters }] = database.statements;
      expect(sql).toContain('from "ouroboros"."workspace_settings_effective"');
      expect(parameters).toEqual([WORKSPACE]);
    });

    it("answers `member` should the view have no row at all", async () => {
      expect(await repository.startRole(WORKSPACE)).toBe("member");
    });

    it("upserts the role with who set it", async () => {
      database.answers({ rows: [{ research_start_role: "admin" }] });

      expect(await repository.saveStartRole(WORKSPACE, "admin", "user-ken")).toBe("admin");
      const [{ sql, parameters }] = database.statements;
      expect(sql).toContain('insert into "ouroboros"."workspace_settings"');
      expect(sql).toContain('on conflict ("organization_id") do update set');
      expect(sql).toContain('returning "research_start_role"');
      expect(parameters).toEqual([WORKSPACE, "admin", "user-ken", "admin", "user-ken"]);
    });
  });

  describe("create", () => {
    const draft = {
      kind: "gap_analysis",
      question: "Docking?",
      depth: "deep_dive" as const,
      tools: ["web", "code"],
      estimate: { sources: { min: 40, max: 60 }, cost_cents: { min: 522, max: 687 } },
      calibrationVersion: 1,
      userId: "user-ken",
    };

    it("inserts a queued, user-opened investigation of the workspace's own kind", async () => {
      database.answers({ rows: [{ id: investigationId(128) }] });

      expect(await repository.create(WORKSPACE, draft)).toBe(investigationId(128));
      const [{ sql, parameters }] = database.statements;
      expect(sql).toContain('insert into "ouroboros".investigations');
      expect(sql).toContain("'queued'");
      expect(sql).toContain("'user'");
      // The kind is resolved inside the workspace; the number is the database's to assign.
      expect(sql).toContain("where k.organization_id = $8 and k.slug = $9");
      expect(sql).not.toContain("seq");
      expect(parameters).toEqual([
        WORKSPACE,
        "Docking?",
        "deep_dive",
        '["web","code"]',
        '{"sources":{"min":40,"max":60},"cost_cents":{"min":522,"max":687}}',
        1,
        "user-ken",
        WORKSPACE,
        "gap_analysis",
      ]);
    });

    it("answers undefined when the workspace has no such kind", async () => {
      expect(await repository.create(WORKSPACE, draft)).toBeUndefined();
    });
  });

  it("discards only a queued investigation of the workspace", async () => {
    await repository.discard(WORKSPACE, investigationId(128));

    const [{ sql, parameters }] = database.statements;
    expect(sql).toContain('update "ouroboros"."investigations" set "status" = $1');
    expect(sql).toContain('"organization_id" = $2');
    expect(sql).toContain('"status" = $4');
    expect(parameters).toEqual(["cancelled", WORKSPACE, investigationId(128), "queued"]);
  });

  describe("find", () => {
    it("reads one investigation in its workspace, with everything a row derives from", async () => {
      database.answers({ rows: [row()] });

      const found = await repository.find(WORKSPACE, investigationId(127));

      expect(found).toMatchObject({
        id: investigationId(127),
        displayId: "RS-127",
        kind: { slug: "gap_analysis", name: "Gap analysis", tint: "gap" },
        sources: 44,
        spendCents: 612,
        fixRunId: "fix-run",
      });
      const [{ sql, parameters }] = database.statements;
      expect(sql).toContain("where i.organization_id = $4 and i.id = $5::uuid");
      expect(parameters.slice(-2)).toEqual([WORKSPACE, investigationId(127)]);
    });

    it("counts the ledger, sums spend, and reads the newest brief and the matrix", async () => {
      database.answers({ rows: [] });
      await repository.find(WORKSPACE, investigationId(127));

      const [{ sql }] = database.statements;
      expect(sql).toContain("select count(*)::int from");
      expect(sql).toContain('"ouroboros".investigation_spend_cents(i.id) as spend_cents');
      expect(sql).toContain("order by x.version desc");
      expect(sql).toContain('"ouroboros".capability_matrices m');
      expect(sql).toContain("jsonb_typeof(l.checkpoint -> 'iteration') = 'number'");
    });

    it("finds evidence and a fix run only inside the workspace, the run still in flight", async () => {
      database.answers({ rows: [] });
      await repository.find(WORKSPACE, investigationId(127));

      const [{ sql, parameters }] = database.statements;
      expect(sql).toContain("tr.id::text = s.meta ->> 'test_run_id'");
      expect(sql).toContain("tr.organization_id = i.organization_id");
      expect(sql).toContain(
        "p.ticket_id = d.pushed_ticket_id and p.organization_id = i.organization_id",
      );
      expect(sql).toContain("d.id::text = b.deliverables ->> 'fix_draft'");
      expect(sql).toContain("r.status in ($1, $2, $3)");
      expect(parameters.slice(0, 3)).toEqual(["coding", "building", "review"]);
    });

    it("answers undefined for another workspace's investigation", async () => {
      expect(await repository.find("org-other", investigationId(127))).toBeUndefined();
    });
  });

  describe("list", () => {
    const window = { limit: 25, offset: 50 };

    it("pages newest first and counts what matches", async () => {
      database.answers(
        { rows: [row(), row({ id: investigationId(124), display_id: "RS-124" })] },
        {
          rows: [{ total: 23 }],
        },
      );

      const listed = await repository.list(WORKSPACE, {}, window);

      expect(listed.records.map((found) => found.displayId)).toEqual(["RS-127", "RS-124"]);
      expect(listed.total).toBe(23);
      const [page, count] = database.statements;
      expect(page.sql).toContain("order by i.seq desc");
      expect(page.sql).toContain("limit $5 offset $6");
      expect(page.parameters.slice(-3)).toEqual([WORKSPACE, 25, 50]);
      expect(count.sql).toContain("select count(*)::int as total");
      expect(count.parameters).toEqual([WORKSPACE]);
    });

    it("composes kind, status and quarter with `and`, in the page and the count alike", async () => {
      database.answers({ rows: [] }, { rows: [{ total: 0 }] });

      await repository.list(
        WORKSPACE,
        { kind: "gap_analysis", statuses: ["brief_ready", "issues_filed"], quarter: QUARTER },
        window,
      );

      for (const statement of database.statements) {
        expect(statement.sql).toMatch(
          /i\.organization_id = \$\d+ and k\.slug = \$\d+ and i\.status in \(\$\d+, \$\d+\) and i\.created_at >= \$\d+ and i\.created_at < \$\d+/,
        );
      }
      expect(database.statements[1].parameters).toEqual([
        WORKSPACE,
        "gap_analysis",
        "brief_ready",
        "issues_filed",
        QUARTER.from,
        QUARTER.to,
      ]);
    });

    it("matches nothing for an empty status set rather than everything", async () => {
      database.answers({ rows: [] }, { rows: [{ total: 0 }] });

      await repository.list(WORKSPACE, { statuses: [] }, window);

      expect(database.statements[1].sql).toContain("and false");
    });

    it("answers zero when the count has no row", async () => {
      expect((await repository.list(WORKSPACE, {}, window)).total).toBe(0);
    });
  });

  describe("counts", () => {
    it("counts active by status and the quarter by its half-open window, in one statement", async () => {
      database.answers({ rows: [{ active: 4, this_quarter: 23 }] });

      expect(await repository.counts(WORKSPACE, QUARTER)).toEqual({ active: 4, thisQuarter: 23 });
      const [{ sql, parameters }] = database.statements;
      expect(sql).toContain("filter (where i.status in ($1, $2, $3, $4))");
      expect(sql).toMatch(/i\.created_at >= \$5\s+and i\.created_at < \$6/);
      expect(parameters).toEqual([
        "queued",
        "running",
        "brief_ready",
        "issues_filed",
        QUARTER.from,
        QUARTER.to,
        WORKSPACE,
      ]);
    });

    it("answers zeros for a workspace with no row", async () => {
      expect(await repository.counts(WORKSPACE, QUARTER)).toEqual({ active: 0, thisQuarter: 0 });
    });
  });

  it("counts the ledger per tool, largest first", async () => {
    database.answers({
      rows: [
        { tool: "web", count: 30 },
        { tool: "code", count: 14 },
      ],
    });

    expect(await repository.ledgerByTool(investigationId(127))).toEqual([
      { tool: "web", count: 30 },
      { tool: "code", count: 14 },
    ]);
    expect(database.statements[0].sql).toContain("order by count(*) desc, s.tool_slug");
  });
});

describe("recordOf", () => {
  it("maps a full row", () => {
    expect(recordOf(row())).toEqual({
      id: investigationId(127),
      displayId: "RS-127",
      kind: { slug: "gap_analysis", name: "Gap analysis", tint: "gap" },
      question: "Docking?",
      depth: "deep_dive",
      tools: ["web", "code"],
      status: "brief_ready",
      origin: "user",
      startedBy: { id: "user-ken", name: "Ken" },
      createdAt: CREATED,
      updatedAt: UPDATED,
      estimate: { sources: { min: 40, max: 60 }, cost_cents: null },
      estimateCalibrationVersion: 1,
      actuals: { sources_used: 44, spend_cents: 612, duration_ms: 1000 },
      provenance: { researcher: "loop-v1", alias: "research", resolution_ref: null },
      sources: 44,
      spendCents: 612,
      brief: {
        id: uuid("5eed0093", 127),
        version: 2,
        createdAt: UPDATED,
        deliverables: { roadmap_doc: "doc" },
      },
      matrixId: uuid("5eed0095", 127),
      loop: {
        iteration: 3,
        cancelRequestedAt: null,
        failureReason: null,
        failureDetail: null,
        updatedAt: UPDATED,
      },
      evidence: { testRunId: "test-run", runId: "run" },
      fixRunId: "fix-run",
    });
  });

  it("maps what an investigation does not have yet to null", () => {
    const bare = recordOf(
      row({
        created_by: null,
        created_by_name: null,
        brief_id: null,
        brief_version: null,
        brief_created_at: null,
        brief_deliverables: null,
        matrix_id: null,
        loop_updated_at: null,
        evidence_test_run_id: null,
        evidence_run_id: null,
        fix_run_id: null,
      }),
    );

    expect(bare).toMatchObject({
      startedBy: null,
      brief: null,
      matrixId: null,
      loop: null,
      evidence: null,
      fixRunId: null,
    });
  });

  it("keeps a starter whose name could not be read, and a brief with no deliverables", () => {
    const partial = recordOf(row({ created_by_name: null, brief_deliverables: null }));

    expect(partial.startedBy).toEqual({ id: "user-ken", name: "" });
    expect(partial.brief?.deliverables).toEqual({});
  });
});
