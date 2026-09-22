import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { GUARDRAIL_CHECKS } from "../db/schema";
import {
  GUARDRAIL_SCHEDULER,
  PendingGuardrailScheduler,
  guardrailSchedulerProvider,
} from "./ingest.guardrails";

/**
 * What a change-set report triggers, before AP.3
 * ([#305](https://github.com/NobuData/ouroboros/issues/305)) answers it.
 *
 * Two things matter here and neither is the SQL. The first is that the rows are **real and
 * honest**: `pending` is V048's word for *a check that has been scheduled and has not
 * answered*, and the card draws it as pending rather than as a pass — because *"this has not
 * been judged"* and *"this was judged and was fine"* are different things to tell somebody.
 * The second is that it writes through the **handle it is given**, which is what keeps the
 * verdicts inside the report's transaction: a change-set and the verdicts about it are one
 * fact, and a report that committed without its checks would leave the card showing the
 * previous report's verdicts beside the new files.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";

describe("the scheduler AP.1 ships", () => {
  let database: RecordingDatabase;
  let scheduler: PendingGuardrailScheduler;

  beforeEach(() => {
    database = recordingDatabase();
    scheduler = new PendingGuardrailScheduler();
  });

  it("writes one row per check, pending, carrying the report's number", async () => {
    const written = await scheduler.evaluate(database.service.db, {
      runId: RUN,
      changeSetSeq: 3,
      files: 2,
    });

    expect(written).toBe(GUARDRAIL_CHECKS.length);
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0].sql).toContain('insert into "ouroboros"."guardrail_evaluations"');

    for (const check of GUARDRAIL_CHECKS) {
      expect(database.statements[0].parameters).toContain(check);
    }

    expect(database.statements[0].parameters).toContain("pending");
    expect(database.statements[0].parameters).toContain(3);
    expect(database.statements[0].parameters).toContain(RUN);
  });

  it("counts the vocabulary rather than a number written beside it", async () => {
    // A fifth check added to `GUARDRAIL_CHECKS` is a fifth row and a count of five, with no
    // edit here — which is the difference between a roster and a constant that describes one.
    const written = await scheduler.evaluate(database.service.db, {
      runId: RUN,
      changeSetSeq: 1,
      files: 1,
    });

    expect(written).toBe(GUARDRAIL_CHECKS.length);
  });

  it("carries no evidence, because it has judged nothing", async () => {
    // `guardrail_evaluations_pending_has_no_evidence` says the same thing. Without it a
    // pending row could carry the previous verdict's evidence, and the card would draw last
    // time's offending path under this time's spinner.
    await scheduler.evaluate(database.service.db, { runId: RUN, changeSetSeq: 1, files: 1 });

    expect(database.statements[0].sql).not.toContain("evidence");
    expect(database.statements[0].sql).not.toContain("ruleset_version");
    expect(database.statements[0].sql).not.toContain("policy_ref");
  });

  it("writes through the handle it is given, and takes no connection of its own", async () => {
    // The one mistake that would put the verdicts outside the report's transaction. The
    // recording database is the only connection in this test, so a scheduler that reached for
    // another would write nothing here at all.
    await scheduler.evaluate(database.service.db, { runId: RUN, changeSetSeq: 2, files: 5 });

    expect(database.statements).toHaveLength(1);
  });
});

describe("the binding", () => {
  it("is the seam AP.3 moves, and it is one line", () => {
    expect(guardrailSchedulerProvider.provide).toBe(GUARDRAIL_SCHEDULER);
    expect(guardrailSchedulerProvider.useClass).toBe(PendingGuardrailScheduler);
  });

  it("is namespaced, because a token lives in one flat space", () => {
    expect(GUARDRAIL_SCHEDULER).toBe("ouroboros:ingest:guardrail-scheduler");
  });
});
