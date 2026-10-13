import { recordingDatabase } from "../db/database.fixture";
import { SlackOnCallRepository } from "./slack.on-call.repository";

/**
 * The on-call statements (#543), as they are sent: every one scoped to the workspace and to the
 * `decisions` scope, the candidates only from the **active** Slack connection's **linked**
 * identities — the rule V132's trigger enforces — and an ended assignment kept, inactive.
 */

const ORG = "org-acme";
const AT = new Date("2026-10-12T14:02:11.000Z");

describe("SlackOnCallRepository", () => {
  it("reads the active assignment of the decisions scope, with the person's name", async () => {
    const database = recordingDatabase();

    database.answers({ rows: [{ id: "mem-maya", name: "Maya Chen", assigned_at: AT }] });

    expect(await new SlackOnCallRepository(database.service).designee(ORG)).toEqual({
      memberId: "mem-maya",
      name: "Maya Chen",
      assignedAt: AT,
    });
    expect(database.statements[0].sql).toBe(
      'select "m"."id", "u"."name", "a"."assigned_at" ' +
        'from "ouroboros"."on_call_assignments" as "a" ' +
        'inner join "ouroboros"."member" as "m" on "m"."id" = "a"."member_id" ' +
        'inner join "ouroboros"."user" as "u" on "u"."id" = "m"."userId" ' +
        'where "a"."organization_id" = $1 and "a"."scope" = $2 and "a"."active" = $3',
    );
    expect(database.statements[0].parameters).toEqual([ORG, "decisions", true]);
  });

  it("answers undefined when nobody is on call", async () => {
    const database = recordingDatabase();

    expect(await new SlackOnCallRepository(database.service).designee(ORG)).toBeUndefined();
  });

  it("offers only members linked on the workspace's active Slack connection", async () => {
    const database = recordingDatabase();

    database.answers({ rows: [{ id: "mem-ken", name: "Ken Suenobu" }] });

    expect(await new SlackOnCallRepository(database.service).linkedMembers(ORG)).toEqual([
      { memberId: "mem-ken", name: "Ken Suenobu" },
    ]);
    expect(database.statements[0].sql).toBe(
      'select "m"."id", "u"."name" from "ouroboros"."chat_identity_links" as "l" ' +
        'inner join "ouroboros"."chat_connections_public" as "c" on "c"."id" = "l"."connection_id" ' +
        'inner join "ouroboros"."member" as "m" on "m"."id" = "l"."member_id" ' +
        'inner join "ouroboros"."user" as "u" on "u"."id" = "m"."userId" ' +
        'where "c"."organization_id" = $1 and "c"."platform" = $2 and "c"."status" = $3 ' +
        'and "l"."state" = $4',
    );
    expect(database.statements[0].parameters).toEqual([ORG, "slack", "active", "linked"]);
  });

  it("finds a member only in this workspace", async () => {
    const database = recordingDatabase();

    expect(
      await new SlackOnCallRepository(database.service).member(ORG, "mem-omar"),
    ).toBeUndefined();
    expect(database.statements[0].sql).toBe(
      'select "m"."id", "u"."name" from "ouroboros"."member" as "m" ' +
        'inner join "ouroboros"."user" as "u" on "u"."id" = "m"."userId" ' +
        'where "m"."organizationId" = $1 and "m"."id" = $2',
    );
    expect(database.statements[0].parameters).toEqual([ORG, "mem-omar"]);
  });

  it("locks the active assignment, stands it down and inserts the new one, in one transaction", async () => {
    const database = recordingDatabase();
    const repository = new SlackOnCallRepository(database.service);

    database.answers({ rows: [{ member_id: "mem-ken" }] });

    await repository.transaction(async (trx) => {
      expect(await repository.lockActive(trx, ORG)).toBe("mem-ken");
      await repository.standDown(trx, ORG);
      await repository.assign(trx, ORG, "mem-maya", "u-admin");
    });

    expect(database.sql()).toEqual([
      "begin",
      'select "member_id" from "ouroboros"."on_call_assignments" ' +
        'where "organization_id" = $1 and "scope" = $2 and "active" = $3 for update',
      'update "ouroboros"."on_call_assignments" set "active" = $1 ' +
        'where "organization_id" = $2 and "scope" = $3 and "active" = $4',
      'insert into "ouroboros"."on_call_assignments" ' +
        '("organization_id", "member_id", "scope", "active", "assigned_by") ' +
        "values ($1, $2, $3, $4, $5)",
      "commit",
    ]);
    expect(database.statements[2].parameters).toEqual([false, ORG, "decisions", true]);
    expect(database.statements[3].parameters).toEqual([
      ORG,
      "mem-maya",
      "decisions",
      true,
      "u-admin",
    ]);
  });

  it("answers null from the lock when nobody is on call", async () => {
    const database = recordingDatabase();
    const repository = new SlackOnCallRepository(database.service);

    await expect(repository.transaction((trx) => repository.lockActive(trx, ORG))).resolves.toBe(
      null,
    );
  });
});
