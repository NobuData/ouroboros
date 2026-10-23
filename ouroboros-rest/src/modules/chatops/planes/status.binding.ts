/**
 * `/ouro status` — everything live, in one line (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * Three reads, each the one a page already makes: the dashboard's stat row
 * (`GET /api/v1/dashboard`), the farm page's *Runners online* card (`GET /api/v1/farm`) and the
 * Needs-You queue's head (`GET /api/v1/inbox`). The line cannot disagree with those pages because
 * it is not computed beside them — and it writes nothing.
 */

import { Injectable } from "@nestjs/common";

import { DashboardService } from "../../dashboard/dashboard.service";
import { InboxQueueService } from "../../decisions/inbox.queue";
import { FleetService } from "../../farm/fleet/fleet.service";
import type { BindingResult, CommandBinding, CommandContext } from "../grammar.types";
import { statusLine } from "./replies";

@Injectable()
export class StatusBinding implements CommandBinding {
  readonly command = "status";

  /**
   * @param dashboard - The dashboard's read.
   * @param fleet - The farm page's read.
   * @param inbox - The Needs-You queue's read.
   */
  constructor(
    private readonly dashboard: DashboardService,
    private readonly fleet: FleetService,
    private readonly inbox: InboxQueueService,
  ) {}

  /**
   * Read the three pages and say them in one line.
   *
   * @param context - The invocation.
   * @returns Mockup 19's boxed line.
   */
  async run(context: CommandContext): Promise<BindingResult> {
    const { organizationId, invoker } = context;
    const [dashboard, farm, queue] = await Promise.all([
      this.dashboard.read(organizationId, this.dashboard.windows()),
      this.fleet.page(organizationId),
      this.inbox.queue(organizationId, { userId: invoker.userId, roles: invoker.roles }),
    ]);

    return {
      kind: "done",
      reply: {
        text: statusLine({
          loopsLive: dashboard.stats.loopsLive.total,
          queued: dashboard.stats.queued.count,
          runnersOnline: farm.stats.runnersOnline.online,
          runnersTotal: farm.stats.runnersOnline.total,
          // Live usage only (DJ.2): a day with none spent nothing, so no data is $0 here.
          spendTodayCents: dashboard.stats.tokensToday.costCents ?? 0,
          needsYou: queue.head.count,
        }),
      },
    };
  }
}
