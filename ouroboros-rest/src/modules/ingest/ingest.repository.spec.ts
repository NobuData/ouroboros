import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { IngestRepository } from "./ingest.repository";

/**
 * The statements the contract issues, as the compiler produces them.
 *
 * Real Kysely over a recording driver, per `runs.repository.spec.ts`'s argument: this layer
 * holds statements rather than rules, so what is asserted is the SQL PostgreSQL would
 * receive. Four properties matter, and each of them is invisible from a mocked method:
 *
 *   * **the run is locked** before anything is allocated — `FOR UPDATE`, which is what makes
 *     *"a dense, correctly ordered `seq` with no gaps and no duplicates"* true under
 *     interleaving rather than usually true;
 *   * **`seq` is never supplied** on a transcript insert, because V046's trigger allocates it;
 *   * **a change-set report replaces**, which is an upsert *and* a delete of what was not
 *     reported — V047 is explicit that adding instead of replacing produces counts that climb
 *     for ever;
 *   * **a counter is moved in the database**, not read into the service and written back.
 *
 * The integration suite runs all of these against a migrated PostgreSQL. The two answer
 * different questions: this one is about what was asked, and that one is about whether the
 * answer was right.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const WORKSPACE = "acme-robotics-id";

describe("the ingestion repository", () => {
  let database: RecordingDatabase;
  let runs: IngestRepository;

  beforeEach(() => {
    database = recordingDatabase();
    runs = new IngestRepository(database.service);
  });

  /** The SQL of the one statement issued. */
  function only(): string {
    expect(database.statements).toHaveLength(1);

    return database.statements[0].sql;
  }

  describe("locking", () => {
    it("takes the run's row for update, and only that row", async () => {
      await runs.lockRun(database.service.db, RUN);

      expect(only()).toContain("for update");
      expect(only()).toContain('"id" = $1');
      expect(database.statements[0].parameters).toEqual([RUN]);
    });
  });

  describe("resolving", () => {
    it("finds a ticket by source and display key, and stops at the second match", async () => {
      // `external_key` is deliberately not unique (V030), so the question is *how many* rather
      // than *which*: the answer is the same for two as for twenty, and reading the rest would
      // be a scan on the way to a refusal.
      await runs.ticketsByKey(database.service.db, "source-id", "#482");

      expect(only()).toContain('"source_id" = $1');
      expect(only()).toContain('"external_key" = $2');
      expect(only()).toContain("limit $3");
      expect(database.statements[0].parameters).toEqual(["source-id", "#482", 2]);
    });

    it("checks a repository against the workspace the ticket resolved", async () => {
      // The workspace lives on the GitHub org rather than on the repository (V003), which is
      // the path `runs_repo_in_organization()` walks too.
      await runs.repositoryBelongsTo(database.service.db, WORKSPACE, "repo-id");

      expect(only()).toContain('inner join "ouroboros"."github_orgs"');
      expect(database.statements[0].parameters).toEqual(["repo-id", WORKSPACE]);
    });

    it("resolves a pin within the workspace, and only a published version", async () => {
      // A draft has a null `version` and cannot match, which is the right answer: a run pins
      // something that was published.
      await runs.pinnedDefinition(database.service.db, WORKSPACE, "standard-fix", 14);

      expect(only()).toContain('"workflows"."organization_id" = $1');
      expect(only()).toContain('"workflow_versions"."version" = $3');
      expect(database.statements[0].parameters).toEqual([WORKSPACE, "standard-fix", 14]);
    });

    it("checks a build job against the run's workspace", async () => {
      await runs.buildJobBelongsTo(database.service.db, WORKSPACE, "job-id");

      expect(only()).toContain('"organization_id" = $2');
      expect(database.statements[0].parameters).toEqual(["job-id", WORKSPACE]);
    });
  });

  describe("receipts", () => {
    it("looks one up by workspace, operation and key — the unique index's own columns", async () => {
      await runs.findReceipt(database.service.db, WORKSPACE, "run.files", "k");

      expect(only()).toContain('"organization_id" = $1');
      expect(only()).toContain('"operation" = $2');
      expect(only()).toContain('"idempotency_key" = $3');
      expect(database.statements[0].parameters).toEqual([WORKSPACE, "run.files", "k"]);
    });
  });

  describe("the transcript", () => {
    it("never supplies a sequence number", async () => {
      // V046's `run_events_append()` allocates `seq` densely, which is what AP.2's `?after=`
      // pages by. A caller-chosen number would have gaps wherever a cap refused an entry.
      await runs.appendEvents(database.service.db, RUN, [
        {
          actor: "system",
          stage_key: null,
          attempt: null,
          tool_tag: null,
          model_id: null,
          body: "opened",
          payload: null,
        },
      ]);

      const [columns] = only().split(" values ");

      expect(columns).not.toContain('"seq"');
      expect(only()).toContain('returning "seq", "elided_events"');
    });

    it("inserts one entry per statement, in the caller's order", async () => {
      // The trigger numbers rows as they *reach* it, and a multi-row insert promises no order
      // — R__dev_seed_farm.sql found that the hard way (#262). The run's lock is already held,
      // so the round trips are the only cost.
      await runs.appendEvents(database.service.db, RUN, [
        {
          actor: "plan",
          stage_key: null,
          attempt: null,
          tool_tag: null,
          model_id: null,
          body: "one",
          payload: null,
        },
        {
          actor: "plan",
          stage_key: null,
          attempt: null,
          tool_tag: null,
          model_id: null,
          body: "two",
          payload: null,
        },
      ]);

      expect(database.statements).toHaveLength(2);
      expect(database.statements[0].parameters).toContain("one");
      expect(database.statements[1].parameters).toContain("two");
    });

    it("raises the accepted hint rather than setting it", async () => {
      await runs.raiseEventHint(database.service.db, RUN, 22);

      expect(only()).toContain("greatest(event_hint, $1)");
    });
  });

  describe("the change-set", () => {
    it("upserts the reported files and removes the ones not reported", async () => {
      // A `PUT`'s semantics. V047: a second report of a file *replaces* its counts, and a file
      // an executor reverted leaves the card rather than lingering at `+0 −0`.
      await runs.replaceFiles(database.service.db, RUN, [
        { path: "a.c", status: "modified", additions: 3, deletions: 1 },
      ]);

      expect(database.statements).toHaveLength(2);
      expect(database.statements[0].sql).toContain('on conflict ("run_id", "path") do update set');
      expect(database.statements[0].sql).toContain('"additions" = "excluded"."additions"');
      expect(database.statements[1].sql).toContain('delete from "ouroboros"."run_files"');
      expect(database.statements[1].sql).toContain('"path" not in ($2)');
    });

    it("removes everything when the report names no files", async () => {
      // A run that has reverted everything it did. One statement, because there is nothing to
      // upsert — and an `not in ()` over an empty list is not a predicate PostgreSQL accepts.
      await runs.replaceFiles(database.service.db, RUN, []);

      expect(database.statements).toHaveLength(1);
      expect(database.statements[0].sql).toContain('delete from "ouroboros"."run_files"');
      expect(database.statements[0].sql).not.toContain("not in");
    });

    it("allocates the report's number in the database", async () => {
      // Incremented in one statement rather than read-then-written, even though the run's lock
      // already makes it safe.
      database.answers({ rows: [{ change_set_seq: 3 }] });

      expect(await runs.allocateChangeSetSeq(database.service.db, RUN)).toBe(3);
      expect(only()).toContain("change_set_seq + 1");
      expect(only()).toContain('returning "change_set_seq"');
    });

    it("sums the change-set with a floor of zero rather than a null", async () => {
      database.answers({ rows: [{ files: "2", additions: "59", deletions: "12" }] });

      expect(await runs.changeSetTotals(database.service.db, RUN)).toEqual({
        files: 2,
        additions: 59,
        deletions: 12,
      });
      expect(only()).toContain("coalesce(sum(additions), 0)");
    });
  });

  describe("commits", () => {
    it("reads the last sequence with a floor of zero, so the next is always one more", async () => {
      database.answers({ rows: [{ last: "0" }] });

      expect(await runs.lastCommitSeq(database.service.db, RUN)).toBe(0);
      expect(only()).toContain("coalesce(max(seq), 0)");
    });

    it("appends on the sha key, doing nothing for one already recorded", async () => {
      // A different guarantee from the idempotency key's: this one holds whatever request the
      // commit arrives in.
      await runs.appendCommits(database.service.db, RUN, [
        { sha: "a41c9e2", message: "m", committed_at: new Date(), seq: 1 },
      ]);

      expect(only()).toContain('on conflict ("run_id", "sha") do nothing');
      expect(only()).toContain('returning "sha"');
    });

    it("writes nothing at all when every commit was already known", async () => {
      expect(await runs.appendCommits(database.service.db, RUN, [])).toBe(0);
      expect(database.statements).toHaveLength(0);
    });

    it("asks for no known shas when the report names none", async () => {
      expect(await runs.knownCommitShas(database.service.db, RUN, [])).toEqual(new Set());
      expect(database.statements).toHaveLength(0);
    });
  });

  describe("resources", () => {
    it("counts unpriced rows beside the sums, so a null cost is legible", async () => {
      // Decisions M7 and N10's count-only case: `null` means every attributed row is unpriced,
      // and the count is what tells a reader that rather than leaving them to guess.
      database.answers({
        rows: [{ tokens_in: "164000", tokens_out: "48000", cost_cents: null, unpriced: "4" }],
      });

      expect(await runs.spendTotals(database.service.db, RUN)).toEqual({
        tokensIn: 164_000,
        tokensOut: 48_000,
        costCents: null,
        unpricedEvents: 4,
      });
      expect(only()).toContain("count(*) filter (where cost_cents is null)");
    });

    it("releases a reservation by setting it to null", async () => {
      await runs.setReservation(database.service.db, RUN, null);

      expect(only()).toContain('set "reserved_build_job_id" = $1');
      expect(database.statements[0].parameters).toEqual([null, RUN]);
    });
  });
});
