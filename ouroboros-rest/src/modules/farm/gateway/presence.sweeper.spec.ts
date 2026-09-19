import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { AgentSessions } from "./agent.sessions";
import { FakeSocket } from "./gateway.fixture";
import { GatewayMetrics } from "./gateway.metrics";
import { PRESENCE_THRESHOLD_MS, RESUME_WINDOW_MS } from "./gateway.policy";
import type { AgentGatewayRepository } from "./gateway.repository";
import { PRESENCE_SWEEP, PresenceSweeper } from "./presence.sweeper";

describe("the presence sweep", () => {
  // Several cases drive a failure path on purpose — a refused hello, a dead database, a listener
  // that throws — and the gateway logs each one, as it should in production. Silenced here so the
  // suite's output holds only what failed; the cases that care what was said spy on it themselves.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  let now: Date;
  let repository: jest.Mocked<Pick<AgentGatewayRepository, "sweepOffline">>;
  let metrics: GatewayMetrics;
  let sessions: AgentSessions;
  let scheduler: SchedulerRegistry;
  let sweeper: PresenceSweeper;

  beforeEach(() => {
    now = new Date("2026-09-18T12:00:00.000Z");
    repository = { sweepOffline: jest.fn().mockResolvedValue([]) };
    metrics = new GatewayMetrics();
    sessions = new AgentSessions(() => now, metrics);
    scheduler = new SchedulerRegistry();
    sweeper = new PresenceSweeper(
      repository as unknown as AgentGatewayRepository,
      sessions,
      metrics,
      scheduler,
      () => now,
    );
  });

  afterEach(() => sweeper.onApplicationShutdown());

  it("flips runners last seen before the documented threshold — and passes only that cutoff", async () => {
    repository.sweepOffline.mockResolvedValue([
      { id: "r1", organization_id: "o1", last_seen_at: new Date(now.getTime() - 40_000) },
    ]);

    const report = await sweeper.sweep();

    expect(repository.sweepOffline).toHaveBeenCalledWith(
      new Date(now.getTime() - PRESENCE_THRESHOLD_MS),
    );
    expect(report.offline).toBe(1);
    expect(metrics.snapshot(sessions.gauges()).presence.swept_offline).toBe(1);
  });

  it("closes a socket here that has stopped carrying heartbeats, leaving its session to resume", async () => {
    const socket = new FakeSocket();
    const { session } = sessions.open("o1", "r1", undefined);
    sessions.attach(session, socket);
    now = new Date(now.getTime() + PRESENCE_THRESHOLD_MS + 1);

    const report = await sweeper.sweep();

    expect(report.staleClosed).toBe(1);
    expect(socket.terminated).toBe(true);
    expect(sessions.find("o1", "r1")).toBe(session);
  });

  it("leaves a socket whose agent beat recently alone", async () => {
    const socket = new FakeSocket();
    const { session } = sessions.open("o1", "r1", undefined);
    sessions.attach(session, socket);
    now = new Date(now.getTime() + PRESENCE_THRESHOLD_MS - 1);

    expect((await sweeper.sweep()).staleClosed).toBe(0);
    expect(socket.terminated).toBe(false);
  });

  it("forgets sessions past their resume window", async () => {
    const socket = new FakeSocket();
    const { session } = sessions.open("o1", "r1", undefined);
    sessions.attach(session, socket);
    sessions.detach(session, socket);
    now = new Date(now.getTime() + RESUME_WINDOW_MS + 1);

    expect((await sweeper.sweep()).expired).toBe(1);
  });

  it("keeps the loop alive when a sweep fails, and books exactly one next tick", async () => {
    repository.sweepOffline.mockRejectedValueOnce(new Error("database gone"));

    await sweeper.tick();

    expect(scheduler.doesExist("timeout", PRESENCE_SWEEP)).toBe(true);
    expect(scheduler.getTimeouts()).toEqual([PRESENCE_SWEEP]);
  });

  it("books nothing once the application is shutting down", async () => {
    sweeper.onApplicationShutdown();

    await sweeper.tick();

    expect(scheduler.doesExist("timeout", PRESENCE_SWEEP)).toBe(false);
  });

  it("starts on bootstrap and stops on shutdown", () => {
    sweeper.onApplicationBootstrap();
    expect(scheduler.doesExist("timeout", PRESENCE_SWEEP)).toBe(true);

    sweeper.onApplicationShutdown();
    expect(scheduler.doesExist("timeout", PRESENCE_SWEEP)).toBe(false);
  });
});
