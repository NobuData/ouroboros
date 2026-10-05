import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { RecordingMailer } from "../mail/mail.fixture";
import { ROUTES_TIMEOUT, NotificationRoutesScheduler } from "./routes.scheduler";
import type { OrgRouteSender, RouteSendReport } from "./routes.sender";

/** What makes the org routes periodic (#488): booked when there is mail to send, never overlapping. */

describe("NotificationRoutesScheduler (#488)", () => {
  let registry: SchedulerRegistry;
  let ticks: number;
  let fail: boolean;
  let scheduler: NotificationRoutesScheduler;

  /**
   * A scheduler over a counting sender.
   *
   * @param transport - The mailer's transport.
   * @returns The scheduler.
   */
  function build(transport: "smtp" | "none" = "smtp"): NotificationRoutesScheduler {
    const sender = {
      tick: (): Promise<RouteSendReport> => {
        ticks += 1;
        return fail
          ? Promise.reject(new Error("database down"))
          : Promise.resolve({ outcomes: [], errors: [] });
      },
    } as unknown as OrgRouteSender;

    return new NotificationRoutesScheduler(sender, new RecordingMailer(transport), registry);
  }

  beforeEach(() => {
    registry = new SchedulerRegistry();
    ticks = 0;
    fail = false;
    scheduler = build();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    scheduler.onApplicationShutdown();
    jest.restoreAllMocks();
  });

  it("books a tick at boot and clears it at shutdown", () => {
    scheduler.onApplicationBootstrap();
    expect(registry.doesExist("timeout", ROUTES_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
    expect(registry.doesExist("timeout", ROUTES_TIMEOUT)).toBe(false);
  });

  it("books nothing on a deployment without a mail server", () => {
    scheduler = build("none");
    scheduler.onApplicationBootstrap();

    expect(registry.doesExist("timeout", ROUTES_TIMEOUT)).toBe(false);
  });

  it("runs the sender and books the next tick, even when the pass fails", async () => {
    fail = true;

    await scheduler.tick();

    expect(ticks).toBe(1);
    expect(registry.doesExist("timeout", ROUTES_TIMEOUT)).toBe(true);
  });

  it("joins a pass already running instead of starting another", async () => {
    await Promise.all([scheduler.tick(), scheduler.tick()]);

    expect(ticks).toBe(1);
  });
});
