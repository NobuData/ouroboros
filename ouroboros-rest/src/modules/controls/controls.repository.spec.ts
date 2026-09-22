import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ControlsRepository, type ControlSubmission } from "./controls.repository";

/**
 * The statements the queue issues (#306), as the compiler produces them, over a recording
 * driver. What matters is invisible from a mocked method: the run is locked, the workspace is
 * a predicate on the public surface, every instant is the database's `now()`, the sweep touches
 * only the two non-terminal states, and a claim skips rows another claim holds.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const ORG = "org-acme";
const CONTROL = "c0000000-0000-4000-8000-000000000001";

const SUBMISSION: ControlSubmission = {
  runId: RUN,
  kind: "steer",
  payload: "prefer a fix inside the ISR",
  remember: false,
  requestedBy: "user-1",
  ttlSeconds: 300,
};

/** A row as `returning *` would hand it back, for the statements that need one. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONTROL,
    run_id: RUN,
    kind: "pause",
    payload: null,
    state: "pending",
    requested_by: "user-1",
    requested_at: new Date("2026-09-22T10:00:00.000Z"),
    delivered_at: null,
    acked_at: null,
    expires_at: new Date("2026-09-22T10:02:00.000Z"),
    ack_detail: null,
    idempotency_key: "k",
    remember: false,
    ...overrides,
  };
}

describe("the controls repository", () => {
  let database: RecordingDatabase;
  let repository: ControlsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new ControlsRepository(database.service);
  });

  /** The one statement issued. */
  function only(): { sql: string; parameters: readonly unknown[] } {
    expect(database.statements).toHaveLength(1);

    return database.statements[0];
  }

  describe("runs", () => {
    it("locks the run by id alone on the internal surface", async () => {
      await repository.lockRun(database.service.db, RUN);

      expect(only().sql).toContain("for update");
      expect(only().sql).not.toContain("organization_id");
      expect(only().parameters).toEqual([RUN]);
    });

    it("locks the run inside the workspace on the public surface", async () => {
      await repository.lockRun(database.service.db, RUN, ORG);

      expect(only().sql).toContain('"organization_id" = $2');
      expect(only().parameters).toEqual([RUN, ORG]);
    });

    it("answers whether a workspace has a run", async () => {
      expect(await repository.runExists(database.service.db, RUN, ORG)).toBe(false);

      database.answers({ rows: [{ id: RUN }] });
      expect(await repository.runExists(database.service.db, RUN, ORG)).toBe(true);
    });

    it("cancels a run only while it is still open, and leaves its branch alone", async () => {
      database.answers({ numAffectedRows: 1n });

      expect(await repository.cancelRun(database.service.db, RUN)).toBe(true);
      expect(only().sql).toContain('set "status" = $1, "finished_at" = now()');
      expect(only().sql).toContain('"finished_at" is null');
      expect(only().sql).not.toContain("branch_name");
      expect(only().parameters).toEqual(["canceled", RUN]);
    });

    it("reports a run something else closed first", async () => {
      expect(await repository.cancelRun(database.service.db, RUN)).toBe(false);
    });

    it("reads the active stage attempt, newest first", async () => {
      await repository.activeStage(database.service.db, RUN);

      expect(only().sql).toContain('"status" = $2');
      expect(only().sql).toContain('order by "started_at" desc, "attempt" desc');
      expect(only().parameters).toEqual([RUN, "active", 1]);
    });

    it("appends a user entry without choosing its sequence number", async () => {
      database.answers({ rows: [{ seq: 7 }] });

      const seq = await repository.appendUserEntry(database.service.db, RUN, {
        body: "prefer a fix inside the ISR",
        stageKey: "implement",
        attempt: 2,
        payload: { controlId: CONTROL },
      });

      expect(seq).toBe(7);
      expect(only().sql).toContain('insert into "ouroboros"."run_events"');
      expect(only().sql).not.toContain('"seq",');
      expect(only().parameters).toContain("user");
    });
  });

  describe("controls", () => {
    it("finds a control by its key within the run", async () => {
      await repository.findByKey(database.service.db, RUN, "k-1");

      expect(only().parameters).toEqual([RUN, "k-1"]);
    });

    it("locks one control of one run", async () => {
      await repository.findForUpdate(database.service.db, RUN, CONTROL);

      expect(only().sql).toContain("for update");
      expect(only().parameters).toEqual([CONTROL, RUN]);
    });

    it("looks for an outstanding control among the two non-terminal states only", async () => {
      await repository.findOutstanding(database.service.db, RUN, "pause");

      expect(only().sql).toContain('"state" in ($3, $4)');
      expect(only().parameters).toEqual([RUN, "pause", "pending", "delivered", 1]);
    });

    it("queues a control with the database's clock and no key of its own", async () => {
      database.answers({ rows: [row()] });

      await repository.insertPending(database.service.db, SUBMISSION);

      expect(only().sql).toContain("now() + make_interval(secs => $");
      expect(only().sql).not.toContain("idempotency_key");
      expect(only().parameters).toContain("pending");
      expect(only().parameters).toContain(300);
    });

    it("passes the caller's key through when there is one", async () => {
      database.answers({ rows: [row()] });

      await repository.insertPending(database.service.db, { ...SUBMISSION, idempotencyKey: "k-1" });

      expect(only().sql).toContain("idempotency_key");
      expect(only().parameters).toContain("k-1");
    });

    it("records a rejection with its reason", async () => {
      database.answers({ rows: [row({ state: "rejected" })] });

      await repository.insertRejected(database.service.db, SUBMISSION, "finished");

      expect(only().parameters).toContain("rejected");
      expect(only().parameters).toContain("finished");
    });

    it("sweeps every run, or one, over the two non-terminal states", async () => {
      database.answers({ numAffectedRows: 3n }, { numAffectedRows: 0n });

      expect(await repository.sweep(database.service.db)).toBe(3);
      expect(await repository.sweep(database.service.db, RUN)).toBe(0);

      const [all, one] = database.statements;

      expect(all.sql).toContain('"expires_at" <= now()');
      expect(all.sql).not.toContain('"run_id"');
      expect(all.parameters).toEqual(["expired", "pending", "delivered"]);
      expect(one.sql).toContain('"run_id" = $4');
    });

    it("claims pending controls, skipping any another claim holds, oldest first", async () => {
      database.answers({
        rows: [
          row({ id: "b", requested_at: new Date("2026-09-22T10:00:02.000Z") }),
          row({ id: "a", requested_at: new Date("2026-09-22T10:00:01.000Z") }),
          row({ id: "c", requested_at: new Date("2026-09-22T10:00:01.000Z") }),
        ],
      });

      const claimed = await repository.claimPending(database.service.db, RUN);

      expect(claimed.map((control) => control.id)).toEqual(["a", "c", "b"]);
      expect(only().sql).toContain("for update skip locked");
      expect(only().sql).toContain('"delivered_at" = now()');
      expect(only().sql).toContain('"expires_at" > now()');
    });

    it("acks with the database's clock and the executor's words", async () => {
      database.answers({ rows: [row({ state: "acked" })] });

      await repository.ack(database.service.db, CONTROL, "paused");

      expect(only().sql).toContain('"acked_at" = now()');
      expect(only().parameters).toEqual(["acked", "paused", CONTROL]);
    });

    it("lists a run's controls newest first, bounded", async () => {
      await repository.list(database.service.db, RUN, 50);

      expect(only().sql).toContain('order by "requested_at" desc, "id" desc');
      expect(only().parameters).toEqual([RUN, 50]);
    });
  });

  it("runs work in a transaction", async () => {
    await expect(repository.transaction(() => Promise.resolve(42))).resolves.toBe(42);
  });
});
