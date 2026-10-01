/**
 * Every statement the flake scorer issues (AT.3, [#331](https://github.com/NobuData/ouroboros/issues/331))
 * — scoring cases, the nightly job's bookkeeping, and the reads behind the state API.
 *
 * ## The formula is the database's, never this file's
 *
 * Flake score v1 — the latest 20 non-skipped occurrences newest first, weight `0.9^i`, signal 1
 * for a sanctioned pass on retry, `score = round(Σ w·f / Σ w, 4)`, `watching` at ≥ 0.25, `healthy`
 * below 0.10, unchanged between or under three observations — is written, versioned and computed
 * in V054 (`ouroboros.flake_score()` and `ouroboros.flake_state_next()`). Every statement here calls
 * those two functions rather than re-deriving them, so the same occurrences always yield the same
 * number and state, whichever caller asked. A re-tuning is a new `flake_score_formulas` row; the
 * scorer always applies the **latest** version and stamps it on every row it writes.
 *
 * ## One statement scores a whole set
 *
 * {@link scoreStatement} takes the keys to score as a sub-select, reads each key's prior state,
 * computes the score and next state, writes `flake_scores`, and counts the state changes — all in
 * one statement, so a parse of a thousand cases is one round trip. `state_changed_at` is set by
 * V054's `flake_scores_state_transition` trigger when, and only when, the state actually moves.
 *
 * It is an update of the keys already scored beside an insert of the new ones, **not** an
 * `insert … on conflict do update`: an upsert runs the insert triggers on the proposed row first,
 * and for a quarantined case that row carries `quarantined` — which V054 refuses as a *starting*
 * state — so one quarantined case would fail every pass over its workspace. A key another writer
 * inserts between the read and the insert is left to that writer (`on conflict do nothing`) and
 * scored next time.
 *
 * ## Nothing here writes `quarantined`
 *
 * The state written is always `flake_state_next()`'s, which keeps a quarantined case quarantined
 * and never moves any other case there. Activation is AV.3's
 * ([#345](https://github.com/NobuData/ouroboros/issues/345)); `flakes.quarantine.spec.ts` holds
 * this module to it.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { FlakeScorerRunStatus, FlakeState } from "../db/schema";

/** What one scoring statement did. */
export interface ScoringTotals {
  /** How many cases were scored — each has a `flake_scores` row stamped with the formula now. */
  readonly scored: number;
  /** How many of them changed state; a new case entering `healthy` is not a change. */
  readonly stateChanges: number;
}

/** A case worth distrusting — one entry of the candidates list (the insights payload). */
export interface FlakeCandidateRow {
  readonly caseKey: string;
  readonly githubRepoId: string;
  /** The repository's name. */
  readonly repository: string;
  /** The case's name, classname and suite as its latest occurrence recorded them. */
  readonly name: string | null;
  readonly classname: string | null;
  readonly suite: string | null;
  /** In [0, 1], four decimals. */
  readonly score: number;
  readonly windowRuns: number;
  readonly state: FlakeState;
  readonly formulaVersion: number;
  readonly lastScoredAt: Date;
  readonly stateChangedAt: Date;
}

/** A day of one case's occurrences. */
export interface FlakeCardDay {
  /** The UTC day, `YYYY-MM-DD`. */
  readonly day: string;
  /** Non-skipped occurrences that day. */
  readonly observed: number;
  /** How many of them were sanctioned passes on retry. */
  readonly flaky: number;
}

/** The loop behind the occurrence that showed a case had stopped flaking. */
export interface FlakeResolution {
  readonly runId: string;
  readonly issueNumber: number;
}

/**
 * One case of the Insights flaky card (BJ.2, [#438](https://github.com/NobuData/ouroboros/issues/438)):
 * a case that is not healthy, or one that came back to healthy inside the window.
 */
export interface FlakeCardRow {
  readonly caseKey: string;
  readonly githubRepoId: string;
  /** The repository's name. */
  readonly repository: string;
  /** The case's name, classname and suite as its latest occurrence recorded them. */
  readonly name: string | null;
  readonly classname: string | null;
  readonly suite: string | null;
  readonly state: FlakeState;
  /** In [0, 1], four decimals. */
  readonly score: number;
  readonly windowRuns: number;
  readonly stateChangedAt: Date;
  /** Whether the state ever changed — a healthy row that never did was never flaky. */
  readonly stateEverChanged: boolean;
  /** The window's occurrences per UTC day, oldest first; days with none are absent. */
  readonly history: readonly FlakeCardDay[];
  /** Every platform a flaky occurrence in the window ran on. */
  readonly flakyPlatforms: readonly string[];
  /** The first clean pass after the case's last flaky occurrence, when its loop is known. */
  readonly resolvedBy: FlakeResolution | null;
}

/** The instants a card's window covers: `[from, to)`. */
export interface FlakeCardSpan {
  readonly from: Date;
  readonly to: Date;
}

/** One case's flake state, as the state API returns it. */
export interface CaseFlakeRow {
  readonly caseKey: string;
  readonly githubRepoId: string;
  /** Every non-skipped occurrence of the case in the workspace. */
  readonly observed: number;
  /** How many of them were sanctioned passes on retry. */
  readonly passOnRetry: number;
  /** Absent when the case has never been scored. */
  readonly score?: {
    readonly score: number;
    readonly windowRuns: number;
    readonly state: FlakeState;
    readonly formulaVersion: number;
    readonly lastScoredAt: Date;
    readonly stateChangedAt: Date;
  };
}

/** One nightly pass over one workspace, as `flake_scorer_runs` holds it. */
export interface ScorerRunRow {
  readonly id: string;
  readonly formulaVersion: number;
  readonly status: FlakeScorerRunStatus;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly durationMs: number | null;
  readonly casesScored: number;
  readonly stateChanges: number;
  readonly error: string | null;
}

/** How many scored cases of a workspace are in each non-healthy state. */
export interface StateCounts {
  readonly watching: number;
  readonly quarantined: number;
}

/** The statements the scorer and the state API need — what their unit suites stand in for. */
export interface FlakesStore {
  /**
   * The latest published formula version.
   *
   * @returns It — V054 ships version 1, so there is always one.
   */
  currentFormula(): Promise<number>;
  /**
   * Score the cases one attempt touched: each that passed on a sanctioned retry in it, and each
   * that already has a score (so a case that stops flaking is re-scored by the build that shows it).
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt, whose occurrences are written.
   * @param formulaVersion - The formula to apply.
   * @returns What was scored.
   */
  scoreAttempt(
    organizationId: string,
    testRunId: string,
    formulaVersion: number,
  ): Promise<ScoringTotals>;
  /**
   * Re-score a workspace's active cases — every score that is not `healthy`, not zero, or not of
   * `formulaVersion` — least recently scored first, at most `cap` of them.
   *
   * @param organizationId - The workspace.
   * @param formulaVersion - The formula to apply.
   * @param cap - The most cases to score. What it leaves is the least recently scored next time.
   * @returns What was scored.
   */
  rescoreActive(
    organizationId: string,
    formulaVersion: number,
    cap: number,
  ): Promise<ScoringTotals>;
  /**
   * Every workspace with an active case, in a stable order.
   *
   * @param formulaVersion - The formula a score must be of to be settled.
   * @returns The workspace ids.
   */
  workspacesToRescore(formulaVersion: number): Promise<string[]>;
  /**
   * Open a `running` bookkeeping row.
   *
   * @param organizationId - The workspace.
   * @param formulaVersion - The formula the pass applies.
   * @returns The row's id.
   */
  startRun(organizationId: string, formulaVersion: number): Promise<string>;
  /**
   * Close a run as `complete`.
   *
   * @param runId - The row.
   * @param totals - What it scored.
   * @returns When it is written.
   */
  finishRun(runId: string, totals: ScoringTotals): Promise<void>;
  /**
   * Close a run as `error`.
   *
   * @param runId - The row.
   * @param error - Why — never blank.
   * @returns When it is written.
   */
  failRun(runId: string, error: string): Promise<void>;
  /**
   * The workspace's cases worth distrusting — every non-healthy score, highest first.
   *
   * @param organizationId - The workspace.
   * @param limit - The most to return.
   * @returns The candidates.
   */
  candidates(organizationId: string, limit: number): Promise<FlakeCandidateRow[]>;
  /**
   * The cases the Insights flaky card draws for a window (#438): every case that is not healthy,
   * and every case that returned to healthy inside the window, each with its occurrences per day.
   *
   * @param organizationId - The workspace.
   * @param span - The window, `[from, to)`.
   * @param repo - One repository's `owner/name`, lower-case, or undefined for the workspace.
   * @returns The cases, highest score first.
   */
  card(organizationId: string, span: FlakeCardSpan, repo?: string): Promise<FlakeCardRow[]>;
  /**
   * How many of the workspace's scored cases are watching and quarantined.
   *
   * @param organizationId - The workspace.
   * @returns The counts.
   */
  stateCounts(organizationId: string): Promise<StateCounts>;
  /**
   * The workspace's latest nightly pass.
   *
   * @param organizationId - The workspace.
   * @returns It, or undefined when none has run.
   */
  lastRun(organizationId: string): Promise<ScorerRunRow | undefined>;
  /**
   * One case's history counts and score.
   *
   * @param organizationId - The workspace.
   * @param caseKey - The durable key.
   * @returns It, or undefined when the workspace has never observed the case.
   */
  caseState(organizationId: string, caseKey: string): Promise<CaseFlakeRow | undefined>;
}

/** The PostgreSQL {@link FlakesStore}. */
@Injectable()
export class FlakesRepository implements FlakesStore {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async currentFormula(): Promise<number> {
    const row = await this.database.db
      .selectFrom("flake_score_formulas")
      .select((eb) => eb.fn.max("version").as("version"))
      .executeTakeFirstOrThrow();

    // V054 ships version 1, so an empty table is a database somebody emptied — not a formula to
    // default. Scoring against a guessed version would stamp rows with a formula nobody published.
    if (row.version === null) {
      throw new Error("ouroboros.flake_score_formulas is empty; V054 ships flake score formula 1.");
    }

    return Number(row.version);
  }

  /** @inheritdoc */
  scoreAttempt(
    organizationId: string,
    testRunId: string,
    formulaVersion: number,
  ): Promise<ScoringTotals> {
    return this.score(
      organizationId,
      formulaVersion,
      sql`select distinct h.case_key, h.github_repo_id
            from ouroboros.test_case_history h
           where h.organization_id = ${organizationId}
             and h.test_run_id = ${testRunId}::uuid
             and (h.pass_on_retry
                  or exists (select 1 from ouroboros.flake_scores s
                              where s.organization_id = h.organization_id
                                and s.case_key = h.case_key))`,
    );
  }

  /** @inheritdoc */
  rescoreActive(
    organizationId: string,
    formulaVersion: number,
    cap: number,
  ): Promise<ScoringTotals> {
    return this.score(
      organizationId,
      formulaVersion,
      sql`select s.case_key, s.github_repo_id
            from ouroboros.flake_scores s
           where s.organization_id = ${organizationId}
             and ${activePredicate(formulaVersion)}
           order by s.last_scored_at, s.case_key
           limit ${cap}`,
    );
  }

  /** @inheritdoc */
  async workspacesToRescore(formulaVersion: number): Promise<string[]> {
    const { rows } = await sql<{ organization_id: string }>`
      select distinct s.organization_id
        from ouroboros.flake_scores s
       where ${activePredicate(formulaVersion)}
       order by s.organization_id`.execute(this.database.db);

    return rows.map((row) => row.organization_id);
  }

  /** @inheritdoc */
  async startRun(organizationId: string, formulaVersion: number): Promise<string> {
    const row = await this.database.db
      .insertInto("flake_scorer_runs")
      .values({ organization_id: organizationId, formula_version: formulaVersion })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /** @inheritdoc */
  async finishRun(runId: string, totals: ScoringTotals): Promise<void> {
    await this.database.db
      .updateTable("flake_scorer_runs")
      .set({
        status: "complete",
        finished_at: sql<Date>`greatest(now(), started_at)`,
        cases_scored: totals.scored,
        state_changes: totals.stateChanges,
      })
      .where("id", "=", runId)
      .execute();
  }

  /** @inheritdoc */
  async failRun(runId: string, error: string): Promise<void> {
    await this.database.db
      .updateTable("flake_scorer_runs")
      .set({ status: "error", finished_at: sql<Date>`greatest(now(), started_at)`, error })
      .where("id", "=", runId)
      .execute();
  }

  /** @inheritdoc */
  async candidates(organizationId: string, limit: number): Promise<FlakeCandidateRow[]> {
    const { rows } = await sql<{
      case_key: string;
      github_repo_id: string;
      repository: string;
      name: string | null;
      classname: string | null;
      suite: string | null;
      score: string;
      window_runs: number;
      state: FlakeState;
      formula_version: number;
      last_scored_at: Date;
      state_changed_at: Date;
    }>`
      select s.case_key, s.github_repo_id, r.name as repository,
             c.name, c.classname, su.name as suite,
             s.score::text as score, s.window_runs, s.state, s.formula_version,
             s.last_scored_at, s.state_changed_at
        from ouroboros.flake_scores s
        join ouroboros.github_repos r on r.id = s.github_repo_id
        left join lateral (
          select h.test_case_id
            from ouroboros.test_case_history h
           where h.organization_id = s.organization_id
             and h.case_key = s.case_key
           order by h.observed_at desc, h.test_case_id
           limit 1
        ) latest on true
        left join ouroboros.test_cases c   on c.id = latest.test_case_id
        left join ouroboros.test_suites su on su.id = c.test_suite_id
       where s.organization_id = ${organizationId}
         and s.state <> 'healthy'
       order by s.score desc, s.case_key
       limit ${limit}`.execute(this.database.db);

    return rows.map((row) => ({
      caseKey: row.case_key,
      githubRepoId: row.github_repo_id,
      repository: row.repository,
      name: row.name,
      classname: row.classname,
      suite: row.suite,
      score: Number(row.score),
      windowRuns: row.window_runs,
      state: row.state,
      formulaVersion: row.formula_version,
      lastScoredAt: row.last_scored_at,
      stateChangedAt: row.state_changed_at,
    }));
  }

  /** @inheritdoc */
  async card(organizationId: string, span: FlakeCardSpan, repo?: string): Promise<FlakeCardRow[]> {
    const { rows } = await sql<{
      case_key: string;
      github_repo_id: string;
      repository: string;
      name: string | null;
      classname: string | null;
      suite: string | null;
      state: FlakeState;
      score: string;
      window_runs: number;
      state_changed_at: Date;
      state_ever_changed: boolean;
      history: { day: string; observed: number; flaky: number }[];
      flaky_platforms: string[];
      resolved_run_id: string | null;
      resolved_issue_number: number | null;
    }>`
      select s.case_key, s.github_repo_id, r.name as repository,
             c.name, c.classname, su.name as suite,
             s.state, s.score::text as score, s.window_runs, s.state_changed_at,
             s.state_changed_at > s.created_at as state_ever_changed,
             coalesce(days.history, '[]'::jsonb) as history,
             coalesce(rigs.flaky_platforms, '{}') as flaky_platforms,
             fix.run_id as resolved_run_id, fix.issue_number as resolved_issue_number
        from ouroboros.flake_scores s
        join ouroboros.github_repos r on r.id = s.github_repo_id
        join ouroboros.github_orgs gh on gh.id = r.org_id
        left join lateral (
          select h.test_case_id
            from ouroboros.test_case_history h
           where h.organization_id = s.organization_id
             and h.case_key = s.case_key
           order by h.observed_at desc, h.test_case_id
           limit 1
        ) latest on true
        left join ouroboros.test_cases c   on c.id = latest.test_case_id
        left join ouroboros.test_suites su on su.id = c.test_suite_id
        left join lateral (
          select jsonb_agg(jsonb_build_object('day', d.day, 'observed', d.observed,
                                              'flaky', d.flaky) order by d.day) as history
            from (select to_char(h.observed_at at time zone 'UTC', 'YYYY-MM-DD') as day,
                         count(*) filter (where h.status <> 'skipped')::int as observed,
                         count(*) filter (where h.pass_on_retry)::int as flaky
                    from ouroboros.test_case_history h
                   where h.organization_id = s.organization_id
                     and h.case_key = s.case_key
                     and h.observed_at >= ${span.from} and h.observed_at < ${span.to}
                   group by 1) d
        ) days on true
        left join lateral (
          select array_agg(distinct hs.platform order by hs.platform) as flaky_platforms
            from ouroboros.test_case_history h
            join ouroboros.test_cases hc  on hc.id = h.test_case_id
            join ouroboros.test_suites hs on hs.id = hc.test_suite_id
           where h.organization_id = s.organization_id
             and h.case_key = s.case_key
             and h.pass_on_retry
             and h.observed_at >= ${span.from} and h.observed_at < ${span.to}
        ) rigs on true
        left join lateral (
          select tr.run_id, rn.issue_number
            from ouroboros.test_case_history h
            join ouroboros.test_runs tr
              on tr.id = h.test_run_id and tr.organization_id = h.organization_id
            join ouroboros.runs rn
              on rn.id = tr.run_id and rn.organization_id = h.organization_id
           where h.organization_id = s.organization_id
             and h.case_key = s.case_key
             and h.status = 'passed'
             and h.observed_at > (select max(f.observed_at)
                                    from ouroboros.test_case_history f
                                   where f.organization_id = s.organization_id
                                     and f.case_key = s.case_key
                                     and f.pass_on_retry)
           order by h.observed_at, h.test_case_id
           limit 1
        ) fix on s.state = 'healthy'
       where s.organization_id = ${organizationId}
         and (${repo ?? null}::text is null or lower(gh.login || '/' || r.name) = ${repo ?? null})
         and (s.state <> 'healthy'
              or (s.state_changed_at > s.created_at
                  and s.state_changed_at >= ${span.from} and s.state_changed_at < ${span.to}))
       order by s.score desc, s.case_key`.execute(this.database.db);

    return rows.map((row) => ({
      caseKey: row.case_key,
      githubRepoId: row.github_repo_id,
      repository: row.repository,
      name: row.name,
      classname: row.classname,
      suite: row.suite,
      state: row.state,
      score: Number(row.score),
      windowRuns: row.window_runs,
      stateChangedAt: row.state_changed_at,
      stateEverChanged: row.state_ever_changed,
      history: row.history,
      flakyPlatforms: row.flaky_platforms,
      resolvedBy:
        row.resolved_run_id === null || row.resolved_issue_number === null
          ? null
          : { runId: row.resolved_run_id, issueNumber: row.resolved_issue_number },
    }));
  }

  /** @inheritdoc */
  async stateCounts(organizationId: string): Promise<StateCounts> {
    const row = await this.database.db
      .selectFrom("flake_scores")
      .select((eb) => [
        eb.fn.countAll<string>().filterWhere("state", "=", "watching").as("watching"),
        eb.fn.countAll<string>().filterWhere("state", "=", "quarantined").as("quarantined"),
      ])
      .where("organization_id", "=", organizationId)
      .where("state", "<>", "healthy")
      .executeTakeFirstOrThrow();

    return { watching: Number(row.watching), quarantined: Number(row.quarantined) };
  }

  /** @inheritdoc */
  async lastRun(organizationId: string): Promise<ScorerRunRow | undefined> {
    const row = await this.database.db
      .selectFrom("flake_scorer_runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .orderBy("started_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          formulaVersion: row.formula_version,
          status: row.status,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
          casesScored: row.cases_scored,
          stateChanges: row.state_changes,
          error: row.error,
        };
  }

  /** @inheritdoc */
  async caseState(organizationId: string, caseKey: string): Promise<CaseFlakeRow | undefined> {
    const [history, score] = await Promise.all([
      this.database.db
        .selectFrom("test_case_history")
        .select((eb) => [
          // A key hashes its repository (decision T2), so every occurrence names the same one.
          sql<string | null>`(array_agg(github_repo_id))[1]`.as("github_repo_id"),
          eb.fn.countAll<string>().filterWhere("status", "<>", "skipped").as("observed"),
          eb.fn.countAll<string>().filterWhere("pass_on_retry", "=", true).as("pass_on_retry"),
          eb.fn.countAll<string>().as("occurrences"),
        ])
        .where("organization_id", "=", organizationId)
        .where("case_key", "=", caseKey)
        .executeTakeFirstOrThrow(),
      this.database.db
        .selectFrom("flake_scores")
        .select([
          "score",
          "window_runs",
          "state",
          "formula_version",
          "last_scored_at",
          "state_changed_at",
        ])
        .where("organization_id", "=", organizationId)
        .where("case_key", "=", caseKey)
        .executeTakeFirst(),
    ]);

    if (Number(history.occurrences) === 0 || history.github_repo_id === null) {
      return undefined;
    }

    return {
      caseKey,
      githubRepoId: history.github_repo_id,
      observed: Number(history.observed),
      passOnRetry: Number(history.pass_on_retry),
      ...(score === undefined
        ? {}
        : {
            score: {
              score: Number(score.score),
              windowRuns: score.window_runs,
              state: score.state,
              formulaVersion: score.formula_version,
              lastScoredAt: score.last_scored_at,
              stateChangedAt: score.state_changed_at,
            },
          }),
    };
  }

  /**
   * Run {@link scoreStatement} for a set of keys.
   *
   * @param organizationId - The workspace.
   * @param formulaVersion - The formula.
   * @param keys - A select of `(case_key, github_repo_id)`, one row per key.
   * @returns What was scored.
   */
  private async score(
    organizationId: string,
    formulaVersion: number,
    keys: RawBuilder<unknown>,
  ): Promise<ScoringTotals> {
    const { rows } = await scoreStatement(organizationId, formulaVersion, keys).execute(
      this.database.db,
    );
    const [row] = rows;

    return { scored: row?.scored ?? 0, stateChanges: row?.state_changes ?? 0 };
  }
}

/**
 * A score that is not settled: worth watching, not zero, or computed by an older formula.
 *
 * A `healthy` case scoring 0 under the current formula has nothing a re-score could change until
 * a new build writes an occurrence — and that build re-scores it itself ({@link FlakesStore.scoreAttempt}).
 *
 * @param formulaVersion - The current formula.
 * @returns The predicate over `flake_scores s`.
 */
function activePredicate(formulaVersion: number): RawBuilder<boolean> {
  return sql<boolean>`(s.state <> 'healthy' or s.score > 0 or s.formula_version <> ${formulaVersion})`;
}

/**
 * Score a set of keys and upsert their rows — see this file's header.
 *
 * @param organizationId - The workspace.
 * @param formulaVersion - The formula, stamped on every row.
 * @param keys - A select of `(case_key, github_repo_id)`, at most one row per key.
 * @returns The statement; its one row counts the cases scored and the state changes.
 */
export function scoreStatement(
  organizationId: string,
  formulaVersion: number,
  keys: RawBuilder<unknown>,
): RawBuilder<{ scored: number; state_changes: number }> {
  return sql<{ scored: number; state_changes: number }>`
    with keys as (${keys}),
    prior as (
      select s.case_key, s.state
        from ouroboros.flake_scores s
       where s.organization_id = ${organizationId}
         and s.case_key in (select case_key from keys)
    ),
    scored as (
      select k.case_key, k.github_repo_id, f.score, f.window_runs, p.state as prior_state,
             ouroboros.flake_state_next(${formulaVersion}::int, p.state, f.score, f.window_runs)
               as state
        from keys k
        left join prior p on p.case_key = k.case_key
        cross join lateral ouroboros.flake_score(${organizationId}, k.case_key,
                                                 ${formulaVersion}::int) f
    ),
    updated as (
      update ouroboros.flake_scores t
         set score           = s.score,
             window_runs     = s.window_runs,
             formula_version = ${formulaVersion}::int,
             state           = s.state,
             last_scored_at  = now()
        from scored s
       where t.organization_id = ${organizationId}
         and t.case_key = s.case_key
         and s.prior_state is not null
      returning t.case_key, t.state
    ),
    inserted as (
      insert into ouroboros.flake_scores
          (organization_id, github_repo_id, case_key, score, window_runs, formula_version, state,
           last_scored_at)
      select ${organizationId}, github_repo_id, case_key, score, window_runs,
             ${formulaVersion}::int, state, now()
        from scored
       where prior_state is null
      on conflict (organization_id, case_key) do nothing
      returning case_key, state
    ),
    written as (
      select case_key, state from updated
      union all
      select case_key, state from inserted
    )
    select count(*)::int as scored,
           (count(*) filter (where coalesce(s.prior_state, 'healthy') <> w.state))::int
             as state_changes
      from written w
      join scored s on s.case_key = w.case_key`;
}
