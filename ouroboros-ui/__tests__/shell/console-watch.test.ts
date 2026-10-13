import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DRY_RUN_ID, consoleActions, record, resetConsoleActions } from "../helpers/console";

/**
 * The wait for a command's result (#539): read every three seconds until it settles, a toast
 * when it does, and a quiet end after ten minutes. Framework-free, so it is driven with a
 * reader and a clock and nothing is rendered.
 */

vi.mock("@/app/shell/console-actions", async () =>
  (await import("../helpers/console")).consoleActionsModule(),
);

const {
  CONSOLE_WATCH_INTERVAL_MS,
  CONSOLE_WATCH_LIMIT_MS,
  consoleToasts,
  consoleWatchCount,
  dismissConsoleToast,
  resetConsoleWatch,
  stopConsoleWatches,
  subscribeConsoleToasts,
  watchConsoleCommand,
} = await import("@/app/shell/console-watch");

/** The command as it stands while its result is still on its way. */
const PENDING = record({ outcome: "async_pending", completedAt: null, settledReply: null });

/**
 * Let one interval pass, and the read it starts answer.
 *
 * @param times How many intervals.
 */
async function tick(times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    await vi.advanceTimersByTimeAsync(CONSOLE_WATCH_INTERVAL_MS);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  resetConsoleActions();
  resetConsoleWatch();
});

afterEach(() => {
  resetConsoleWatch();
  vi.useRealTimers();
});

describe("waiting for a command", () => {
  it("reads it every three seconds, and not before the first three have passed", async () => {
    const read = vi.fn().mockResolvedValue(PENDING);

    watchConsoleCommand(DRY_RUN_ID, read);

    expect(CONSOLE_WATCH_INTERVAL_MS).toBe(3_000);
    expect(read).not.toHaveBeenCalled();

    await tick();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(DRY_RUN_ID);

    await tick(2);
    expect(read).toHaveBeenCalledTimes(3);
    expect(consoleToasts()).toEqual([]);
  });

  it("raises a toast with the settled reply and its link, and stops reading", async () => {
    const read = vi.fn().mockResolvedValueOnce(PENDING).mockResolvedValue(record());

    watchConsoleCommand(DRY_RUN_ID, read);
    await tick(2);

    expect(consoleToasts()).toEqual([
      {
        id: DRY_RUN_ID,
        line: "/ouro dry-run #486",
        tone: "ok",
        text: "Dry run of #486 passed: 4 stages, 0 writes.",
        link: { label: "Open the dry run", url: "/workflows/dry-runs/41" },
      },
    ]);

    await tick(3);
    expect(read).toHaveBeenCalledTimes(2);
    expect(consoleWatchCount()).toBe(0);
  });

  it("reads through the Server Action when it is not handed a reader", async () => {
    watchConsoleCommand(DRY_RUN_ID);
    await tick();

    expect(consoleActions.readConsoleCommand).toHaveBeenCalledWith(DRY_RUN_ID);
    expect(consoleToasts()).toHaveLength(1);
  });

  it("tells whoever is listening", async () => {
    const heard = vi.fn();
    const unsubscribe = subscribeConsoleToasts(heard);

    watchConsoleCommand(DRY_RUN_ID, vi.fn().mockResolvedValue(record()));
    await tick();
    expect(heard).toHaveBeenCalledTimes(1);

    unsubscribe();
    dismissConsoleToast(DRY_RUN_ID);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("keeps reading through a read that failed, which says nothing about the command", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ error: "The service is restarting.", code: "internal_error" })
      .mockResolvedValue(record());

    watchConsoleCommand(DRY_RUN_ID, read);
    await tick(3);

    expect(read).toHaveBeenCalledTimes(3);
    expect(consoleToasts()).toHaveLength(1);
  });

  it("stops, quietly, for a command that is not the caller's to read", async () => {
    const read = vi
      .fn()
      .mockResolvedValue({ error: "No such command.", code: "chat_command_not_found" });

    watchConsoleCommand(DRY_RUN_ID, read);
    await tick(4);

    expect(read).toHaveBeenCalledTimes(1);
    expect(consoleToasts()).toEqual([]);
    expect(consoleWatchCount()).toBe(0);
  });

  it("gives up after ten minutes, without a toast", async () => {
    const read = vi.fn().mockResolvedValue(PENDING);

    watchConsoleCommand(DRY_RUN_ID, read);
    expect(CONSOLE_WATCH_LIMIT_MS).toBe(600_000);

    await vi.advanceTimersByTimeAsync(CONSOLE_WATCH_LIMIT_MS);
    const asked = read.mock.calls.length;

    expect(asked).toBe(CONSOLE_WATCH_LIMIT_MS / CONSOLE_WATCH_INTERVAL_MS);
    expect(consoleWatchCount()).toBe(0);

    await tick(5);
    expect(read).toHaveBeenCalledTimes(asked);
    expect(consoleToasts()).toEqual([]);
  });

  it("does not read one command twice over", async () => {
    const read = vi.fn().mockResolvedValue(PENDING);

    const first = watchConsoleCommand(DRY_RUN_ID, read);
    const second = watchConsoleCommand(DRY_RUN_ID, read);
    await tick();

    expect(second).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("waits for two commands at once, and shows both results", async () => {
    const other = "5eed0539-0000-4000-8000-000000000003";

    watchConsoleCommand(DRY_RUN_ID, vi.fn().mockResolvedValue(record()));
    watchConsoleCommand(other, vi.fn().mockResolvedValue(record({ id: other, rawText: "queue #485" })));
    await tick();

    expect(consoleToasts().map((toast) => toast.line)).toEqual([
      "/ouro dry-run #486",
      "/ouro queue #485",
    ]);
  });
});

describe("stopping", () => {
  it("ends every wait, which is what the shell's unmount asks", async () => {
    const read = vi.fn().mockResolvedValue(PENDING);

    watchConsoleCommand(DRY_RUN_ID, read);
    await tick();
    stopConsoleWatches();
    await tick(5);

    expect(read).toHaveBeenCalledTimes(1);
    expect(consoleWatchCount()).toBe(0);
  });

  it("drops an answer that arrives after the wait was stopped", async () => {
    let answer: (value: unknown) => void = () => {};
    const read = vi.fn(() => new Promise((resolve) => (answer = resolve)));

    const stop = watchConsoleCommand(DRY_RUN_ID, read as never);
    await tick();
    stop();
    answer(record());
    await tick();

    expect(consoleToasts()).toEqual([]);
  });

  it("leaves the results that already arrived on screen", async () => {
    watchConsoleCommand(DRY_RUN_ID, vi.fn().mockResolvedValue(record()));
    await tick();
    stopConsoleWatches();

    expect(consoleToasts()).toHaveLength(1);
  });
});

describe("dismissing", () => {
  it("takes the toast down, and keeps the snapshot's identity when nothing changed", async () => {
    watchConsoleCommand(DRY_RUN_ID, vi.fn().mockResolvedValue(record()));
    await tick();

    const before = consoleToasts();
    dismissConsoleToast("not-a-toast");
    expect(consoleToasts()).toBe(before);

    dismissConsoleToast(DRY_RUN_ID);
    expect(consoleToasts()).toEqual([]);
  });
});
