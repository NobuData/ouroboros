import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import type { SourceRecord } from "./research-tool.adapter";
import { ResearchToolRepository } from "./research-tool.repository";

/**
 * The tool surface's statements, against a real Kysely over a recording driver — the SQL
 * asserted is the SQL PostgreSQL would receive.
 */

const INVESTIGATION = "5eed0084-0000-4000-8000-000000000127";

/** Mockup 22's [12], as an adapter would return it. */
const SOURCE: SourceRecord = {
  kind: "web",
  title: "Skylink firmware 6.2 release notes",
  locator: "https://skylink.example.com/releases/6.2",
  retrievedAt: "2026-10-04T10:00:00.000Z",
  contentHash: `sha256:${"0".repeat(64)}`,
  excerpt: "Gust-adaptive final approach.",
  meta: { watch: "skylink-releases" },
};

describe("the research tool repository", () => {
  let database: RecordingDatabase;
  let repository: ResearchToolRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new ResearchToolRepository(database.service);
  });

  it("resolves the investigation — and so the workspace — by its id alone", async () => {
    database.answers({
      rows: [
        {
          id: INVESTIGATION,
          organization_id: "org-acme",
          display_id: "RS-127",
          status: "running",
          tools_enabled: ["web", "code"],
        },
      ],
    });

    expect(await repository.findInvestigation(INVESTIGATION)).toEqual({
      id: INVESTIGATION,
      organizationId: "org-acme",
      displayId: "RS-127",
      status: "running",
      tools: ["web", "code"],
    });
    expect(database.statements[0].sql).toContain('from "ouroboros"."investigations"');
    expect(database.statements[0].parameters).toEqual([INVESTIGATION]);
  });

  it("answers undefined for an investigation that does not exist", async () => {
    database.answers({ rows: [] });

    expect(await repository.findInvestigation(INVESTIGATION)).toBeUndefined();
  });

  it("archives a new source in a transaction and returns its cite number", async () => {
    database.answers({ rows: [] }, { rows: [{ id: "ledger-1", cite_no: 12 }] });

    expect(await repository.archiveSources(INVESTIGATION, "web", [SOURCE])).toEqual([
      { id: "ledger-1", citeNo: 12, deduplicated: false },
    ]);

    const insert = database.statements.find((statement) =>
      statement.sql.startsWith('insert into "ouroboros"."source_records"'),
    );

    expect(insert?.sql).toContain('returning "id", "cite_no"');
    expect(insert?.parameters).toEqual(
      expect.arrayContaining([
        INVESTIGATION,
        "web",
        SOURCE.locator,
        SOURCE.contentHash,
        JSON.stringify(SOURCE.meta),
      ]),
    );
    expect(database.statements.map((statement) => statement.sql)).toEqual(
      expect.arrayContaining(["begin", "commit"]),
    );
  });

  it("returns the existing number for a source already in the ledger, writing nothing", async () => {
    database.answers({ rows: [{ id: "ledger-1", cite_no: 12 }] });

    expect(await repository.archiveSources(INVESTIGATION, "web", [SOURCE])).toEqual([
      { id: "ledger-1", citeNo: 12, deduplicated: true },
    ]);
    expect(database.statements.some((statement) => statement.sql.startsWith("insert"))).toBe(false);

    const lookup = database.statements.find((statement) => statement.sql.startsWith("select"));

    expect(lookup?.parameters).toEqual([INVESTIGATION, SOURCE.contentHash, SOURCE.locator]);
  });

  it("carries a competitor_diff source's snapshot into the ledger", async () => {
    database.answers({ rows: [] }, { rows: [{ id: "ledger-2", cite_no: 13 }] });

    await repository.archiveSources(INVESTIGATION, "competitor", [
      { ...SOURCE, kind: "competitor_diff", snapshotId: "a1120000-0000-0000-0000-000000000032" },
    ]);

    const insert = database.statements.find((statement) =>
      statement.sql.startsWith('insert into "ouroboros"."source_records"'),
    );

    expect(insert?.parameters).toContain("a1120000-0000-0000-0000-000000000032");
  });

  it("records a skip once per investigation, tool, page and reason", async () => {
    database.answers({ rows: [{ id: "skip-1" }] }, { rows: [] });
    const skip = {
      locator: "https://skylink.example.com/dealers/pricing",
      reason: "robots_denied" as const,
      note: "robots.txt disallows /dealers/pricing for OuroborosResearch (Disallow: /dealers/)",
    };

    expect(await repository.recordSkip(INVESTIGATION, "web", skip)).toBe(true);
    expect(await repository.recordSkip(INVESTIGATION, "web", skip)).toBe(false);

    const [statement] = database.statements;
    expect(statement.sql).toContain('insert into "ouroboros"."source_skips"');
    expect(statement.sql).toContain(
      'on conflict ("investigation_id", "tool_slug", "locator", "reason") do nothing',
    );
    expect(statement.parameters).toEqual([
      INVESTIGATION,
      "web",
      skip.locator,
      "robots_denied",
      skip.note,
    ]);
  });

  it("clips a note to the column's bound", async () => {
    database.answers({ rows: [{ id: "skip-1" }] });

    await repository.recordSkip(INVESTIGATION, "web", {
      locator: "https://x.example.com/a.pdf",
      reason: "unsupported_type",
      note: "n".repeat(900),
    });

    expect((database.statements[0].parameters[4] as string).length).toBe(500);
  });
});
