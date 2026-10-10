import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { BriefsRepository, type MatrixPlan } from "./briefs.repository";
import { BRIEF, INVESTIGATION, MATRIX, WORKSPACE, rivalId, sourceId } from "./rs127.fixture";

/**
 * The brief's statements, against a real Kysely over a recording driver — the SQL asserted is the
 * SQL PostgreSQL would receive. Whether the server accepts it is the integration suite's.
 */

const PLAN: MatrixPlan = {
  title: "Docking vs. the field",
  usLabel: "Helios",
  rivals: ["Skylink", "Novum"],
  rows: [
    {
      capability: "Docking in gusts",
      severity: "med",
      derivation: "one step behind the best rival → med",
      cells: [
        { rival: null, status: "partial", note: null, sources: [sourceId(25), sourceId(26)] },
        { rival: 0, status: "shipping", note: null, sources: [sourceId(1)] },
        { rival: 1, status: "unknown", note: null, sources: [] },
      ],
    },
  ],
};

describe("the briefs repository", () => {
  let database: RecordingDatabase;
  let repository: BriefsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new BriefsRepository(database.service);
  });

  it("finds an investigation in its workspace only, with its kind", async () => {
    database.answers({
      rows: [
        {
          id: INVESTIGATION,
          organization_id: WORKSPACE,
          display_id: "RS-127",
          question: "Docking?",
          depth: "deep_dive",
          status: "brief_ready",
          provenance: { researcher: "loop-v1", alias: "research", resolution_ref: null },
          slug: "gap_analysis",
          display_name: "Gap analysis",
          tint_key: "gap",
        },
      ],
    });

    expect(await repository.findInvestigation(WORKSPACE, INVESTIGATION)).toEqual({
      id: INVESTIGATION,
      organizationId: WORKSPACE,
      displayId: "RS-127",
      question: "Docking?",
      kind: "gap_analysis",
      kindLabel: "Gap analysis",
      tintKey: "gap",
      depth: "deep_dive",
      status: "brief_ready",
      provenance: { researcher: "loop-v1", alias: "research", resolution_ref: null },
    });
    const [{ sql, parameters }] = database.statements;
    expect(sql).toContain('"i"."organization_id" = $1');
    expect(parameters).toEqual([WORKSPACE, INVESTIGATION]);

    expect(await repository.findInvestigation(WORKSPACE, INVESTIGATION)).toBeUndefined();
  });

  it("reads the highest brief version as the current one", async () => {
    const createdAt = new Date("2026-10-07T12:31:00Z");
    database.answers({
      rows: [{ id: BRIEF, version: 2, body: { paragraphs: [] }, created_at: createdAt }],
    });

    expect(await repository.latestBrief(INVESTIGATION)).toEqual({
      id: BRIEF,
      version: 2,
      body: { paragraphs: [] },
      createdAt,
    });
    expect(database.statements[0].sql).toContain('order by "version" desc limit $2');
    expect(await repository.latestBrief(INVESTIGATION)).toBeUndefined();
  });

  it("joins a brief's claims to the sources that back each", async () => {
    database.answers(
      {
        rows: [
          {
            id: "c1",
            span_ref: "control",
            claim_type: "finding",
            text: "Control.",
            demoted: false,
          },
          { id: "c2", span_ref: "beacon", claim_type: "open_question", text: "?", demoted: true },
        ],
      },
      {
        rows: [
          { claim_id: "c1", source_id: sourceId(12) },
          { claim_id: "c1", source_id: sourceId(31) },
        ],
      },
    );

    expect(await repository.claims(BRIEF)).toEqual([
      {
        ref: "control",
        type: "finding",
        text: "Control.",
        demoted: false,
        sources: [sourceId(12), sourceId(31)],
      },
      { ref: "beacon", type: "open_question", text: "?", demoted: true, sources: [] },
    ]);
    expect(database.statements.every((statement) => statement.parameters[0] === BRIEF)).toBe(true);
  });

  it("reads the ledger in cite-number order", async () => {
    const retrievedAt = new Date("2026-10-07T12:07:00Z");
    database.answers({
      rows: [
        {
          id: sourceId(7),
          cite_no: 7,
          cite_key: null,
          tool_slug: "web",
          kind: "web",
          title: "Teardown",
          locator: "https://example.com/t",
          retrieved_at: retrievedAt,
          content_hash: "sha256:00",
          excerpt: "An excerpt.",
        },
      ],
    });

    expect(await repository.ledger(INVESTIGATION)).toEqual([
      {
        id: sourceId(7),
        citeNo: 7,
        citeKey: null,
        tool: "web",
        kind: "web",
        title: "Teardown",
        locator: "https://example.com/t",
        retrievedAt,
        contentHash: "sha256:00",
        excerpt: "An excerpt.",
      },
    ]);
    expect(database.statements[0].sql).toContain('order by "cite_no"');
    expect(database.statements[0].parameters).toEqual([INVESTIGATION]);
  });

  it("assembles a matrix: columns in stored order, rows in sort order, cells with their links", async () => {
    database.answers(
      {
        rows: [
          { id: MATRIX, title: "Docking", us_label: "Helios", rivals: [rivalId(2), rivalId(1)] },
        ],
      },
      // The registry answers in its own order; the matrix's is what counts.
      {
        rows: [
          { id: rivalId(1), name: "Skylink" },
          { id: rivalId(2), name: "AeroMesh" },
        ],
      },
      {
        rows: [{ id: "r1", capability: "Gusts", gap_severity: "high", severity_derivation: "why" }],
      },
      {
        rows: [
          { id: "x1", row_id: "r1", competitor_id: null, status: "partial", note: null },
          { id: "x2", row_id: "r1", competitor_id: rivalId(1), status: "wip", note: "in flight" },
          { id: "x9", row_id: "another-row", competitor_id: null, status: "none", note: null },
        ],
      },
      {
        rows: [
          { cell_id: "x1", source_id: sourceId(25) },
          { cell_id: "x1", source_id: sourceId(26) },
        ],
      },
    );

    expect(await repository.matrix(INVESTIGATION)).toEqual({
      id: MATRIX,
      title: "Docking",
      usLabel: "Helios",
      rivals: [
        { id: rivalId(2), name: "AeroMesh" },
        { id: rivalId(1), name: "Skylink" },
      ],
      rows: [
        {
          id: "r1",
          capability: "Gusts",
          severity: "high",
          derivation: "why",
          cells: [
            {
              competitorId: null,
              status: "partial",
              note: null,
              sources: [sourceId(25), sourceId(26)],
            },
            { competitorId: rivalId(1), status: "wip", note: "in flight", sources: [] },
          ],
        },
      ],
    });
    expect(database.sql()[2]).toContain('order by "sort_order"');
  });

  it("has no matrix to read for an investigation without one, and asks nothing more", async () => {
    expect(await repository.matrix(INVESTIGATION)).toBeUndefined();
    expect(database.statements).toHaveLength(1);
  });

  it("names a rival the registry no longer answers for by its id, and reads no rivals for none", async () => {
    database.answers({
      rows: [{ id: MATRIX, title: "Docking", us_label: "Helios", rivals: [rivalId(3)] }],
    });
    expect((await repository.matrix(INVESTIGATION))?.rivals).toEqual([
      { id: rivalId(3), name: rivalId(3) },
    ]);

    database.answers({ rows: [{ id: MATRIX, title: "Docking", us_label: "Helios", rivals: [] }] });
    const before = database.statements.length;
    expect((await repository.matrix(INVESTIGATION))?.rivals).toEqual([]);
    expect(
      database
        .sql()
        .slice(before)
        .some((sql) => sql.includes('from "ouroboros"."competitors"')),
    ).toBe(false);
  });

  it("reads the matrix input of the latest brief that has one", async () => {
    database.answers({ rows: [{ payload: { title: "Docking" } }] });

    expect(await repository.matrixInput(INVESTIGATION)).toEqual({ title: "Docking" });
    const [{ sql, parameters }] = database.statements;
    expect(sql).toContain('order by "b"."version" desc');
    expect(parameters).toEqual([INVESTIGATION, "matrix", 1]);
    expect(await repository.matrixInput(INVESTIGATION)).toBeUndefined();
  });

  it("lists the workspace's repositories as owner/name", async () => {
    database.answers({
      rows: [
        { login: "acme-robotics", name: "helios-firmware" },
        { login: "acme-robotics", name: "tools" },
      ],
    });

    expect(await repository.repositories(WORKSPACE)).toEqual([
      "acme-robotics/helios-firmware",
      "acme-robotics/tools",
    ]);
    expect(database.statements[0].parameters).toEqual([WORKSPACE]);
  });

  describe("writing a matrix", () => {
    it("writes the matrix, its rows, cells and links in one transaction, adding a new rival", async () => {
      database.answers(
        { rows: [{ id: INVESTIGATION }] }, // the investigation, held
        { rows: [] }, // no matrix yet
        { rows: [{ id: rivalId(1), name: "SKYLINK", meta: {} }] }, // the registry
        { rows: [{ id: rivalId(9) }] }, // Novum, added
        { rows: [{ id: MATRIX }] },
        { rows: [{ id: "r1" }] },
        { rows: [{ id: "x1" }] },
        {}, // x1's links
        { rows: [{ id: "x2" }] },
        {}, // x2's link
        { rows: [{ id: "x3" }] },
      );

      expect(await repository.createMatrix(WORKSPACE, INVESTIGATION, PLAN)).toEqual({
        outcome: "built",
        matrixId: MATRIX,
      });

      const sql = database.sql();
      expect(sql[0]).toBe("begin");
      expect(sql[1]).toContain("for update");
      expect(database.statements[1].parameters).toEqual([WORKSPACE, INVESTIGATION]);
      expect(sql[4]).toContain('insert into "ouroboros"."competitors"');
      expect(database.statements[4].parameters).toEqual([WORKSPACE, "Novum"]);
      expect(sql[5]).toContain('insert into "ouroboros"."capability_matrices"');
      expect(sql[5]).toContain("::uuid[]");
      expect(database.statements[5].parameters).toEqual([
        INVESTIGATION,
        "Docking vs. the field",
        "Helios",
        [rivalId(1), rivalId(9)],
      ]);
      expect(sql[6]).toContain('insert into "ouroboros"."matrix_rows"');
      expect(database.statements[6].parameters).toEqual([
        MATRIX,
        "Docking in gusts",
        0,
        "med",
        "one step behind the best rival → med",
      ]);
      // Us, then each rival column by its registry id; the unknown cell writes no link.
      expect(database.statements[7].parameters).toEqual([
        INVESTIGATION,
        MATRIX,
        "r1",
        null,
        "partial",
        null,
      ]);
      expect(sql[8]).toContain('insert into "ouroboros"."matrix_cell_sources"');
      expect(database.statements[8].parameters).toEqual([
        INVESTIGATION,
        "x1",
        sourceId(25),
        INVESTIGATION,
        "x1",
        sourceId(26),
      ]);
      expect(database.statements[9].parameters[3]).toBe(rivalId(1));
      expect(database.statements[11].parameters.slice(3)).toEqual([rivalId(9), "unknown", null]);
      expect(sql[12]).toBe("commit");
      expect(sql).toHaveLength(13);
    });

    it("finds a rival by an alias instead of adding it twice", async () => {
      database.answers(
        { rows: [{ id: INVESTIGATION }] },
        { rows: [] },
        {
          rows: [
            { id: rivalId(1), name: "Skylink Aero", meta: { aliases: ["skylink", 7] } },
            { id: rivalId(3), name: "Novum", meta: { aliases: "not a list" } },
          ],
        },
        { rows: [{ id: MATRIX }] },
        { rows: [{ id: "r1" }] },
        { rows: [{ id: "x1" }] },
        {},
        { rows: [{ id: "x2" }] },
        {},
        { rows: [{ id: "x3" }] },
      );

      await repository.createMatrix(WORKSPACE, INVESTIGATION, PLAN);

      expect(
        database.sql().some((sql) => sql.includes('insert into "ouroboros"."competitors"')),
      ).toBe(false);
      expect(database.statements[4].parameters[3]).toEqual([rivalId(1), rivalId(3)]);
    });

    it("answers with the matrix an investigation already has, writing nothing", async () => {
      database.answers({ rows: [{ id: INVESTIGATION }] }, { rows: [{ id: MATRIX }] });

      expect(await repository.createMatrix(WORKSPACE, INVESTIGATION, PLAN)).toEqual({
        outcome: "exists",
        matrixId: MATRIX,
      });
      expect(database.sql().some((sql) => sql.startsWith("insert"))).toBe(false);
    });

    it("writes nothing for an investigation the workspace does not have", async () => {
      expect(await repository.createMatrix(WORKSPACE, INVESTIGATION, PLAN)).toEqual({
        outcome: "not_found",
      });
      expect(database.sql()).toEqual(["begin", expect.stringContaining("for update"), "commit"]);
    });
  });
});
