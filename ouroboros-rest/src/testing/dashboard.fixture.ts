/**
 * The population every Epic G suite reads — mockup 02, as rows.
 *
 * The third piece of [#37](https://github.com/NobuData/ouroboros/issues/37)'s harness, added
 * by [#76](https://github.com/NobuData/ouroboros/issues/76). `postgres.fixture.ts` produces a
 * migrated database and `harness.fixture.ts` produces an application listening on it; this
 * produces *something to read*, and it is here rather than in a spec because five suites need
 * the same rows and four of them had already written the same twenty lines.
 *
 * ## What it builds, and why it is built rather than copied
 *
 * The development seed (#68) is deliberately **not** applied to the integration database —
 * `flyway.toml` leaves the dev-seed placeholder false, and {@link ApiHarness.truncate} would
 * take it with everything else between tests. So {@link seedMockup} reproduces the seed's
 * *arithmetic* with the same construction and the same filler titles: fifty-three runs where
 * the cards draw seven, twelve queue items summing to 580 minutes, twelve usage events
 * summing to 4.2M tokens and $18.60, and one settings row. Where a number here disagrees with
 * the mockup, one of the two is wrong, and that is the point.
 *
 * ## {@link MOCKUP_02} states the arithmetic; it does not replace an assertion
 *
 * The figures below are what this fixture's SQL is *supposed* to produce, written beside the
 * statements that produce them so a reader can check the two against each other. Suites whose
 * subject is somewhere else — cross-endpoint agreement, isolation, the ETag cycle — read them
 * from here rather than restating twelve numbers each.
 *
 * `dashboard.integration-spec.ts` deliberately does **not**: it spells every figure out as a
 * literal, because it is the suite whose subject *is* the arithmetic. That restatement is the
 * oracle for this constant. If a careless edit moved a row and this object was updated to
 * match, that suite is what goes red — which is exactly the failure a shared constant would
 * otherwise absorb in silence.
 *
 * ```ts
 * const owner = await api.signIn();
 * const workspace = await workspaceWithRepo(api, owner);
 * await seedMockup(api, workspace, owner.id);
 * ```
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { ApiHarness, Person } from "./harness.fixture";

/**
 * A workspace with somewhere for its runs, queue items and spend to have happened.
 *
 * Wider than the harness's own `Workspace` by exactly one field, and that field is why this
 * type exists: `runs.github_repo_id` and `queue_items.github_repo_id` are both `not null` and
 * both held to the workspace by a trigger, so *every* fixture on these tables needs a
 * repository id to hand and none of them can invent one.
 */
export interface SeededWorkspace {
  /** `organization."id"` — the workspace the tenant guard resolves to. */
  readonly id: string;
  /** Its handle, which is what `X-Ouro-Tenant` carries. */
  readonly slug: string;
  /** A repository inside it, for the rows that must name one. */
  readonly repoId: string;
}

/** The repository mockup 02 is drawn against — every seeded row hangs off it. */
export const PRIMARY_REPO = "helios-firmware";

/** A second repository, for the suites whose subject is the `?repo=` filter. */
export const SECOND_REPO = "atlas-control";

/**
 * What {@link seedMockup} is supposed to produce, read the way the API answers it.
 *
 * Every figure here is derived from the statements below and from mockup 02 — see this file's
 * header on why it is a shared constant and on what still asserts it independently.
 */
export const MOCKUP_02 = {
  /** How many `runs` rows the seed writes, and how they split. */
  runs: {
    /** Three live, four the completions card draws, twenty-five more this week, twenty-one last. */
    total: 53,
    /** In flight: no `finished_at`, so on the *Active loops* card. */
    active: 3,
    /** Stopped, whatever they stopped as — the *Recently closed* listing's whole population. */
    terminal: 50,
  },
  /** The active card's rows, in the order it draws them: down the pipeline, oldest first. */
  activeIssues: [482, 479, 476],
  /** The four the completions card draws, newest-stopped first. */
  recentIssues: [474, 471, 468, 465],
  /** The five the *Up next in queue* card draws, in queue order. */
  queueHeadIssues: [485, 486, 488, 490, 491],
  /** How many queue items the seed writes — the card draws five of them. */
  queueItems: 12,
  /** The stat row, number for number. */
  stats: {
    loopsLive: { total: 3, byStatus: { coding: 1, building: 1, review: 1 } },
    queued: { count: 12, estMinutes: 580 },
    merged7d: { count: 27, deltaVsPrior: 8 },
    tokensToday: { tokens: 4_200_000, costCents: 1860, providers: 4, unpricedEvents: 3 },
  },
  /**
   * The pulse card.
   *
   * `mergeRate` is exact over the **fourteen** days these rows span — 46 merged of 50 closed —
   * and is deliberately not exact over seven, where 27 of 29 is 93.1%. That window is the
   * endpoint's published choice; see `resources.ts`.
   */
  pulse: { mergeRate: 0.92, avgCycleSeconds: 860, interventions7d: 2, autoMerge: true },
} as const;

/**
 * A workspace, a GitHub organisation inside it, and a repository inside that.
 *
 * All three, because `runs` and `queue_items` both carry a `github_repo_id` held to the
 * workspace by a trigger — a fixture that skipped the middle row would be refused by the
 * database rather than by the suite that called this.
 *
 * @param api - The started harness. Its own connection is what writes these rows, not the
 *   application's: a repository is enabled through the tenancy API, and arranging a fixture
 *   through the API under test makes the arrangement part of what is asserted.
 * @param owner - Who owns it. Becomes its `owner` member, without which every route under the
 *   workspace answers `404` — including theirs.
 * @param repo - The repository's name. Defaults to {@link PRIMARY_REPO}.
 * @returns The workspace, and the repository its rows hang off.
 */
export async function workspaceWithRepo(
  api: ApiHarness,
  owner: Person,
  repo: string = PRIMARY_REPO,
): Promise<SeededWorkspace> {
  const workspace = await api.workspace(owner);

  const { rows: orgs } = await api.sql.query<{ id: string }>(
    `insert into ouroboros.github_orgs (organization_id, login, enabled)
     values ($1, $2, true) returning id`,
    [workspace.id, workspace.slug],
  );
  const { rows: repos } = await api.sql.query<{ id: string }>(
    `insert into ouroboros.github_repos (org_id, name, enabled)
     values ($1, $2, true) returning id`,
    [orgs[0].id, repo],
  );

  return { id: workspace.id, slug: workspace.slug, repoId: repos[0].id };
}

/**
 * A second repository in a workspace that already has one.
 *
 * For the `?repo=` filter cases, which need two repositories under one organization to be
 * able to say the filter narrowed rather than that the scope did.
 *
 * @param api - The started harness.
 * @param workspace - Which workspace to add it to. Its GitHub organisation is found rather
 *   than passed, because {@link workspaceWithRepo} creates exactly one and nothing else does.
 * @param name - The repository's name. Defaults to {@link SECOND_REPO}.
 * @returns The new repository's id.
 */
export async function addRepo(
  api: ApiHarness,
  workspace: SeededWorkspace,
  name: string = SECOND_REPO,
): Promise<string> {
  const { rows: orgs } = await api.sql.query<{ id: string }>(
    `select id from ouroboros.github_orgs where organization_id = $1`,
    [workspace.id],
  );
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ouroboros.github_repos (org_id, name, enabled)
     values ($1, $2, true) returning id`,
    [orgs[0].id, name],
  );

  return rows[0].id;
}

/**
 * Mockup 02, as rows.
 *
 * Six statements, in the order the seed's own file writes them, and each one is a *population*
 * rather than a list: the cards draw seven runs and the stat row counts fifty-three, so the
 * fifty-three have to exist.
 *
 * Every instant is relative to `now()` in the database, so the population sits in the same
 * place in the windows whenever the suite runs — including the token events, which are spread
 * across the part of today that has already happened so that all twelve land inside the
 * current UTC day even at 00:05.
 *
 * @param api - The started harness, whose connection writes the rows.
 * @param workspace - Where to put them, from {@link workspaceWithRepo}.
 * @param ownerId - Who turned the auto-merge switch on, for `workspace_settings.updated_by`.
 * @returns When every row exists.
 */
export async function seedMockup(
  api: ApiHarness,
  workspace: SeededWorkspace,
  ownerId: string,
): Promise<void> {
  const where = [workspace.id, workspace.repoId];

  // The three live loops — one `coding`, one `building`, one `review`, with the elapsed times
  // the mockup prints. No `finished_at`, which is what puts them on the active card.
  await api.sql.query(
    `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                 workflow_tag, model, status, stage_label, stage_index,
                                 stage_total, started_at)
     select $1, $2, seed.issue_number, seed.issue_title, seed.workflow_tag, seed.model,
            seed.status, seed.stage_label, seed.stage_index, seed.stage_total,
            now() - make_interval(secs => seed.elapsed)
       from (values
              (482, 'Fix flaky CAN-bus telemetry test',        'standard-fix',
               'claude-fable-5',     'coding',   'Implementing', 4, 6,  760),
              (479, 'Add OTA rollback on failed checksum',     'feature-loop',
               'claude-sonnet-5',    'building', 'Build farm',   5, 7, 2285),
              (476, 'Bump MQTT client, migrate deprecated API', 'deps-refresh',
               'ollama/qwen3-coder', 'review',   'Self-review',  6, 6,  432)
            ) as seed (issue_number, issue_title, workflow_tag, model, status,
                       stage_label, stage_index, stage_total, elapsed)`,
    where,
  );

  // The four the completions card draws, newest last. `started_at` is `finished_at` less the
  // cycle, so the card's *Cycle* column is the arithmetic of the row's own timestamps.
  await api.sql.query(
    `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                 workflow_tag, model, status, stage_label, stage_index,
                                 stage_total, started_at, finished_at, pr_number,
                                 checks_passed, checks_total)
     select $1, $2, seed.issue_number, seed.issue_title, seed.workflow_tag, seed.model,
            seed.status, seed.stage_label, seed.stage_index, seed.stage_total,
            now() - make_interval(secs => seed.closed_ago + seed.cycle),
            now() - make_interval(secs => seed.closed_ago),
            seed.pr_number, seed.checks_passed, seed.checks_total
       from (values
              (474, 'Debounce e-stop interrupt handler',    'standard-fix',
               'claude-fable-5',      'merged',      'Merged',         6, 6, 512, 14, 14,  660,  2520),
              (471, 'Unit tests for motor PID edge cases',  'standard-fix',
               'copilot/gpt-5-codex', 'merged',      'Merged',         6, 6, 509, 14, 14, 1140,  8100),
              (468, 'i18n strings for pairing screen',      'docs-loop',
               'ollama/qwen3-coder',  'merged',      'Merged',         5, 5, 507, 12, 12,  360, 13800),
              (465, 'Refactor telemetry buffer allocation', 'feature-loop',
               'claude-sonnet-5',     'needs_human', 'Awaiting human', 5, 6, 504, 13, 14, 2520, 19800)
            ) as seed (issue_number, issue_title, workflow_tag, model, status, stage_label,
                       stage_index, stage_total, pr_number, checks_passed, checks_total,
                       cycle, closed_ago)`,
    where,
  );

  // The rest of the trailing seven days: twenty-four more merged and one more that stopped for
  // a human, so *PRs merged · 7d* counts 27 and *Human interventions* counts 2.
  //
  // The cycle spread is the seed's own construction and it is what makes the mean exact:
  // twelve pairs straddling 810s cancel to 24 × 810 = 19 440s, and one row of 820s carries the
  // remainder, so these twenty-five contribute 20 260s. With the 4 680s above, twenty-nine runs
  // closed this week total 24 940s — 860s each, which is 14m 20s.
  await api.sql.query(
    `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                 workflow_tag, model, status, stage_label, stage_index,
                                 stage_total, started_at, finished_at, pr_number,
                                 checks_passed, checks_total)
     select $1, $2, 300 + n, 'This week ' || n, 'standard-fix', 'claude-fable-5',
            case when n = 13 then 'needs_human' else 'merged' end,
            case when n = 13 then 'Awaiting human' else 'Merged' end,
            case when n = 13 then 5 else 6 end, 6,
            now() - make_interval(secs => 21600 + n * 23040
                                          + case when n <= 12 then 810 - 30 * n
                                                 when n <= 24 then 810 + 30 * (n - 12)
                                                 else 820 end),
            now() - make_interval(secs => 21600 + n * 23040),
            400 + n,
            case when n = 13 then 13 else 14 end,
            14
       from generate_series(1, 25) as n`,
    where,
  );

  // The week before that: nineteen merged, so the delta is `▲ 8`, plus one that stopped for a
  // human and one that **failed** before it opened a pull request — which is the row that makes
  // the merge rate's denominator every terminal status rather than only the tidy ones.
  await api.sql.query(
    `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                 workflow_tag, model, status, stage_label, stage_index,
                                 stage_total, started_at, finished_at, pr_number,
                                 checks_passed, checks_total)
     select $1, $2, 200 + m, 'Last week ' || m, 'standard-fix', 'claude-fable-5',
            case when m = 7 then 'failed' when m = 12 then 'needs_human' else 'merged' end,
            case when m = 7 then 'Build farm'
                 when m = 12 then 'Awaiting human' else 'Merged' end,
            case when m = 7 then 4 when m = 12 then 5 else 6 end,
            case when m = 7 then 7 else 6 end,
            now() - make_interval(secs => 604800 + m * 27000 + 600 + 30 * m),
            now() - make_interval(secs => 604800 + m * 27000),
            case when m = 7 then null else 500 + m end,
            case when m = 7 then null when m = 12 then 13 else 14 end,
            case when m = 7 then null else 14 end
       from generate_series(1, 21) as m`,
    where,
  );

  // Twelve queued issues of which the card draws five, and eleven estimates summing to 580
  // minutes — `est. 9h 40m`. The twelfth carries none, which is not zero.
  await api.sql.query(
    `insert into ouroboros.queue_items (organization_id, github_repo_id, issue_number,
                                        issue_title, effort, workflow_tag, position,
                                        est_minutes, enqueued_at)
     select $1, $2, seed.issue_number, seed.issue_title, seed.effort, seed.workflow_tag,
            seed.position, seed.est_minutes,
            now() - make_interval(hours => 13 - seed.position)
       from (values
              ( 1, 485, 'Watchdog reset on I²C bus lockup',         'm',  'standard-fix',   45),
              ( 2, 486, 'Expose battery health over BLE GATT',      'l',  'feature-loop',   90),
              ( 3, 488, 'Typo sweep in operator manual',            'xs', 'docs-loop',      15),
              ( 4, 490, 'Migrate build to Zephyr 4.2',              'xl', 'deps-refresh',  180),
              ( 5, 491, 'Add CRC to config persistence layer',      's',  'standard-fix',   30),
              ( 6, 487, 'Rate-limit telemetry uploads on cellular', 's',  'standard-fix',   30),
              ( 7, 489, 'Console: surface OTA rollback history',    'm',  'feature-loop',   45),
              ( 8, 492, 'Document build-farm cache invalidation',   'xs', 'docs-loop',      15),
              ( 9, 493, 'Scheduler: retry backoff for stuck jobs',  'l',  'feature-loop',   90),
              (10, 494, 'Bump libsodium and re-run the FIPS checks', 's', 'deps-refresh',   25),
              (11, 495, 'Fix the off-by-one in ring buffer wrap',   'xs', 'standard-fix',   15),
              (12, 496, 'Telemetry: split ingest into a worker pool', 'm', 'feature-loop', null)
            ) as seed (position, issue_number, issue_title, effort, workflow_tag, est_minutes)`,
    where,
  );

  // Today's ledger: twelve events, four providers, 4.2M tokens, $18.60 priced and three events
  // unpriced — local inference, which is what the card's `≈` is about.
  //
  // `occurred_at` is spread across the part of today that has already happened, so every event
  // is inside the current UTC day whatever hour this suite runs at — including 00:05, where all
  // twelve land within the first five minutes rather than in tomorrow.
  await api.sql.query(
    `insert into ouroboros.token_usage (organization_id, provider, model, tokens_in,
                                        tokens_out, cost_cents, occurred_at)
     select $1, seed.provider, seed.model,
            seed.tokens / 5 * 4, seed.tokens / 5, seed.cost_cents,
            utc_day.day_start + (now() - utc_day.day_start) * (seed.n::double precision / 13)
       from (values
              ( 1, 'anthropic', 'claude-fable-5',      900000, 540.0000),
              ( 2, 'anthropic', 'claude-sonnet-5',     620000, 372.0000),
              ( 3, 'anthropic', 'claude-haiku-4-5',    380000, 228.0000),
              ( 4, 'copilot',   'copilot/gpt-5-codex', 500000, 250.0000),
              ( 5, 'copilot',   'copilot/gpt-5-codex', 340000, 170.0000),
              ( 6, 'copilot',   'copilot/gpt-5-codex', 240000, 120.0000),
              ( 7, 'cursor',    'cursor/composer-2',   360000,  90.0000),
              ( 8, 'cursor',    'cursor/composer-2',   220000,  55.0000),
              ( 9, 'cursor',    'cursor/composer-2',   140000,  35.0000),
              (10, 'ollama',    'ollama/qwen3-coder',  240000,     null),
              (11, 'ollama',    'ollama/qwen3-coder',  160000,     null),
              (12, 'ollama',    'ollama/qwen3-coder',  100000,     null)
            ) as seed (n, provider, model, tokens, cost_cents)
      cross join (select date_trunc('day', now() at time zone 'utc') at time zone 'utc')
              as utc_day (day_start)`,
    [workspace.id],
  );

  // The one switch, and the page's only write — which #70 reads and #74 changes.
  await api.sql.query(
    `insert into ouroboros.workspace_settings (organization_id, auto_merge_on_checks, updated_by)
     values ($1, true, $2)`,
    [workspace.id, ownerId],
  );
}
