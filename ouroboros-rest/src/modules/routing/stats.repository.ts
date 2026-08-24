/**
 * The two statements every figure on mockup 06 is computed by — and, like resolution's
 * repository, not one write.
 *
 * Z.5 ([#198](https://github.com/NobuData/ouroboros/issues/198)), decision **M7**: `$/run avg`,
 * `p50 latency`, the spend card and its footnote are **aggregates over `token_usage`**, never
 * fields anybody stored. A stored total drifts the moment a call is re-priced (V010's decision
 * F10), and a re-priced call is exactly what DASH-J.4
 * ([#92](https://github.com/NobuData/ouroboros/issues/92)) exists to make possible.
 *
 * ---------------------------------------------------------------------------
 * **Both statements are V020's own, written down in that migration before this file existed.**
 *
 * `V020__routing_usage_attribution.sql` added `task_kind` and `latency_ms` for this ticket and
 * its header states the read they are for verbatim — `avg(cost_cents)` grouped by kind, and
 * `percentile_cont(0.5) within group (order by latency_ms)` beside it. That is what
 * {@link RoutingStatsRepository.byTaskKind} issues, and the correspondence is deliberate:
 * the migration argued for the columns' *nullability* on the grounds of what these two
 * aggregates do with a null, so a statement that coalesced either would make that argument
 * false.
 *
 * ---------------------------------------------------------------------------
 * **Nothing here coalesces an absence into a zero, and that is the whole ticket.**
 *
 * Four aggregates below return null for *we have nothing to say*, and every one of them is
 * left null:
 *
 * | Aggregate | Null means | Renders |
 * |---|---|---|
 * | `avg(cost_cents)` | no priced call of this kind in the window | `—` |
 * | `percentile_cont(… order by latency_ms)` | nothing timed a call of this kind | `—` |
 * | `sum(cost_cents)` | no priced call on this provider | *unpriced*, never `$0.00` |
 * | a kind or provider with no row at all | nothing happened | the empty state |
 *
 * `sum` and `avg` skip nulls rather than propagate them, which is what makes the ledger's two
 * populations separable in one pass: a provider whose calls are *priced at zero* — vLLM and
 * Ollama, which genuinely cost nothing per token — sums to `0.0000`, and a provider whose
 * calls are **unpriced** sums to null. The counts beside them (`priced_calls`,
 * `unpriced_calls`) are what let a reader tell a real `$0.00` from a total that is a lower
 * bound, and they are selected here rather than derived later precisely because the difference
 * cannot be recovered from a number once the two have been added together.
 *
 * ---------------------------------------------------------------------------
 * **The window is a parameter, not `now()` written into the SQL.** Two statements each
 * evaluating `now()` for themselves would measure two nearly-identical thirty-day spans, and a
 * call on the boundary would be inside the matrix's average and outside the card's total. See
 * `stats.window.ts`.
 *
 * **Every statement carries the workspace**, which is the acceptance criterion *"aggregation is
 * organization-scoped; another organization's usage cannot leak into a total"*. There is no id
 * here that is globally unique enough to be trusted on its own — a `token_usage` row is keyed
 * by nothing a caller supplies — but the habit is the module's, and `stats.repository.spec.ts`
 * asserts the predicate is compiled into both.
 *
 * **A `numeric` and a `bigint` are cast in SQL and converted once at the edge**, on
 * `dashboard.repository.ts`'s precedent: `pg` hands both back as text rather than lose the
 * precision the columns exist to keep, and a value that reaches JavaScript as a `number` should
 * be one PostgreSQL already knows fits.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";

/**
 * One matrix row's two numerics, as the aggregate answers them.
 *
 * The three counts are not decoration: they are what separates *nothing was measured* from
 * *what was measured is zero*, which is the distinction the whole ticket is about.
 */
export interface TaskKindStatsRow {
  /** `token_usage.task_kind` — the matrix row these calls sit on. */
  readonly task_kind: string;
  /**
   * `avg(cost_cents)` over the kind's **priced** calls, in cents, as `numeric(14, 4)` text.
   *
   * Null when the kind has no priced call in the window — which is the em-dash, and is
   * distinct from `"0.0000"`, the average of calls that really did cost nothing.
   */
  readonly cost_cents_avg: string | null;
  /**
   * The median of the kind's recorded latencies, in milliseconds.
   *
   * `double precision`, because `percentile_cont` interpolates between the two middle values
   * of an even-sized sample. Null when nothing timed a call of this kind.
   */
  readonly latency_p50_ms: number | null;
  /** How many of the kind's calls carried a price — the denominator of the average. */
  readonly priced_calls: number;
  /** How many carried none. Never folded into the average; surfaced as its own state (#92). */
  readonly unpriced_calls: number;
  /** How many were timed — the size of the sample the median is over. */
  readonly timed_calls: number;
}

/** One provider's thirty days, as the spend card's meters are computed from. */
export interface ProviderSpendRow {
  /** `token_usage.provider`, folded lower-case by V010 — a provider *kind*, not a connection. */
  readonly provider: string;
  /**
   * `sum(cost_cents)` over this provider's **priced** calls, in cents, as `numeric(14, 4)` text.
   *
   * Null when none of them are priced — the *unpriced* state, which must never render as
   * `$0.00`. `"0.0000"` is the other thing entirely: calls that were priced, at nothing.
   */
  readonly spend_cents: string | null;
  /** `sum(tokens_in + tokens_out)` as `bigint` text — the numerator or denominator of the footnote. */
  readonly tokens: string;
  /** How many calls carried a price. */
  readonly priced_calls: number;
  /** How many did not. Non-zero makes {@link ProviderSpendRow.spend_cents} a lower bound. */
  readonly unpriced_calls: number;
}

@Injectable()
export class RoutingStatsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The matrix's two numeric columns, per task kind, over the window.
   *
   * `where task_kind is not null` because a null one is *not routed work* (V020) — an import,
   * a chat completion, the provider-level spend mockup 07 draws — and folding it in would put
   * money the router never placed onto a row of a matrix about routing. It is still in the
   * spend card below, which is a claim about a provider rather than about a route.
   *
   * **No index is asked for**, which V020 argued deliberately: `token_usage_organization_
   * occurred_at_idx` (V010) already answers the whole of the `where` — this workspace, this
   * window — and what is left is a grouping over rows already narrowed to one workspace's
   * thirty days.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param since - The oldest instant a call may have occurred at, from `stats.window.ts`.
   * @returns One row per kind that has a routed call in the window, ordered by name so the
   *   answer is stable between calls. **A kind with no calls is absent**, not a row of zeros:
   *   the caller renders the em-dash from the absence.
   */
  async byTaskKind(organizationId: string, since: Date): Promise<TaskKindStatsRow[]> {
    return this.database.db
      .selectFrom("token_usage")
      .select([
        // Non-null by the `where` below; selected as the grouping key.
        sql<string>`task_kind`.as("task_kind"),
        // `avg` skips nulls, so this is the average of the *priced* calls and is null when
        // none of them are. Rounded to the column's own precision rather than to whole cents:
        // a routed `commit-msg` call costs a fraction of one, and rounding it away here is the
        // `$0.00` this whole surface refuses to fake.
        sql<string | null>`avg(cost_cents)::numeric(14, 4)::text`.as("cost_cents_avg"),
        // V020's own expression. Ordered-set aggregates ignore null inputs, so a kind nothing
        // timed yields null rather than a median over the rows that happen to have a zero.
        sql<number | null>`percentile_cont(0.5) within group (order by latency_ms)`.as(
          "latency_p50_ms",
        ),
        sql<number>`count(*) filter (where cost_cents is not null)::int`.as("priced_calls"),
        sql<number>`count(*) filter (where cost_cents is null)::int`.as("unpriced_calls"),
        sql<number>`count(*) filter (where latency_ms is not null)::int`.as("timed_calls"),
      ])
      .where("organization_id", "=", organizationId)
      .where("occurred_at", ">=", since)
      .where("task_kind", "is not", null)
      .groupBy("task_kind")
      .orderBy("task_kind")
      .execute();
  }

  /**
   * Every provider's spend and tokens over the window — the card, and the footnote's two halves.
   *
   * **Unwindowed by task kind, deliberately.** The card's claim is *this is what this provider
   * was paid*, which includes the spend no route placed: an import, a chat completion, the
   * seeded provider-level usage mockup 07 draws its own meters from. Filtering to routed calls
   * would make the two screens disagree about one invoice.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param since - The oldest instant a call may have occurred at, from `stats.window.ts`.
   * @returns One row per provider that has any usage in the window, ordered by name. Empty for
   *   a workspace that has spent nothing — the card's zero-state, not a row of zeros.
   */
  async byProvider(organizationId: string, since: Date): Promise<ProviderSpendRow[]> {
    return this.database.db
      .selectFrom("token_usage")
      .select([
        "provider",
        // Null when nothing on this provider is priced — see this file's header table. Not
        // `coalesce(…, 0)`, which is the one lie the ledger's own column refuses to tell.
        sql<string | null>`sum(cost_cents)::numeric(14, 4)::text`.as("spend_cents"),
        sql<string>`sum(tokens_in + tokens_out)::bigint::text`.as("tokens"),
        sql<number>`count(*) filter (where cost_cents is not null)::int`.as("priced_calls"),
        sql<number>`count(*) filter (where cost_cents is null)::int`.as("unpriced_calls"),
      ])
      .where("organization_id", "=", organizationId)
      .where("occurred_at", ">=", since)
      .groupBy("provider")
      .orderBy("provider")
      .execute();
  }
}
