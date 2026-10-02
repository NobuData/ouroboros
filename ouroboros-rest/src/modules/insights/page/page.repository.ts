/**
 * The one statement the Insights page issues itself (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)): the workspace's provider caps.
 *
 * Every *metric* on the page comes from the windowed metrics service, the scoreboard, calibration
 * or the flakes plane — this file computes none. A cap is not a metric: it is configuration an
 * administrator typed on a provider card (`provider_connections.monthly_cap_cents`), and the
 * cost chart's budget guide is drawn from it (decision **I8**). `ProviderConnectionsModule`
 * exports nothing by design — its service sits behind a role gate, a rate limiter and a step-up —
 * so the page reads the one column it needs rather than borrowing that service.
 *
 * Beside it, the rollups' own bookkeeping (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)):
 * not a metric either, but the fact of how current the metrics are — what the page's rollup-lag
 * banner says. `page.freshness.ts` decides what the summary means.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { FreshnessFacts } from "./page.freshness";
import type { ProviderCaps } from "./page.series";

/** One summary row over a workspace's `metric_rollup_state`. */
interface FreshnessRow {
  families: string;
  filled_families: string;
  earliest_filled_day: string | null;
  last_succeeded_at: Date | null;
  failing: boolean | null;
}

@Injectable()
export class InsightsPageRepository {
  /**
   * @param database - The typed connection.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's monthly caps: every enabled connection that has one, summed.
   *
   * A disabled connection spends nothing, so its cap is no part of the budget; a connection with
   * no cap is uncapped, not capped at zero, so it adds nothing either.
   *
   * @param organizationId - The workspace.
   * @returns The sum and how many connections it covers; a null sum when none has a cap.
   */
  async caps(organizationId: string): Promise<ProviderCaps> {
    const row = await this.database.db
      .selectFrom("provider_connections")
      .select((eb) => [
        eb.fn.sum<string | null>("monthly_cap_cents").as("monthly_cap_cents"),
        eb.fn.count<string>("monthly_cap_cents").as("connections"),
      ])
      .where("organization_id", "=", organizationId)
      .where("enabled", "=", true)
      .executeTakeFirstOrThrow();

    return {
      monthlyCapCents: row.monthly_cap_cents === null ? null : Number(row.monthly_cap_cents),
      connections: Number(row.connections),
    };
  }

  /**
   * The workspace's rollup bookkeeping, summarized over every family.
   *
   * @param organizationId - The workspace.
   * @returns How many families there are and have filled, the stalest filled day, the latest
   *   successful run and whether any latest run failed — zeros and nulls before the first run.
   */
  async freshness(organizationId: string): Promise<FreshnessFacts> {
    const { rows } = await sql<FreshnessRow>`
      select count(*)                                                       as families,
             count(last_filled_day)                                         as filled_families,
             to_char(min(last_filled_day), 'YYYY-MM-DD')                    as earliest_filled_day,
             max(last_run_at) filter (where last_run_status = 'succeeded') as last_succeeded_at,
             bool_or(last_run_status = 'failed')                            as failing
        from ouroboros.metric_rollup_state
       where organization_id = ${organizationId}`.execute(this.database.db);

    const [row] = rows;

    return {
      families: Number(row?.families ?? 0),
      filledFamilies: Number(row?.filled_families ?? 0),
      earliestFilledDay: row?.earliest_filled_day ?? null,
      lastSucceededAt: row?.last_succeeded_at ?? null,
      failing: row?.failing === true,
    };
  }
}
