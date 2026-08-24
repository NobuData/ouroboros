import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { RoutingStatsRepository } from "./stats.repository";

/**
 * The two statements — asserted as SQL, for the reason `routing.repository.spec.ts` gives: this
 * layer holds statements rather than rules, so mocking a method would prove nothing about the
 * four things that can actually be wrong here.
 *
 * **Tenancy.** Both statements must carry the workspace, which is the acceptance criterion
 * *"aggregation is organization-scoped; another organization's usage cannot leak into a total"*.
 * A total that crossed a workspace boundary would be somebody else's invoice rendered as this
 * one's, and it would look entirely plausible.
 *
 * **The window is a parameter.** `now()` written into the SQL would let two statements measure
 * two nearly-identical thirty-day spans, so a call on the boundary could be inside the matrix's
 * average and outside the card's total.
 *
 * **Nothing is coalesced.** A `coalesce(sum(cost_cents), 0)` is the single edit that would turn
 * every unpriced provider into a `$0.00`, and it is the kind of edit that looks like a
 * tidy-up. It is asserted against rather than reviewed for.
 *
 * **Nothing is written.** A service that aggregates a ledger has no business appending to it,
 * and "this module only reads" is a claim that decays silently.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const SINCE = new Date("2026-07-24T09:58:12.004Z");

describe("the routing stats repository", () => {
  let database: RecordingDatabase;
  let stats: RoutingStatsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    stats = new RoutingStatsRepository(database.service);
  });

  /** Every statement this module issues, as a callable. */
  const everyStatement: readonly [
    string,
    (repository: RoutingStatsRepository) => Promise<unknown>,
  ][] = [
    ["byTaskKind", (repository) => repository.byTaskKind(WORKSPACE, SINCE)],
    ["byProvider", (repository) => repository.byProvider(WORKSPACE, SINCE)],
  ];

  describe("what every statement does", () => {
    it.each(everyStatement)("carries the workspace in %s", async (_name, issue) => {
      await issue(stats);

      const [statement] = database.statements;

      expect(statement.sql).toContain('"organization_id" = $1');
      expect(statement.parameters[0]).toBe(WORKSPACE);
    });

    it.each(everyStatement)("takes the window as a parameter in %s", async (_name, issue) => {
      // Not `now() - interval '30 days'` in the SQL: one boundary is computed per read and
      // handed to both statements, so the four figures on the page are over one population.
      await issue(stats);

      const [statement] = database.statements;

      expect(statement.sql).toContain('"occurred_at" >= $2');
      expect(statement.parameters[1]).toBe(SINCE);
      expect(statement.sql).not.toContain("now()");
    });

    it.each(everyStatement)("coalesces nothing in %s", async (_name, issue) => {
      // The one edit that would turn every absence on this page into a fabricated number.
      await issue(stats);

      for (const statement of database.sql()) {
        expect(statement).not.toContain("coalesce");
      }
    });

    it.each(everyStatement)("writes nothing in %s", async (_name, issue) => {
      await issue(stats);

      for (const statement of database.sql()) {
        expect(statement).toMatch(/^select /);
      }
    });

    it.each(everyStatement)("reads only the ledger in %s", async (_name, issue) => {
      // Every figure is an aggregate over `token_usage` (decision M7). A join onto a stored
      // total somewhere else would be a number that drifts the moment a call is re-priced.
      await issue(stats);

      for (const statement of database.sql()) {
        expect(statement).toContain('from "ouroboros"."token_usage"');
        expect(statement).not.toContain("join");
      }
    });
  });

  describe("the per-kind aggregate", () => {
    it("groups by task kind and skips the spend no route placed", async () => {
      // A null `task_kind` is *not routed work* (V020) — an import, a chat completion, the
      // provider-level spend mockup 07 draws. Folding it in would put money the router never
      // placed onto a row of a matrix about routing.
      await stats.byTaskKind(WORKSPACE, SINCE);

      const [statement] = database.statements;

      expect(statement.sql).toContain('"task_kind" is not null');
      expect(statement.sql).toContain('group by "task_kind"');
    });

    it("averages the priced calls and takes the median of the timed ones", async () => {
      // V020's own header states this pair verbatim as the read its two columns exist for.
      await stats.byTaskKind(WORKSPACE, SINCE);

      const [statement] = database.statements;

      expect(statement.sql).toContain("avg(cost_cents)");
      expect(statement.sql).toContain("percentile_cont(0.5) within group (order by latency_ms)");
    });

    it("counts the priced, the unpriced and the timed calls beside the figures", async () => {
      // What makes a `0` believable: an average of zero over fifteen priced calls is money, and
      // an absent average over fifteen unpriced ones is an unknown. Neither is inferable from
      // the figure alone.
      await stats.byTaskKind(WORKSPACE, SINCE);

      const [statement] = database.statements;

      expect(statement.sql).toContain("count(*) filter (where cost_cents is not null)");
      expect(statement.sql).toContain("count(*) filter (where cost_cents is null)");
      expect(statement.sql).toContain("count(*) filter (where latency_ms is not null)");
    });
  });

  describe("the per-provider aggregate", () => {
    it("groups by provider and does not filter to routed work", async () => {
      // The card's claim is *this is what this provider was paid*, which includes spend no
      // route placed. Filtering to routed calls would make mockup 06 and mockup 07 disagree
      // about one invoice.
      await stats.byProvider(WORKSPACE, SINCE);

      const [statement] = database.statements;

      expect(statement.sql).toContain('group by "provider"');
      expect(statement.sql).not.toContain("task_kind");
    });

    it("sums the spend and the tokens the footnote is a fraction of", async () => {
      await stats.byProvider(WORKSPACE, SINCE);

      const [statement] = database.statements;

      expect(statement.sql).toContain("sum(cost_cents)");
      expect(statement.sql).toContain("sum(tokens_in + tokens_out)");
    });
  });

  describe("what comes back", () => {
    it("hands the rows on untouched, numerics still as text", async () => {
      // The conversion happens once, in `stats.ts`, at the contract's edge. A repository that
      // converted would be a second opinion about precision.
      database.answers({
        rows: [
          {
            task_kind: "implement",
            cost_cents_avg: "87.0000",
            latency_p50_ms: 41_000,
            priced_calls: 15,
            unpriced_calls: 0,
            timed_calls: 15,
          },
        ],
      });

      await expect(stats.byTaskKind(WORKSPACE, SINCE)).resolves.toEqual([
        {
          task_kind: "implement",
          cost_cents_avg: "87.0000",
          latency_p50_ms: 41_000,
          priced_calls: 15,
          unpriced_calls: 0,
          timed_calls: 15,
        },
      ]);
    });

    it("answers an empty list for a workspace with no usage, rather than a row of zeros", async () => {
      database.answers({ rows: [] });

      await expect(stats.byProvider(WORKSPACE, SINCE)).resolves.toEqual([]);
    });
  });
});
