import { recordingDatabase } from "../db/database.fixture";
import { CapabilityRepository } from "./capability.repository";

/**
 * The one read the capability guard makes (#485).
 */

describe("reading a member's explicit capability", () => {
  it("joins the member by workspace and person", async () => {
    const database = recordingDatabase();

    database.answers({ rows: [{ can_approve_loops: false }] });

    await expect(
      new CapabilityRepository(database.service).explicitFor("org-1", "user-1"),
    ).resolves.toBe(false);

    const [statement] = database.statements;

    expect(statement.sql).toContain('"member_capabilities"');
    expect(statement.sql).toContain('inner join "ouroboros"."member"');
    expect(statement.parameters).toEqual(["org-1", "user-1"]);
  });

  it("answers null when nobody set it", async () => {
    const database = recordingDatabase();

    database.answers({ rows: [] });

    await expect(
      new CapabilityRepository(database.service).explicitFor("org-1", "user-1"),
    ).resolves.toBeNull();
  });
});
