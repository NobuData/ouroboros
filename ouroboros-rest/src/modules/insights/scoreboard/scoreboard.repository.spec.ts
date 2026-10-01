import { sql } from "kysely";

import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { throughputExtractor } from "../rollup/extractors/throughput.extractor";
import { untouchedPr } from "../untouched.sql";
import { ScoreboardRepository } from "./scoreboard.repository";

/**
 * The scoreboard's statement (BJ.3, #439): tenant scoping, the window's bounds, the serving hop,
 * I6's shared predicate, and the mapping of what comes back.
 */

const ORG = "org-scoreboard";
const SPAN = {
  from: new Date("2026-09-02T00:00:00.000Z"),
  to: new Date("2026-10-02T00:00:00.000Z"),
};

/**
 * The SQL a fragment compiles to, alone.
 *
 * @param database - Any recording database, for its compiler.
 * @param fragment - The fragment.
 * @returns Its text.
 */
function textOf(database: RecordingDatabase, fragment: ReturnType<typeof untouchedPr>): string {
  return sql`${fragment}`.compile(database.service.db).sql;
}

describe("the scoreboard repository", () => {
  let database: RecordingDatabase;
  let repository: ScoreboardRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new ScoreboardRepository(database.service);
  });

  describe("cross-tenant isolation", () => {
    it("filters every table it reads on the workspace, by parameter", async () => {
      await repository.tallies(ORG, SPAN);

      const [{ sql: text, parameters }] = database.statements;
      const scoped = text.match(/\w+\.organization_id = \$\d+/g) ?? [];

      expect(scoped.map((predicate) => predicate.split(".")[0]).sort()).toEqual([
        "pr",
        "pr",
        "s",
        "tu",
        "tu",
      ]);
      for (const predicate of scoped) {
        const index = Number(predicate.split("$")[1]) - 1;
        expect(parameters[index]).toBe(ORG);
      }
    });
  });

  describe("the window", () => {
    it("bounds merges and usage by [from, to), by parameter", async () => {
      await repository.tallies(ORG, SPAN);

      const [{ sql: text, parameters }] = database.statements;

      expect(text).toMatch(/pr\.merged_at >= \$\d+ and pr\.merged_at < \$\d+/);
      expect(text).toMatch(/tu\.occurred_at >= \$\d+ and tu\.occurred_at < \$\d+/);
      // window_runs reads merges and usage; merged and usage read them again.
      expect(parameters.filter((value) => value === SPAN.from)).toHaveLength(4);
      expect(parameters.filter((value) => value === SPAN.to)).toHaveLength(4);
    });

    it("counts loop PRs that merged, and usage under the row's own task kind", async () => {
      await repository.tallies(ORG, SPAN);

      const [{ sql: text }] = database.statements;

      expect(text).toContain("pr.run_id is not null and pr.state = 'merged'");
      expect(text).toContain("sv.run_id = tu.run_id and sv.task_kind = tu.task_kind");
      expect(text).toContain("filter (where tu.cost_cents is null)");
    });
  });

  describe("the serving hop", () => {
    it("reads each run's latest resolved snapshot per task kind", async () => {
      await repository.tallies(ORG, SPAN);

      const [{ sql: text }] = database.statements;

      expect(text).toContain("distinct on (s.run_id, s.task_kind)");
      expect(text).toContain("order by s.run_id, s.task_kind, s.resolved_at desc, s.id desc");
      expect(text).toContain("s.outcome = 'resolved'");
    });

    it("takes the last kept hop that was tried, else the first kept hop", async () => {
      await repository.tallies(ORG, SPAN);

      const [{ sql: text }] = database.statements;

      expect(text).toContain("h ->> 'decision' = 'kept'");
      expect(text).toMatch(
        /order by \(h ->> 'duration_ms'\) is null,\s+case when \(h ->> 'duration_ms'\) is null then \(h ->> 'index'\)::int\s+else -\(h ->> 'index'\)::int end\s+limit 1/,
      );
    });
  });

  describe("decision I6 — one computation with the KPI row", () => {
    it("counts untouched with the very predicate the throughput extractor fills the KPI row with", async () => {
      await repository.tallies(ORG, SPAN);
      await throughputExtractor.extract(database.service.db, ORG, "2026-10-01");

      const [scoreboard, throughput] = database.statements;

      expect(scoreboard.sql).toContain(textOf(database, untouchedPr("pr")));
      expect(throughput.sql).toContain(textOf(database, untouchedPr("closed_prs")));
      expect(textOf(database, untouchedPr("pr")).replaceAll("pr.", "closed_prs.")).toBe(
        textOf(database, untouchedPr("closed_prs")),
      );
    });

    it("excludes a PR any of whose revisions is not a loop commit", () => {
      const text = textOf(database, untouchedPr("pr"));

      expect(text).toBe(
        "not exists (select 1 from ouroboros.pr_revisions v where v.pr_id = pr.id " +
          "and not exists (select 1 from ouroboros.run_commits c " +
          "where c.run_id = pr.run_id and c.sha = v.head_sha))",
      );
    });
  });

  describe("the repository filter", () => {
    it("is absent for the workspace and joins the run's repository when given", async () => {
      await repository.tallies(ORG, SPAN);
      await repository.tallies(ORG, SPAN, "acme/helios");

      const [workspace, one] = database.statements;

      expect(workspace.sql).not.toContain("github_repos");
      expect(one.sql).toContain("join ouroboros.runs r on r.id = s.run_id");
      expect(one.sql).toContain("(gor.login || '/' || gr.name) = $");
      expect(one.parameters).toContain("acme/helios");
    });
  });

  describe("the mapping", () => {
    it("turns pg's strings into numbers, and keeps null cents as unpriced", async () => {
      database.answers({
        rows: [
          {
            task_kind: "implement",
            model_id: "claude-fable-5",
            hop: 1,
            merged: "25",
            untouched: "21",
            tokens: "25000",
            unpriced_tokens: "0",
            cost_cents: "2175.0000",
          },
          {
            task_kind: "triage",
            model_id: "byo/local-llama",
            hop: 2,
            merged: "0",
            untouched: "0",
            tokens: "900",
            unpriced_tokens: "900",
            cost_cents: null,
          },
        ],
      });

      await expect(repository.tallies(ORG, SPAN)).resolves.toEqual([
        {
          taskKind: "implement",
          model: "claude-fable-5",
          hop: 1,
          merged: 25,
          untouched: 21,
          tokens: 25000,
          unpricedTokens: 0,
          costCents: 2175,
        },
        {
          taskKind: "triage",
          model: "byo/local-llama",
          hop: 2,
          merged: 0,
          untouched: 0,
          tokens: 900,
          unpricedTokens: 900,
          costCents: null,
        },
      ]);
    });
  });

  it("asks one statement per window", async () => {
    await repository.tallies(ORG, SPAN);

    expect(database.statements).toHaveLength(1);
  });
});
