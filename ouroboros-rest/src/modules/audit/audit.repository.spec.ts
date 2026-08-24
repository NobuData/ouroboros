import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { AuditRepository } from "./audit.repository";

/**
 * The statements, and the three properties the trail's safety rests on.
 *
 * This layer holds no rules — it holds statements — so mocking a *method* would prove
 * nothing: `expect(repository.page).toHaveBeenCalled()` says nothing about whether the
 * workspace reached the `where` clause, and that is the thing standing between one tenant's
 * request and another tenant's record of who revealed which credential. So these run against
 * a real Kysely over a recording driver, exactly as `provider-connections.repository.spec.ts`
 * does: the compiler is real, the SQL asserted is the SQL PostgreSQL would receive, and
 * nothing is sent.
 *
 * The three properties are **org scoping**, **that there is no way to rewrite an event** —
 * which V022 enforces with a trigger and a grant, and which this layer enforces by having no
 * method for it — and **that the page and its total are narrowed alike**, because a count
 * computed against a different set is a page count that lies.
 *
 * Whether the server accepts these statements is asserted where a database exists, in
 * `audit.integration-spec.ts`.
 */

const WORKSPACE = "5eed0001-0000-4000-8000-000000000001";
const CONNECTION = "5eed000c-0000-4000-8000-000000000001";
const ACTOR = "5eed0003-0000-4000-8000-000000000001";
const WINDOW = { limit: 25, offset: 0 };

describe("the audit repository", () => {
  let database: RecordingDatabase;
  let events: AuditRepository;

  beforeEach(() => {
    database = recordingDatabase();
    events = new AuditRepository(database.service);
  });

  it("has exactly two statements, and neither of them can rewrite an event", () => {
    // The append-only posture, as a property of the method list rather than of a comment.
    // V022 refuses an update in the database; this refuses one in TypeScript, and a reader
    // asking whether this service can rewrite its own trail can answer by reading this.
    const methods = Object.getOwnPropertyNames(AuditRepository.prototype).filter(
      (name) => name !== "constructor",
    );

    expect(methods.sort()).toEqual(["append", "page", "scoped"]);
  });

  describe("appending", () => {
    it("inserts one row and answers with its id", async () => {
      database.answers({ rows: [{ id: "b2000000-0000-0000-0000-000000000001" }] });

      const id = await events.append({
        organization_id: WORKSPACE,
        actor_id: ACTOR,
        action: "provider.revealed",
        subject_type: "provider_connection",
        subject_id: CONNECTION,
        ip: "198.51.100.24",
        detail: { kind: "anthropic", step_up: "password" },
        occurred_at: new Date("2026-08-24T16:13:00.000Z"),
      });

      expect(id).toBe("b2000000-0000-0000-0000-000000000001");
      expect(database.sql()).toHaveLength(1);
      expect(database.sql()[0]).toContain('insert into "ouroboros"."audit_events"');
      expect(database.sql()[0]).toContain('returning "id"');
    });

    it("opens no transaction, so the event survives the failure it describes", async () => {
      // An audit write inside the operation's transaction would be rolled back by that
      // operation's failure — which is precisely the case AD.4 exists to cover, since *a
      // failed rotation is still an event*.
      database.answers({ rows: [{ id: "b2000000-0000-0000-0000-000000000001" }] });

      await events.append({
        organization_id: WORKSPACE,
        actor_id: null,
        action: "credential.lease_granted",
        subject_type: "run",
        subject_id: "5eed0009-0000-4000-8000-000000000482",
        ip: null,
        detail: {},
        occurred_at: new Date("2026-08-24T15:23:00.000Z"),
      });

      expect(database.sql()).not.toContain("begin");
      expect(database.sql()).not.toContain("commit");
    });
  });

  describe("paging", () => {
    beforeEach(() => {
      // Two statements per page, so two answers: the rows, then the count. Queued here
      // rather than per test because `executeTakeFirstOrThrow` is what makes an unqueued
      // count a thrown error rather than a zero, and every test below issues both.
      database.answers({ rows: [] }, { rows: [{ total: "0" }] });
    });

    it("scopes both statements to the workspace", async () => {
      // The property the trail's isolation rests on. An event names who revealed which
      // credential and from where, so a read without the workspace beside it is one request
      // away from another tenant's security history.
      await events.page(WORKSPACE, {}, WINDOW);

      expect(database.statements).toHaveLength(2);
      for (const statement of database.statements) {
        expect(statement.sql).toContain('"ouroboros"."audit_events"."organization_id" = $1');
        expect(statement.parameters[0]).toBe(WORKSPACE);
      }
    });

    it("orders newest first with the id as the tiebreaker", async () => {
      // Two events inside the same millisecond would otherwise page in whatever order the
      // planner felt like — which is how a row appears on two pages and another on none.
      await events.page(WORKSPACE, {}, WINDOW);

      expect(database.sql()[0]).toContain(
        'order by "ouroboros"."audit_events"."occurred_at" desc, ' +
          '"ouroboros"."audit_events"."id" desc',
      );
    });

    it("joins the actor's name rather than leaving a trail of ids", async () => {
      // A left join, because the two cases where it finds nothing are both ordinary: a lease
      // grant has no actor, and a deleted person leaves `actor_id` null behind.
      await events.page(WORKSPACE, {}, WINDOW);

      expect(database.sql()[0]).toContain('left join "ouroboros"."user"');
      expect(database.sql()[0]).toContain('"ouroboros"."user"."name" as "actor_name"');
    });

    it("selects no column of the person but their name", async () => {
      // A trail that was a list of email addresses would be a trail worth exfiltrating, and
      // the sheet renders a person rather than a mailbox.
      await events.page(WORKSPACE, {}, WINDOW);

      expect(database.sql()[0]).toContain('"ouroboros"."user"."name"');
      expect(database.sql()[0]).not.toContain("email");
      expect(database.sql()[0]).not.toContain("image");
    });

    it("adds a predicate for each filter and none for the ones absent", async () => {
      await events.page(WORKSPACE, { subjectId: CONNECTION, actorId: ACTOR }, WINDOW);

      const [rows] = database.statements;
      expect(rows.sql).toContain('"ouroboros"."audit_events"."subject_id" = $2');
      expect(rows.sql).toContain('"ouroboros"."audit_events"."actor_id" = $3');
      expect(rows.sql).not.toContain('"ouroboros"."audit_events"."action" =');
      expect(rows.parameters.slice(0, 3)).toEqual([WORKSPACE, CONNECTION, ACTOR]);
    });

    it("narrows the total by the same predicates as the page", async () => {
      // A `total` computed against a different set is a page count that lies, and the two
      // drifting apart is exactly what a shared builder prevents.
      await events.page(WORKSPACE, { action: "provider.revealed" }, WINDOW);

      const [rows, total] = database.statements;
      expect(total.sql).toContain('"ouroboros"."audit_events"."action" = $2');
      expect(total.parameters).toEqual([WORKSPACE, "provider.revealed"]);
      expect(rows.parameters.slice(0, 2)).toEqual([WORKSPACE, "provider.revealed"]);
    });

    it("counts without the window, so the page count is of the whole filtered set", async () => {
      await events.page(WORKSPACE, {}, { limit: 5, offset: 10 });

      const [rows, total] = database.statements;
      expect(rows.sql).toContain("limit");
      expect(rows.sql).toContain("offset");
      expect(total.sql).toContain("count(*)");
      expect(total.sql).not.toContain("limit");
    });

    it("narrows a bigint count to a number, because a trail is not a token ledger", async () => {
      // `count(*)` is a bigint, which `pg` hands over as a string and is right to. A
      // workspace's event count is far inside a double.
      const { total } = await events.page(WORKSPACE, {}, WINDOW);

      expect(total).toBe(0);
    });
  });
});
