import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ACCOUNT_LIST_LIMIT, AccountsRepository } from "./accounts.repository";

/**
 * Account approval's statements: reads of `"user"`, writes only to V149's two tables. Run
 * against a migrated database by the integration suite; here, what they compile to.
 */

describe("the accounts repository", () => {
  let database: RecordingDatabase;
  let accounts: AccountsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    accounts = new AccountsRepository(database.service);
  });

  it("lists one status newest first, capped at 200", async () => {
    await accounts.list("pending");

    const [statement] = database.statements;
    expect(statement.sql).toContain('from "ouroboros"."user"');
    expect(statement.sql).toContain('where "account_status" = $1');
    expect(statement.sql).toContain('order by "createdAt" desc, "id" desc');
    expect(statement.parameters).toEqual(["pending", ACCOUNT_LIST_LIMIT]);
    expect(ACCOUNT_LIST_LIMIT).toBe(200);
  });

  it("finds an account by id and by address", async () => {
    await accounts.find("u1");
    await accounts.findByEmail("priya@contractor.dev");

    expect(database.statements[0].sql).toContain('where "id" = $1');
    expect(database.statements[1].sql).toContain('where "email" = $1');
    expect(database.statements[1].parameters).toEqual(["priya@contractor.dev"]);
  });

  it("adds a pre-approval without overwriting one that exists", async () => {
    database.answers({ rows: [] });

    await expect(
      accounts.addPreapproved({ email: "lee@x.dev", addedBy: "ken@x.dev", note: null }),
    ).resolves.toBeUndefined();
    expect(database.statements[0].sql).toContain(
      'insert into "ouroboros"."app_preapproved_emails"',
    );
    expect(database.statements[0].sql).toContain('on conflict ("email") do nothing');
  });

  it("lists and removes pre-approvals", async () => {
    await accounts.listPreapproved();
    await accounts.removePreapproved("lee@x.dev");

    expect(database.statements[0].sql).toContain('order by "created_at" desc, "email"');
    expect(database.statements[1].sql).toContain(
      'delete from "ouroboros"."app_preapproved_emails"',
    );
  });

  it("appends an event, with an empty detail when none is given", async () => {
    await accounts.record({
      actorEmail: null,
      action: "held",
      subjectUserId: "u1",
      subjectEmail: "priya@contractor.dev",
    });

    expect(database.statements[0].sql).toContain('insert into "ouroboros"."app_account_events"');
    expect(database.statements[0].parameters).toEqual([
      null,
      "held",
      "u1",
      "priya@contractor.dev",
      {},
    ]);
  });

  it("never writes the library's user table", async () => {
    await accounts.list("denied");
    await accounts.find("u1");

    for (const statement of database.statements) {
      expect(statement.sql).not.toMatch(/^(insert|update|delete)/);
    }
  });
});
