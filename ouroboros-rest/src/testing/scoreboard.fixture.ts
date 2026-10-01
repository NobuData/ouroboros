/**
 * The model scoreboard's shared fixture (BJ.3, [#439](https://github.com/NobuData/ouroboros/issues/439)).
 *
 * One description of mockup 15's MODEL SCOREBOARD as loops — task kind, serving model and hop,
 * merges, untouched merges and spend, this window and the prior one — read two ways:
 *
 *   * {@link mockupTallies} turns it into the statement's tallies, for the unit specs;
 *   * {@link seedScoreboardLoops} writes it as runs, resolution snapshots, PRs, revisions, commits
 *     and usage, for the integration suite, which asks the real statement and the KPI row.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { addDays } from "../modules/insights/rollup/rollup.days";
import type {
  ScoreboardRow,
  ScoreboardTally,
} from "../modules/insights/scoreboard/scoreboard.types";
import type { ApiHarness } from "./harness.fixture";
import { insertLoopPr } from "./metrics.fixture";

/** One window of a row: how many merged, how many untouched, and priced cents per merge. */
export interface FixtureWindow {
  readonly merged: number;
  readonly untouched: number;
  /** Cents spent per merge, or null to record that row's usage unpriced. */
  readonly centsPerMerge: number | null;
}

/** One scoreboard row, as loops. */
export interface FixtureRow {
  readonly taskKind: string;
  readonly model: string;
  /** The serving hop's place in the chain: 1 is the primary. */
  readonly hop: number;
  readonly current: FixtureWindow;
  readonly prior: FixtureWindow;
}

/** Tokens each merged loop records per task kind — enough to tell rows apart, no more. */
export const TOKENS_PER_LOOP = 1000;

/**
 * Mockup 15's four rows. Each figure is chosen so the mockup's number falls out of the arithmetic:
 *
 * | row                                | untouched      | $ / success      | trend            |
 * | ---------------------------------- | -------------- | ---------------- | ---------------- |
 * | implement × claude-fable-5         | 21/25 = 84%    | 2175¢/25 = $0.87 | 80% → 84% ▲      |
 * | implement (fallback) × gpt-5-codex | 11/18 ≈ 61%    | 1692¢/18 = $0.94 | 70% → 61% ▼      |
 * | docs × ollama/qwen3-coder          | 24/25 = 96%    | 0¢ = $0.00       | 96% → 96% —      |
 * | review × claude-fable-5            | 21/23 ≈ 91%    | 506¢/23 = $0.22  | 85% → 91% ▲      |
 */
export const MOCKUP_15_SCOREBOARD: readonly FixtureRow[] = [
  {
    taskKind: "implement",
    model: "claude-fable-5",
    hop: 1,
    current: { merged: 25, untouched: 21, centsPerMerge: 87 },
    prior: { merged: 20, untouched: 16, centsPerMerge: 90 },
  },
  {
    taskKind: "implement",
    model: "copilot/gpt-5-codex",
    hop: 2,
    current: { merged: 18, untouched: 11, centsPerMerge: 94 },
    prior: { merged: 20, untouched: 14, centsPerMerge: 94 },
  },
  {
    taskKind: "docs",
    model: "ollama/qwen3-coder",
    hop: 1,
    current: { merged: 25, untouched: 24, centsPerMerge: 0 },
    prior: { merged: 25, untouched: 24, centsPerMerge: 0 },
  },
  {
    taskKind: "review",
    model: "claude-fable-5",
    hop: 1,
    current: { merged: 23, untouched: 21, centsPerMerge: 22 },
    prior: { merged: 20, untouched: 17, centsPerMerge: 22 },
  },
];

/** The mockup's rows as the API renders them: rounded %, dollars, arrow. */
export const MOCKUP_15_RENDERED = [
  ["implement", "claude-fable-5", "primary", "84%", "$0.87", "▲"],
  ["implement", "copilot/gpt-5-codex", "fallback", "61%", "$0.94", "▼"],
  ["docs", "ollama/qwen3-coder", "primary", "96%", "$0.00", "—"],
  ["review", "claude-fable-5", "primary", "91%", "$0.22", "▲"],
] as const;

/**
 * A row as mockup 15 prints it — the check that the payload carries what the card needs.
 *
 * @param row - The row.
 * @returns Task, model, role, rounded %, `$ / success` (or tokens), arrow.
 */
export function renderScoreboardRow(row: ScoreboardRow): string[] {
  const pct = row.untouchedRate === null ? "—" : `${String(Math.round(row.untouchedRate))}%`;
  const cost =
    row.cost.pricing === "priced" && row.cost.centsPerSuccess !== null
      ? `$${(row.cost.centsPerSuccess / 100).toFixed(2)}`
      : row.cost.pricing === "unpriced" && row.cost.tokensPerSuccess !== null
        ? `${String(row.cost.tokensPerSuccess)} tok`
        : "—";
  const arrow = { up: "▲", down: "▼", flat: "—" }[row.trend.direction];

  return [row.taskKind, row.model, row.role, pct, cost, arrow];
}

/**
 * A row the low-sample badge must fire on: three merges, all untouched — 100% that means nothing.
 */
export const SPARSE_ROW: FixtureRow = {
  taskKind: "commit-msg",
  model: "claude-haiku-4-5",
  hop: 1,
  current: { merged: 3, untouched: 3, centsPerMerge: 1 },
  prior: { merged: 0, untouched: 0, centsPerMerge: null },
};

/** A row whose usage no price covered: the `$ / success` column must show tokens. */
export const UNPRICED_ROW: FixtureRow = {
  taskKind: "triage",
  model: "byo/local-llama",
  hop: 1,
  current: { merged: 12, untouched: 9, centsPerMerge: null },
  prior: { merged: 0, untouched: 0, centsPerMerge: null },
};

/**
 * One window of a fixture row as the statement would tally it.
 *
 * @param row - The row.
 * @param window - Which window.
 * @returns The tally, or undefined when the row had nothing in that window.
 */
function tallyOf(row: FixtureRow, window: "current" | "prior"): ScoreboardTally | undefined {
  const figures = row[window];

  if (figures.merged === 0) {
    return undefined;
  }

  const tokens = figures.merged * TOKENS_PER_LOOP;

  return {
    taskKind: row.taskKind,
    model: row.model,
    hop: row.hop,
    merged: figures.merged,
    untouched: figures.untouched,
    tokens,
    unpricedTokens: figures.centsPerMerge === null ? tokens : 0,
    costCents: figures.centsPerMerge === null ? null : figures.centsPerMerge * figures.merged,
  };
}

/**
 * Fixture rows as the statement's tallies.
 *
 * @param rows - The rows.
 * @param window - Which window.
 * @returns One tally per row with a merge in that window.
 */
export function mockupTallies(
  rows: readonly FixtureRow[],
  window: "current" | "prior",
): ScoreboardTally[] {
  return rows.flatMap((row) => tallyOf(row, window) ?? []);
}

/** Where to write the loops. */
export interface ScoreboardSeedTarget {
  readonly organizationId: string;
  readonly repoId: string;
  /** Today's UTC day; the current window's merges land the day before, the prior's `days` earlier. */
  readonly today: string;
  /** The window length the prior merges are placed outside of. */
  readonly days: number;
  /** The first issue and PR number to use; each loop takes the next. */
  readonly firstNumber: number;
}

/**
 * A resolution chain in V024's shape: dropped hops before the serving one, which was tried.
 *
 * @param model - The serving hop's model.
 * @param hop - Its 1-based index.
 * @returns The chain document.
 */
function chainServedBy(model: string, hop: number): object[] {
  const provider = { kind: "anthropic", display_name: "Anthropic", status: "active" };

  return Array.from({ length: hop }, (_unused, at) => {
    const index = at + 1;
    const serving = index === hop;

    return {
      index,
      position: index,
      alias: serving ? "serving-alias" : `failed-alias-${String(index)}`,
      model_id: serving ? model : `failed-model-${String(index)}`,
      provider,
      decision: "kept",
      code: "provider_healthy",
      explanation: "The provider was healthy.",
      duration_ms: 40 + index,
    };
  });
}

/**
 * One loop: a run, its resolution for the row's task kind, a merged PR, its revisions and commits,
 * and its usage on the task kind.
 *
 * @param api - The started harness.
 * @param target - Where.
 * @param row - The row the loop serves.
 * @param spec - Its number, merge instant, whether a human pushed, and its usage's cents.
 */
export async function seedScoreboardLoop(
  api: ApiHarness,
  target: Pick<ScoreboardSeedTarget, "organizationId" | "repoId">,
  row: Pick<FixtureRow, "taskKind" | "model" | "hop">,
  spec: { number: number; mergedAt: string; humanPush: boolean; cents: number | null },
): Promise<string> {
  const { rows: runs } = await api.sql.query<{ id: string }>(
    `insert into ouroboros.runs
       (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model, status,
        stage_label, stage_index, stage_total, started_at, finished_at, pr_number)
     values ($1, $2, $3, 'Loop', 'standard-fix', $4, 'merged', 'Merged', 6, 6,
             $5::timestamptz - interval '1 hour', $5, $3)
     returning id`,
    [target.organizationId, target.repoId, spec.number, row.model, spec.mergedAt],
  );
  const runId = runs[0].id;

  await api.sql.query(
    `insert into ouroboros.resolution_snapshots
       (organization_id, run_id, task_kind, route_tag, outcome, duration_ms, chain, resolved_at)
     values ($1, $2, $3, $3 || '-route', 'resolved', 12, $4::jsonb,
             $5::timestamptz - interval '1 hour')`,
    [
      target.organizationId,
      runId,
      row.taskKind,
      JSON.stringify(chainServedBy(row.model, row.hop)),
      spec.mergedAt,
    ],
  );

  const loopSha = `a${String(spec.number).padStart(39, "0")}`;

  await api.sql.query(
    `insert into ouroboros.run_commits (run_id, sha, message, seq, committed_at)
     values ($1, $2, 'loop commit', 1, $3::timestamptz - interval '30 minutes')`,
    [runId, loopSha, spec.mergedAt],
  );

  await insertLoopPr(api, target.organizationId, runId, {
    number: spec.number,
    state: "merged",
    mergedAt: spec.mergedAt,
  });

  const revisions = spec.humanPush
    ? [loopSha, `b${String(spec.number).padStart(39, "0")}`]
    : [loopSha];

  for (const [index, sha] of revisions.entries()) {
    await api.sql.query(
      `insert into ouroboros.pr_revisions (pr_id, revision_seq, head_sha, pushed_at)
       select id, $2, $3, $4::timestamptz - interval '20 minutes'
         from ouroboros.pull_requests where run_id = $1`,
      [runId, index + 1, sha, spec.mergedAt],
    );
  }

  await api.sql.query(
    `insert into ouroboros.token_usage
       (organization_id, run_id, provider, model, tokens_in, tokens_out, cost_cents, occurred_at,
        task_kind)
     values ($1, $2, 'anthropic', $3, $4, 0, $5, $6::timestamptz - interval '40 minutes', $7)`,
    [
      target.organizationId,
      runId,
      row.model,
      TOKENS_PER_LOOP,
      spec.cents,
      spec.mergedAt,
      row.taskKind,
    ],
  );

  return runId;
}

/**
 * Write fixture rows as loops: each window's merges, `merged − untouched` of them with a human push
 * after the loop's last revision. Current-window merges land yesterday at noon UTC; prior-window
 * merges `days` days before that.
 *
 * @param api - The started harness.
 * @param target - Where.
 * @param rows - The rows.
 * @returns How many loops were written.
 */
export async function seedScoreboardLoops(
  api: ApiHarness,
  target: ScoreboardSeedTarget,
  rows: readonly FixtureRow[],
): Promise<number> {
  const yesterday = addDays(target.today, -1);
  const windows = [
    ["current", `${yesterday}T12:00:00.000Z`],
    ["prior", `${addDays(yesterday, -target.days)}T12:00:00.000Z`],
  ] as const;
  let number = target.firstNumber;

  for (const row of rows) {
    for (const [window, mergedAt] of windows) {
      const figures = row[window];

      for (let at = 0; at < figures.merged; at += 1) {
        await seedScoreboardLoop(api, target, row, {
          number,
          mergedAt,
          humanPush: at >= figures.untouched,
          cents: figures.centsPerMerge,
        });
        number += 1;
      }
    }
  }

  return number - target.firstNumber;
}
