import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { DryRunSuggestionsRepository, type NewSuggestion } from "./suggestions.repository";

const WORKSPACE = "acme-robotics-id";
const WORKFLOW = "5eed0089-0000-4000-8000-000000000001";
const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";
const SUGGESTION = "5eed008c-0000-4000-8000-000000000001";
const SESSION = "5eed008a-0000-4000-8000-000000000001";
const RUN = {
  id: DRY_RUN,
  organization_id: WORKSPACE,
  workflow_id: WORKFLOW,
  base_version: null,
  draft_rev: 3,
  session_id: SESSION,
};
const OPS = [{ kind: "remove_stage", params: { id: "docs" } }];

describe("the suggestions repository", () => {
  let database: RecordingDatabase;
  let suggestions: DryRunSuggestionsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    suggestions = new DryRunSuggestionsRepository(database.service);
  });

  /** The statements a test issued, less a transaction's own `begin`/`commit`. */
  function issued() {
    return database.statements.filter(
      (statement) => !/^(begin|commit|rollback)$/i.test(statement.sql),
    );
  }

  function only() {
    expect(issued()).toHaveLength(1);
    return issued()[0];
  }

  it("reads a run's suggestions oldest first, the most confident first and the unscored last", async () => {
    await suggestions.forRun(DRY_RUN);

    const statement = only();
    expect(statement.sql).toContain('from "ouroboros"."dry_run_suggestions"');
    expect(statement.sql).toContain('order by "created_at", confidence desc nulls last, "id"');
    expect(statement.parameters).toEqual([DRY_RUN]);
  });

  it("finds one suggestion by its dry run, and locks it only inside a transaction", async () => {
    database.answers({ rows: [{ id: SUGGESTION }] });
    expect(await suggestions.find(DRY_RUN, SUGGESTION)).toEqual({ id: SUGGESTION });
    expect(only().sql).not.toContain("for update");
    expect(only().parameters).toEqual([DRY_RUN, SUGGESTION]);

    database.statements.length = 0;
    await database.service.transaction((trx) => suggestions.find(DRY_RUN, SUGGESTION, trx));
    expect(only().sql).toContain("for update");
  });

  it("files suggestions open, with their JSON columns serialised, and nothing for an empty list", async () => {
    expect(await suggestions.insert(RUN, [])).toEqual([]);
    expect(issued()).toHaveLength(0);

    const filed: NewSuggestion = {
      source: "llm",
      ruleId: null,
      ruleVersion: null,
      title: "Drop docs",
      body: "It never ran.",
      evidence: { alias: "coder-max" },
      proposedOps: OPS,
      confidence: null,
      confidenceBasis: { method: "llm_unscored", inputs: { validated_ops: 1 } },
    };
    database.answers({ rows: [{ id: SUGGESTION }] });

    expect(await suggestions.insert(RUN, [filed])).toEqual([{ id: SUGGESTION }]);

    const statement = only();
    expect(statement.sql).toContain('insert into "ouroboros"."dry_run_suggestions"');
    // No status: the column's default, and the trigger, write it open.
    expect(statement.sql).not.toContain('"status"');
    expect(statement.parameters).toEqual([
      WORKSPACE,
      DRY_RUN,
      "llm",
      null,
      null,
      "Drop docs",
      "It never ran.",
      '{"alias":"coder-max"}',
      JSON.stringify(OPS),
      null,
      '{"method":"llm_unscored","inputs":{"validated_ops":1}}',
    ]);
  });

  it("knows whether a run's rule suggestions were filed", async () => {
    expect(await suggestions.hasRuleSuggestions(DRY_RUN)).toBe(false);
    expect(only().parameters).toEqual([DRY_RUN, "rule", 1]);

    database.answers({ rows: [{ id: SUGGESTION }] });
    expect(await suggestions.hasRuleSuggestions(DRY_RUN)).toBe(true);
  });

  it("reads what was ignored on other runs of the same workflow, base version and draft revision", async () => {
    await suggestions.ignoredAtRevision(RUN);

    const statement = only();
    expect(statement.sql).toContain('inner join "ouroboros"."dry_runs" as "r"');
    expect(statement.sql).toContain('"r"."base_version" is not distinct from');
    expect(statement.sql).toContain('"r"."id" <>');
    expect(statement.parameters).toEqual([
      WORKSPACE,
      WORKFLOW,
      3,
      null,
      DRY_RUN,
      "rule",
      "ignored",
    ]);
  });

  it("counts the workflow's newest replay set, and answers null when there is none", async () => {
    expect(await suggestions.replay(WORKSPACE, WORKFLOW)).toBeNull();
    const statement = only();
    expect(statement.sql).toContain("from ouroboros.review_replay_pairs p");
    expect(statement.sql).toContain("order by max(p.replayed_at) desc");
    expect(statement.sql).toContain("limit 1");
    expect(statement.parameters).toEqual([WORKSPACE, WORKFLOW]);

    database.answers({
      rows: [
        {
          replay_set: "5eed008d-0000-4000-8000-000000000000",
          reviewer_stages: [["review-primary", "review-second"]],
          pairs: "10",
          style: "6",
          substance: "0",
        },
      ],
    });
    expect(await suggestions.replay(WORKSPACE, WORKFLOW)).toEqual({
      replaySet: "5eed008d-0000-4000-8000-000000000000",
      reviewerStages: ["review-primary", "review-second"],
      pairs: 10,
      styleDisagreements: 6,
      substanceDisagreements: 0,
    });
  });

  it("reads the conversation's newest dry run that ended with results", async () => {
    await suggestions.latestForSession(WORKSPACE, WORKFLOW, SESSION);

    const statement = only();
    expect(statement.sql).toContain('order by "started_at" desc');
    expect(statement.parameters).toEqual([
      WORKSPACE,
      WORKFLOW,
      SESSION,
      "complete",
      "budget_stopped",
      1,
    ]);
  });

  it("locks the draft before an Apply, and reads the draft and its revision after it", async () => {
    await database.service.transaction(async (trx) => {
      await suggestions.lockDraft(WORKFLOW, trx);
      await suggestions.revision(WORKFLOW, trx).catch(() => undefined);
      await suggestions.draft(WORKFLOW, trx).catch(() => undefined);
    });

    const [lock, revision, draft] = issued();
    expect(lock.sql).toContain('"version" is null');
    expect(lock.sql).toContain("for update");
    expect(revision.sql).toContain('select "current_version", "draft_rev"');
    expect(draft.sql).not.toContain("for update");
  });

  it("applies a batch as the suggestion actor, naming the suggestion and the run's session", async () => {
    database.answers({ rows: [{ draft_rev: 4, batch_id: "batch-4" }] });

    const batch = await database.service.transaction((trx) =>
      suggestions.applyBatch(RUN, SUGGESTION, "user-1", OPS, trx),
    );

    expect(batch).toEqual({ draft_rev: 4, batch_id: "batch-4" });
    const statement = only();
    expect(statement.sql).toContain("from ouroboros.apply_draft_batch(");
    expect(statement.sql).toContain("'suggestion'");
    expect(statement.parameters).toEqual([
      WORKSPACE,
      WORKFLOW,
      "user-1",
      SESSION,
      SUGGESTION,
      JSON.stringify(OPS),
    ]);

    await expect(
      database.service.transaction((trx) =>
        suggestions.applyBatch(RUN, SUGGESTION, null, OPS, trx),
      ),
    ).rejects.toThrow("apply_draft_batch returned no row");
  });

  it("settles a suggestion as applied with its batch, and as ignored only while it is open", async () => {
    database.answers({ rows: [{ id: SUGGESTION, status: "applied" }] });
    await database.service.transaction((trx) =>
      suggestions.markApplied(SUGGESTION, "batch-4", "user-1", trx),
    );
    const applied = only();
    expect(applied.sql).toContain('"resolved_at" = now()');
    expect(applied.parameters).toEqual(["applied", "batch-4", "user-1", SUGGESTION]);

    database.statements.length = 0;
    expect(await suggestions.markIgnored(SUGGESTION, null)).toBeUndefined();
    const ignored = only();
    expect(ignored.sql).toContain('"status" = $4');
    expect(ignored.parameters).toEqual(["ignored", null, SUGGESTION, "open"]);
  });
});
