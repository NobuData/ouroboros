/**
 * Y.4's ledger, reproduced — the population mockup 06's four figures are aggregates over.
 *
 * The development seed ([#192](https://github.com/NobuData/ouroboros/issues/192)) is
 * deliberately **not** applied to the integration database — `flyway.toml` leaves the dev-seed
 * placeholder false, and `ApiHarness.truncate` would take it with everything else between tests
 * — so this reproduces its *arithmetic* with the same construction, exactly as
 * `testing/dashboard.fixture.ts` reproduces #68's for mockup 02.
 *
 * ---------------------------------------------------------------------------
 * **The 370 routed calls, and why the sequences are symmetric.**
 *
 * `R__dev_seed_routing.sql` writes one row per model call. For a kind with `calls` rows, call
 * `n` records
 *
 * ```
 * cost_cents = centre_cost    + (n − centre) × cost_step
 * latency_ms = centre_latency + (n − centre) × latency_step
 * tokens     = centre_tokens  + (n − centre) × token_step
 * ```
 *
 * with `centre = (calls + 1) / 2`. The offsets are symmetric, so each column's *mean* is its
 * centre — which makes `avg(cost_cents)` the `$/run avg` column exactly — and `calls` is odd, so
 * one row sits **at** the centre and `percentile_cont(0.5)` returns it rather than an
 * interpolation between two neighbours. The spread is real variation: an `implement` call ranges
 * 16.5s to 65.5s and 24¢ to $1.50, which is what a median is worth having for.
 *
 * ---------------------------------------------------------------------------
 * **The provider-level rows, and why there are only eight of them.**
 *
 * The seeded workspace's ledger is three seeds deep: #68's day of dashboard spend, #221's
 * earlier provider spend, and #192's routed calls. The matrix's two columns are aggregates over
 * the third alone, but the **spend card** is over all of them — so reproducing only the routed
 * calls would give a card that reads `$22.25` where the mockup reads `$412.80`.
 *
 * What matters to this ticket is each provider's *total*, not which of the three seeds a cent
 * came from, so the other two are collapsed into one row per provider carrying the remainder.
 * The exception is Ollama, which gets **five** rows rather than one, because they are the whole
 * point of {@link MOCKUP_06}'s unpriced criterion: they carry `cost_cents = null`, which says
 * *nobody priced this*, beside the routed `docs` calls' `cost_cents = 0`, which says *this cost
 * nothing*. Both states in one workspace is what makes the two testable rather than asserted.
 *
 * ---------------------------------------------------------------------------
 * **{@link MOCKUP_06} states the arithmetic; it does not replace an assertion.** The figures
 * below are what this fixture's SQL is *supposed* to produce, written beside the statements that
 * produce them so a reader can check the two against each other. `stats.integration-spec.ts`
 * deliberately spells its expectations out as literals rather than reading them all from here,
 * because it is the suite whose subject *is* the arithmetic — and that restatement is this
 * constant's oracle.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";

/**
 * What the seeded workspace's figures come to — the numbers `stats.integration-spec.ts` is the
 * oracle for.
 *
 * **Two of them are not mockup 06's, and that is the seed's finding rather than a defect here.**
 * A thirty-day window contains the calendar month it is asked to be smaller than, so a 30-day
 * total can never be *less* than the month-to-date total inside it — and mockup 06 asks Cursor
 * to be `$54.10` where mockup 07's card, over the same rows, reads `$64.10`. Copilot's `$96.40`
 * would need `$20.40` dated before the month began, a window that is empty on the 31st. #192's
 * header sets out the arithmetic and asks for the design to be amended to the reachable
 * reading; Anthropic and the local `$0.00` land on mockup 06 exactly.
 */
export const MOCKUP_06 = {
  /** Per task kind: the `$/run avg` in cents, and the `p50 latency` in milliseconds. */
  kinds: {
    analyze: { costCentsPerRunAvg: 4, latencyP50Ms: 3_100, calls: 25 },
    estimate: { costCentsPerRunAvg: 1, latencyP50Ms: 1_200, calls: 25 },
    plan: { costCentsPerRunAvg: 31, latencyP50Ms: 9_800, calls: 15 },
    implement: { costCentsPerRunAvg: 87, latencyP50Ms: 41_000, calls: 15 },
    "test-gen": { costCentsPerRunAvg: 12, latencyP50Ms: 17_400, calls: 15 },
    review: { costCentsPerRunAvg: 22, latencyP50Ms: 12_600, calls: 15 },
    docs: { costCentsPerRunAvg: 0, latencyP50Ms: 6_300, calls: 15 },
    "commit-msg": { costCentsPerRunAvg: 0, latencyP50Ms: 800, calls: 245 },
  },
  /** **Spend by provider · 30d**, in cents, largest first — the card's own order. */
  spendCents: {
    anthropic: 41_280,
    copilot: 7_600,
    cursor: 6_410,
    /** Both local kinds together: priced, and priced at nothing. */
    local: 0,
  },
  /** The footnote: 21 700 000 of 70 000 000 is 31%, with no rounding. */
  tokens: 70_000_000,
  localTokens: 21_700_000,
  localTokenShare: 0.31,
  /** Ollama's five rows from the earlier seeds — priced by nobody, and never rounded to zero. */
  unpricedCalls: 5,
} as const;

/**
 * The eight routed kinds, and the sequence each one's calls are generated from.
 *
 * Copied from `R__dev_seed_routing.sql`'s own `values` list, in the same column order, so the
 * two can be read against each other line by line.
 */
const ROUTED_KINDS = `
  (0, 'analyze', 'anthropic', 'claude-sonnet-5',
       25,  13,   4.0000, 0.2500,  3100,  200,   50000,  2000),
  (25, 'estimate', 'anthropic', 'claude-haiku-4-5',
       25,  13,   1.0000, 0.0500,  1200,   80,   14000,   500),
  (50, 'plan', 'anthropic', 'claude-fable-5',
       15,   8,  31.0000, 3.0000,  9800,  900,  100000,  8000),
  (65, 'implement', 'anthropic', 'claude-fable-5',
       15,   8,  87.0000, 9.0000, 41000, 3500,  260000, 20000),
  (80, 'test-gen', 'copilot', 'gpt-5-codex',
       15,   8,  12.0000, 1.5000, 17400, 1800,  140000, 10000),
  (95, 'review', 'anthropic', 'claude-fable-5',
       15,   8,  22.0000, 2.5000, 12600, 1200,  140000, 12000),
  (110, 'docs', 'ollama', 'qwen3-coder:32b',
       15,   8,   0.0000, 0.0000,  6300,  600,   40000,  3000),
  (125, 'commit-msg', 'openai_compatible', 'llama-4-maverick',
      245, 123,   0.0000, 0.0000,   800,    6,   80000,   500)
`;

/**
 * The spend the earlier seeds put on each provider, collapsed to one row apiece.
 *
 * `[provider, costCents | null, tokens, rows]`. Tokens split four fifths in and one fifth out,
 * as every seed on this table does; the totals are each provider's figure less what its routed
 * calls above already contribute. Ollama's are unpriced and are five rows rather than one — see
 * this file's header.
 */
const PROVIDER_LEVEL: readonly (readonly [string, string | null, number, number])[] = [
  ["anthropic", "39055.0000", 25_900_000, 1],
  ["copilot", "7420.0000", 6_080_000, 1],
  ["cursor", "6410.0000", 5_120_000, 1],
  ["ollama", null, 1_500_000, 5],
];

/**
 * Write the seeded workspace's ledger.
 *
 * Every row lands well inside the trailing thirty days — two days ago for the routed calls and
 * five for the provider-level rows — so the whole population is in the window on any day of any
 * month. A suite that wants a row *outside* it writes its own; see
 * {@link insertUsage}.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace to bill.
 * @returns When the rows are in.
 */
export async function seedRoutingUsage(api: ApiHarness, organizationId: string): Promise<void> {
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.token_usage
       (organization_id, run_id, provider, model, tokens_in, tokens_out,
        cost_cents, occurred_at, task_kind, latency_ms)
     select $1, null, kind.provider, kind.model,
            measured.tokens / 5 * 4, measured.tokens / 5,
            kind.centre_cost + (call.n - kind.centre) * kind.cost_step,
            now() - interval '2 days',
            kind.task_kind, measured.latency_ms
       from (values ${ROUTED_KINDS}) as kind (id_base, task_kind, provider, model, calls, centre,
                                              centre_cost, cost_step, centre_latency,
                                              latency_step, centre_tokens, token_step)
       cross join lateral generate_series(1, kind.calls) as call (n)
       cross join lateral
            (select (kind.centre_tokens  + (call.n - kind.centre) * kind.token_step)::int,
                    (kind.centre_latency + (call.n - kind.centre) * kind.latency_step)::int)
         as measured (tokens, latency_ms)`,
    [organizationId],
  );

  for (const [provider, costCents, tokens, rows] of PROVIDER_LEVEL) {
    const tokensEach = tokens / rows;
    // Divided here rather than in SQL so the row carries a literal a reader can check against
    // MOCKUP_06, and so a null stays a null rather than becoming a division by a count.
    const costEach = costCents === null ? null : (Number(costCents) / rows).toFixed(4);

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.token_usage
         (organization_id, run_id, provider, model, tokens_in, tokens_out,
          cost_cents, occurred_at, task_kind, latency_ms)
       select $1, null, $2, 'seeded-earlier', $3, $4, $5::numeric,
              now() - interval '5 days', null, null
         from generate_series(1, $6::int)`,
      [organizationId, provider, (tokensEach / 5) * 4, tokensEach / 5, costEach, rows],
    );
  }
}

/**
 * Write one ledger row, for the cases the seeded population deliberately does not cover.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace to bill.
 * @param row - What the call recorded. `occurredAt` is a PostgreSQL interval expression
 *   subtracted from `now()` — `'31 days'` puts the row outside the window — because the window
 *   is relative to the request instant and a literal timestamp would go stale.
 * @returns When the row is in.
 */
export async function insertUsage(
  api: ApiHarness,
  organizationId: string,
  row: {
    provider: string;
    tokens?: number;
    costCents?: string | null;
    taskKind?: string | null;
    latencyMs?: number | null;
    occurredAt?: string;
  },
): Promise<void> {
  const tokens = row.tokens ?? 1_000;

  await api.sql.query(
    `insert into ${SCHEMA_NAME}.token_usage
       (organization_id, run_id, provider, model, tokens_in, tokens_out,
        cost_cents, occurred_at, task_kind, latency_ms)
     values ($1, null, $2, 'fixture-model', $3, $4, $5,
             now() - $6::interval, $7, $8)`,
    [
      organizationId,
      row.provider,
      (tokens / 5) * 4,
      tokens / 5,
      row.costCents ?? null,
      row.occurredAt ?? "2 days",
      row.taskKind ?? null,
      row.latencyMs ?? null,
    ],
  );
}
