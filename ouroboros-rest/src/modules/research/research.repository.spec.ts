import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ResearchRepository } from "./research.repository";

/**
 * The estimator's statements, against a real Kysely over a recording driver — the SQL asserted
 * is the SQL PostgreSQL would receive. Whether the server accepts it is the integration suite's.
 */

const WORKSPACE = "org-acme";
const INVESTIGATION = "5eed0084-0000-4000-8000-000000000127";

describe("the research repository", () => {
  let database: RecordingDatabase;
  let research: ResearchRepository;

  beforeEach(() => {
    database = recordingDatabase();
    research = new ResearchRepository(database.service);
  });

  describe("scoping", () => {
    const workspaceStatements: readonly [
      string,
      (repository: ResearchRepository) => Promise<unknown>,
    ][] = [
      ["findKind", (repository) => repository.findKind(WORKSPACE, "gap_analysis")],
      ["listKinds", (repository) => repository.listKinds(WORKSPACE)],
      ["findInvestigation", (repository) => repository.findInvestigation(WORKSPACE, INVESTIGATION)],
      [
        "storeEstimate",
        (repository) =>
          repository.storeEstimate(
            WORKSPACE,
            INVESTIGATION,
            { sources: { min: 40, max: 60 }, cost_cents: null },
            1,
          ),
      ],
      ["recordOutcome", (repository) => repository.recordOutcome(WORKSPACE, INVESTIGATION)],
    ];

    it.each(workspaceStatements)(
      "carries the workspace into %s, by parameter",
      async (_name, issue) => {
        await issue(research);

        expect(database.statements).toHaveLength(1);
        expect(database.statements[0].parameters).toContain(WORKSPACE);
      },
    );
  });

  describe("kinds", () => {
    it("reads the kind's playbook default tools", async () => {
      database.answers({
        rows: [
          {
            slug: "gap_analysis",
            playbook: {
              version: 1,
              default_tools: ["web", "competitor"],
              synthesis_template: "gap_analysis_v1",
              deliverables: ["brief", "matrix"],
            },
          },
        ],
      });

      expect(await research.findKind(WORKSPACE, "gap_analysis")).toEqual({
        slug: "gap_analysis",
        defaultTools: ["web", "competitor"],
      });
      expect(database.statements[0].sql).toContain('from "ouroboros"."investigation_kinds"');
      expect(database.statements[0].parameters).toEqual([WORKSPACE, "gap_analysis"]);
    });

    it("answers undefined for a kind the workspace lacks", async () => {
      expect(await research.findKind(WORKSPACE, "market_sizing")).toBeUndefined();
    });
  });

  describe("the catalogs (CN.2, #628)", () => {
    it("reads every kind of the workspace with its label, hue and playbook, by slug", async () => {
      const playbook = {
        version: 1,
        default_tools: ["web", "competitor"],
        synthesis_template: "gap_analysis@1",
        deliverables: ["brief", "matrix"],
      };
      database.answers({
        rows: [{ slug: "gap_analysis", display_name: "Gap analysis", tint_key: "gap", playbook }],
      });

      expect(await research.listKinds(WORKSPACE)).toEqual([
        { slug: "gap_analysis", displayName: "Gap analysis", tintKey: "gap", playbook },
      ]);
      const [statement] = database.statements;
      expect(statement.sql).toContain('from "ouroboros"."investigation_kinds"');
      expect(statement.sql).toContain('"organization_id" = $');
      expect(statement.sql).toContain('order by "slug"');
      expect(statement.parameters).toEqual([WORKSPACE]);
    });

    it("reads every research tool with its title, naming no workspace — the table is the installation's", async () => {
      database.answers({
        rows: [
          { slug: "docs", display_name: "Docs, standards & papers" },
          { slug: "web", display_name: "Web search & page reader" },
        ],
      });

      expect(await research.listTools()).toEqual([
        { slug: "docs", displayName: "Docs, standards & papers" },
        { slug: "web", displayName: "Web search & page reader" },
      ]);
      const [statement] = database.statements;
      expect(statement.sql).toContain('from "ouroboros"."research_tools"');
      expect(statement.sql).not.toContain("organization_id");
      expect(statement.parameters).toEqual([]);
    });

    it("answers an empty list for a workspace with no kinds", async () => {
      expect(await research.listKinds(WORKSPACE)).toEqual([]);
    });
  });

  describe("tool registration", () => {
    it("names the slugs research_tools has no row for, in selection order", async () => {
      database.answers({ rows: [{ slug: "web" }, { slug: "code" }] });

      expect(await research.unknownTools(["patents", "web", "code", "forums"])).toEqual([
        "patents",
        "forums",
      ]);
      expect(database.statements[0].sql).toContain('from "ouroboros"."research_tools"');
    });

    it("asks nothing for an empty selection", async () => {
      expect(await research.unknownTools([])).toEqual([]);
      expect(database.statements).toHaveLength(0);
    });
  });

  describe("investigations", () => {
    it("maps an investigation's scope", async () => {
      database.answers({
        rows: [
          {
            id: INVESTIGATION,
            display_id: "RS-127",
            depth: "deep_dive",
            tools_enabled: ["web"],
            status: "queued",
          },
        ],
      });

      expect(await research.findInvestigation(WORKSPACE, INVESTIGATION)).toEqual({
        id: INVESTIGATION,
        displayId: "RS-127",
        depth: "deep_dive",
        tools: ["web"],
        status: "queued",
      });
    });

    it("answers undefined for an investigation the workspace lacks", async () => {
      expect(await research.findInvestigation(WORKSPACE, INVESTIGATION)).toBeUndefined();
    });
  });

  describe("storing an estimate", () => {
    it("writes the estimate and its calibration only while the investigation is queued", async () => {
      database.answers({ numAffectedRows: 1n });

      const stored = await research.storeEstimate(
        WORKSPACE,
        INVESTIGATION,
        { sources: { min: 40, max: 60 }, cost_cents: { min: 522, max: 687 } },
        1,
      );

      expect(stored).toBe(true);
      const [statement] = database.statements;
      expect(statement.sql).toContain('update "ouroboros"."investigations"');
      expect(statement.sql).toContain('"status" = $');
      expect(statement.parameters).toContain(
        JSON.stringify({ sources: { min: 40, max: 60 }, cost_cents: { min: 522, max: 687 } }),
      );
      expect(statement.parameters).toContain(1);
      expect(statement.parameters).toContain("queued");
    });

    it("says so when no queued investigation matched", async () => {
      database.answers({ numAffectedRows: 0n });

      expect(
        await research.storeEstimate(
          WORKSPACE,
          INVESTIGATION,
          { sources: { min: 1, max: 2 }, cost_cents: null },
          1,
        ),
      ).toBe(false);
    });
  });

  describe("recording the outcome", () => {
    it("goes through V109's fill rather than re-deriving the comparison", async () => {
      await research.recordOutcome(WORKSPACE, INVESTIGATION);

      expect(database.statements[0].sql).toContain(
        '"ouroboros".record_investigation_estimate_outcome',
      );
      expect(database.statements[0].parameters).toEqual([WORKSPACE, INVESTIGATION]);
    });

    it("answers undefined when the fill returned no row", async () => {
      expect(await research.recordOutcome(WORKSPACE, INVESTIGATION)).toBeUndefined();
    });
  });
});
