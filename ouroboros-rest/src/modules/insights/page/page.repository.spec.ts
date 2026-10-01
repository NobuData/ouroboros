import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { InsightsPageRepository } from "./page.repository";

/** The page's one statement (BJ.2, #438): the workspace's enabled connections' caps, summed. */

const ORG = "org-insights";

describe("the insights page repository", () => {
  let database: RecordingDatabase;
  let repository: InsightsPageRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new InsightsPageRepository(database.service);
  });

  it("sums the caps of the workspace's enabled connections, and counts the capped ones", async () => {
    database.answers({ rows: [{ monthly_cap_cents: "81500", connections: "3" }] });

    await expect(repository.caps(ORG)).resolves.toEqual({
      monthlyCapCents: 81_500,
      connections: 3,
    });

    const [{ sql, parameters }] = database.statements;

    expect(sql).toContain('sum("monthly_cap_cents")');
    // count(column), not count(*): an uncapped connection is not a capped one.
    expect(sql).toContain('count("monthly_cap_cents")');
    expect(sql).toContain('"organization_id" = $1');
    expect(sql).toContain('"enabled" = $2');
    expect(parameters).toEqual([ORG, true]);
  });

  it("answers a null cap — not zero — when no connection has one", async () => {
    database.answers({ rows: [{ monthly_cap_cents: null, connections: "0" }] });

    await expect(repository.caps(ORG)).resolves.toEqual({ monthlyCapCents: null, connections: 0 });
  });
});
