import type { DashboardService } from "../../dashboard/dashboard.service";
import type { InboxQueueService } from "../../decisions/inbox.queue";
import { ForbiddenError } from "../../errors/error.envelope";
import type { FleetService } from "../../farm/fleet/fleet.service";
import { bindsOf, contextFor, INVOKER, strictDouble, WORKSPACE } from "./planes.fixture";
import { StatusBinding } from "./status.binding";

/**
 * `/ouro status` (#537) is three reads, each the one a page already makes:
 *
 *   * `GET /api/v1/dashboard` — `DashboardController.read` calls `dashboard.windows()` and then
 *     `dashboard.read(tenant.id, windows)`;
 *   * `GET /api/v1/farm` — `FleetController.page` calls `fleet.page(tenant.id)`;
 *   * `GET /api/v1/inbox` — `InboxController.list` calls
 *     `queue.queue(tenant.id, { userId, roles })` as the person asking.
 *
 * The doubles below have those methods and no others, so a figure computed beside the pages —
 * a count of its own, a second query — fails here by reaching for something that is not there.
 */

/** The windows the dashboard service hands its own read. */
const WINDOWS = { today: "2026-10-12" };

/** Mockup 19's figures, as the three pages carry them. */
const DASHBOARD = {
  stats: {
    loopsLive: { total: 3 },
    queued: { count: 12 },
    tokensToday: { costCents: 1860 },
  },
};
const FARM = { stats: { runnersOnline: { online: 4, total: 5 } } };
const QUEUE = { head: { count: 3 } };

describe("the /ouro status binding", () => {
  let windows: jest.Mock;
  let read: jest.Mock;
  let page: jest.Mock;
  let queue: jest.Mock;
  let binding: StatusBinding;

  beforeEach(() => {
    windows = jest.fn().mockReturnValue(WINDOWS);
    read = jest.fn().mockResolvedValue(DASHBOARD);
    page = jest.fn().mockResolvedValue(FARM);
    queue = jest.fn().mockResolvedValue(QUEUE);
    binding = new StatusBinding(
      strictDouble<DashboardService>("DashboardService", { windows, read }),
      strictDouble<FleetService>("FleetService", { page }),
      strictDouble<InboxQueueService>("InboxQueueService", { queue }),
    );
  });

  it("serves the status command, which the registry binds to the three page reads", () => {
    expect(binding.command).toBe("status");
    expect(bindsOf("status")).toBe("GET /api/v1/dashboard · GET /api/v1/farm · GET /api/v1/inbox");
  });

  it("makes the dashboard's, the farm page's and the inbox's own read, once each", async () => {
    await binding.run(contextFor("status"));

    expect(windows).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(WORKSPACE, WINDOWS);
    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith(WORKSPACE);
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it("reads the Needs-You queue as the invoker, so the count is the one their inbox shows", async () => {
    await binding.run(contextFor("status"));

    expect(queue).toHaveBeenCalledWith(WORKSPACE, {
      userId: INVOKER.userId,
      roles: INVOKER.roles,
    });
  });

  it("answers mockup 19's boxed line", async () => {
    expect(await binding.run(contextFor("status"))).toEqual({
      kind: "done",
      reply: {
        text: "3 loops live · 12 queued · farm 4/5 online · spend today $18.60 · needs-you: 3",
      },
    });
  });

  it("says one loop in the singular", async () => {
    read.mockResolvedValue({
      stats: { ...DASHBOARD.stats, loopsLive: { total: 1 } },
    });

    const result = await binding.run(contextFor("status"));

    expect(result.reply.text).toMatch(/^1 loop live · /);
  });

  it.each([
    ["the dashboard", (): jest.Mock => read],
    ["the farm page", (): jest.Mock => page],
    ["the Needs-You queue", (): jest.Mock => queue],
  ])("relays a refusal from %s as the plane threw it", async (_plane, method) => {
    const refusal = new ForbiddenError("forbidden", "Not yours to read.");
    method().mockRejectedValue(refusal);

    await expect(binding.run(contextFor("status"))).rejects.toBe(refusal);
  });
});
