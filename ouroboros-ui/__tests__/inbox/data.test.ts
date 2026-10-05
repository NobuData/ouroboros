import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { inboxQueue, inboxSide, preferences, resolvedDay } from "../helpers/inbox";

/**
 * The `/inbox` first paint (#466, #468, #469): four reads made together, each failing on its own —
 * a mail server that is down must not cost the page its queue.
 */

vi.mock("server-only", () => ({}));

const queue = vi.fn();
const resolved = vi.fn();
const side = vi.fn();
const notifications = vi.fn();

vi.mock("@/app/api/inbox", () => ({
  inbox: {
    queue: () => queue(),
    resolved: () => resolved(),
    side: () => side(),
    notifications: () => notifications(),
  },
}));

const { readInbox } = await import("@/app/inbox/data");

beforeEach(() => {
  queue.mockReset().mockResolvedValue(inboxQueue());
  resolved.mockReset().mockResolvedValue(resolvedDay());
  side.mockReset().mockResolvedValue(inboxSide());
  notifications.mockReset().mockResolvedValue(preferences());
});

describe("readInbox", () => {
  it("reads the queue, today's resolved list, the side column and the reader's preferences — once each", async () => {
    const readings = await readInbox(() => 1_000);

    expect(readings).toEqual({
      queue: { ok: true, value: inboxQueue() },
      resolved: { ok: true, value: resolvedDay() },
      side: { ok: true, value: inboxSide() },
      notifications: { ok: true, value: preferences() },
      readAt: 1_000,
    });
    for (const read of [queue, resolved, side, notifications]) expect(read).toHaveBeenCalledOnce();
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

  it("makes the four reads together, not one after another", async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));

    queue.mockImplementation(async () => (started.push("queue"), await gate, inboxQueue()));
    resolved.mockImplementation(async () => (started.push("resolved"), await gate, resolvedDay()));
    side.mockImplementation(async () => (started.push("side"), await gate, inboxSide()));
    notifications.mockImplementation(async () => (started.push("notifications"), await gate, preferences()));

    const reading = readInbox();

    await Promise.resolve();
    expect(started.sort()).toEqual(["notifications", "queue", "resolved", "side"]);

    release();
    await reading;
  });
});
