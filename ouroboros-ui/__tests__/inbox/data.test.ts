import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { inboxQueue, inboxSide, inboxStats, preferences, resolvedDay } from "../helpers/inbox";

/**
 * The `/inbox` first paint (#466, #468, #469, #470): five reads made together, each failing on its
 * own — a mail server that is down must not cost the page its queue, nor a stats read its column.
 */

vi.mock("server-only", () => ({}));

const queue = vi.fn();
const resolved = vi.fn();
const side = vi.fn();
const stats = vi.fn();
const notifications = vi.fn();

vi.mock("@/app/api/inbox", () => ({
  inbox: {
    queue: () => queue(),
    resolved: () => resolved(),
    side: () => side(),
    stats: () => stats(),
    notifications: () => notifications(),
  },
}));

const { readInbox } = await import("@/app/inbox/data");

beforeEach(() => {
  queue.mockReset().mockResolvedValue(inboxQueue());
  resolved.mockReset().mockResolvedValue(resolvedDay());
  side.mockReset().mockResolvedValue(inboxSide());
  stats.mockReset().mockResolvedValue(inboxStats());
  notifications.mockReset().mockResolvedValue(preferences());
});

describe("readInbox", () => {
  it("reads the queue, today's resolved list, the side column, the week and the reader's preferences — once each", async () => {
    const readings = await readInbox(() => 1_000);

    expect(readings).toEqual({
      queue: { ok: true, value: inboxQueue() },
      resolved: { ok: true, value: resolvedDay() },
      side: { ok: true, value: inboxSide() },
      stats: { ok: true, value: inboxStats() },
      notifications: { ok: true, value: preferences() },
      readAt: 1_000,
    });
    for (const read of [queue, resolved, side, stats, notifications]) expect(read).toHaveBeenCalledOnce();
  });

  it("keeps the queue when the side column cannot be read", async () => {
    side.mockRejectedValue(new ApiError(503, "unavailable", "Try again."));

    const readings = await readInbox();

    expect(readings.queue).toEqual({ ok: true, value: inboxQueue() });
    expect(readings.side.ok).toBe(false);
    expect(readings.notifications.ok).toBe(true);
  });

  it("keeps the side column when the preferences cannot be read", async () => {
    notifications.mockRejectedValue(new ApiError(500, "internal", "Something broke."));

    const readings = await readInbox();

    expect(readings.side).toEqual({ ok: true, value: inboxSide() });
    expect(readings.notifications.ok).toBe(false);
  });

  it("keeps every other card when the week's figures cannot be read", async () => {
    stats.mockRejectedValue(new ApiError(503, "unavailable", "Try again."));

    const readings = await readInbox();

    expect(readings.stats).toEqual({ ok: false, reason: "Try again." });
    expect(readings.queue.ok).toBe(true);
    expect(readings.side.ok).toBe(true);
  });

  it("makes the five reads together, not one after another", async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));

    queue.mockImplementation(async () => (started.push("queue"), await gate, inboxQueue()));
    resolved.mockImplementation(async () => (started.push("resolved"), await gate, resolvedDay()));
    side.mockImplementation(async () => (started.push("side"), await gate, inboxSide()));
    stats.mockImplementation(async () => (started.push("stats"), await gate, inboxStats()));
    notifications.mockImplementation(async () => (started.push("notifications"), await gate, preferences()));

    const reading = readInbox();

    await Promise.resolve();
    expect(started.sort()).toEqual(["notifications", "queue", "resolved", "side", "stats"]);

    release();
    await reading;
  });
});
