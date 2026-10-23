/**
 * The `tests` family — cases run, the pass rate and failures by suite (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433); source: #324's test plane).
 *
 * **The population is finished test runs** (`complete` or `error`, not `running`) **started on the
 * day**, read through their suites' counts. A case *ran* when it passed, failed or was flaky;
 * skipped did not run. A flaky case passed in the end, so it is a pass here.
 *
 * `test_failures_by_suite` is dimensioned by `test_suites.name` — the failures-by-suite card's
 * bars. A suite with no failures has no row; the same name on two platforms is one suite. The
 * name is trimmed and cut to the 200 characters `metric_daily.dimension` holds.
 */

import { sql } from "kysely";

import type { DataOrigin } from "../../../db/schema";
import { dayBounds } from "../rollup.days";
import { ratioRow, sumRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One suite name's counts in one repository on the day. */
interface SuiteGroup {
  repo_ref: string;
  origin: DataOrigin;
  suite: string;
  ran: string;
  passed: string;
  failed: string;
}

export const testsExtractor: FamilyExtractor = {
  family: "tests",
  metrics: { test_cases_run: 2, test_pass_rate: 2, test_failures_by_suite: 2 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const { rows } = await sql<SuiteGroup>`
      select ${REPO_REF} as repo_ref, t.origin, btrim(left(btrim(s.name), 200)) as suite,
             sum(s.passed + s.failed + s.flaky) as ran,
             sum(s.passed + s.flaky) as passed,
             sum(s.failed) as failed
        from ouroboros.test_runs t
        join ouroboros.test_suites s on s.test_run_id = t.id
        join ouroboros.runs r on r.id = t.run_id
        ${joinRepo("r")}
       where t.organization_id = ${organizationId} and t.status <> 'running'
         and t.started_at >= ${from} and t.started_at < ${to}
       group by 1, 2, 3`.execute(db);

    const repos = new Map<
      string,
      { repoRef: string; origin: DataOrigin; ran: number; passed: number }
    >();
    const out: RollupRow[] = [];

    for (const group of rows) {
      const { repo_ref: repoRef, origin } = group;
      const key = JSON.stringify([repoRef, origin]);
      const totals = repos.get(key) ?? { repoRef, origin, ran: 0, passed: 0 };

      totals.ran += num(group.ran);
      totals.passed += num(group.passed);
      repos.set(key, totals);

      // A suite's failures are over the cases it ran — its population.
      if (num(group.failed) > 0) {
        out.push(
          sumRow(
            { repoRef, origin, metricId: "test_failures_by_suite", dimension: group.suite },
            num(group.failed),
            num(group.ran),
          ),
        );
      }
    }

    for (const { repoRef, origin, ran, passed } of repos.values()) {
      out.push(sumRow({ repoRef, origin, metricId: "test_cases_run" }, ran, ran));

      if (ran > 0) {
        out.push(ratioRow({ repoRef, origin, metricId: "test_pass_rate" }, passed, ran, 100));
      }
    }

    return out;
  },
};
