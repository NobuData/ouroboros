import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { TicketLookupRepository } from "./ticket.lookup.repository";

/**
 * The two reads the `/ouro` grammar's ticket arguments rest on (#537), as the SQL PostgreSQL
 * would receive — `detail.repository.spec.ts`' argument. What only this suite can see: both are
 * scoped to one workspace, the number is matched exactly (never `like`), the canonical twin is
 * the same repository's GitHub-sourced ticket, and neither statement can change a row.
 */

const WORKSPACE = "acme-robotics-id";

describe("the ticket lookup repository", () => {
  let database: RecordingDatabase;
  let tickets: TicketLookupRepository;

  beforeEach(() => {
    database = recordingDatabase();
    tickets = new TicketLookupRepository(database.service);
  });

  const everyRead: readonly [string, (repository: TicketLookupRepository) => Promise<unknown>][] = [
    ["byNumber", (repository) => repository.byNumber(WORKSPACE, 485)],
    ["open", (repository) => repository.open(WORKSPACE, "48", 5)],
  ];

  it.each(everyRead)("%s is scoped to the workspace, and only reads", async (_name, read) => {
    await read(tickets);

    const [statement] = database.statements;
    expect(database.statements).toHaveLength(1);
    expect(statement.sql.trim()).toMatch(/^select /);
    expect(statement.sql).not.toMatch(/\b(insert|update|delete)\b/);
    expect(statement.sql).toContain("i.organization_id = $");
    expect(statement.parameters).toContain(WORKSPACE);
  });

  it("matches the number exactly across the workspace's repositories", async () => {
    const row = {
      issueId: "issue-1",
      number: 485,
      title: "Telemetry drops frames",
      state: "open",
      owner: "acme-robotics",
      repository: "helios-firmware",
      ticketId: "ticket-1",
    };
    database.answers({ rows: [row] });

    expect(await tickets.byNumber(WORKSPACE, 485)).toEqual([row]);

    const [statement] = database.statements;
    expect(statement.sql).toContain("i.number = $");
    expect(statement.sql).not.toContain(" like ");
    // The one `limit` is the canonical-ticket subquery's; the issues themselves are never cut.
    expect(statement.sql.match(/\blimit\b/g)).toHaveLength(1);
    expect(statement.sql.trimEnd()).toMatch(/order by o\.login, r\.name$/);
    expect(statement.sql).toContain("order by o.login, r.name");
    expect(statement.parameters).toEqual([WORKSPACE, 485]);
  });

  it("narrows to a repository, and to its owner, case-insensitively", async () => {
    await tickets.byNumber(WORKSPACE, 485, { name: "Helios-Firmware" });
    await tickets.byNumber(WORKSPACE, 485, { owner: "Acme-Robotics", name: "helios-firmware" });

    expect(database.statements[0].sql).toContain("lower(r.name) = lower($");
    expect(database.statements[0].sql).not.toContain("lower(o.login) = lower($");
    expect(database.statements[0].parameters).toContain("Helios-Firmware");
    expect(database.statements[1].sql).toContain("lower(o.login) = lower($");
    expect(database.statements[1].parameters).toEqual(
      expect.arrayContaining(["Acme-Robotics", "helios-firmware"]),
    );
  });

  it("reads the canonical twin: the same repository's GitHub ticket keyed `#<number>`", async () => {
    await tickets.byNumber(WORKSPACE, 485);

    const { sql } = database.statements[0];
    expect(sql).toContain("t.organization_id = i.organization_id");
    expect(sql).toContain("src.kind = 'github'");
    expect(sql).toContain("t.external_key = '#' || i.number::text");
    expect(sql).toContain("lower(t.meta #>> '{github,owner}') = lower(o.login)");
    expect(sql).toContain("lower(t.meta #>> '{github,repo}') = lower(r.name)");
  });

  it("completes open issues by number or title prefix, escaped, most recent first", async () => {
    await tickets.open(WORKSPACE, "50%_", 5);

    const [statement] = database.statements;
    expect(statement.sql).toContain("i.state = 'open'");
    expect(statement.sql).toContain("i.number::text like $");
    expect(statement.sql).toContain("i.title ilike $");
    expect(statement.sql).toContain("order by i.gh_updated_at desc, i.number desc");
    expect(statement.parameters).toEqual(expect.arrayContaining(["50\\%\\_%", 5]));
  });

  it("offers the most recently updated open issues when nothing has been typed", async () => {
    await tickets.open(WORKSPACE, "", 5);

    expect(database.statements[0].sql).not.toContain("like");
    expect(database.statements[0].sql).toContain("limit $");
  });
});
