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
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../db/db.service";
import type { ProviderCaps } from "./page.series";

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
}
