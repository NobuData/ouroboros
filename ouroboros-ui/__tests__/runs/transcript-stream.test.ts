import { describe, expect, it, vi } from "vitest";

import type { RunEventsPage } from "@/app/api/runs";
import type { PollAnswer } from "@/app/poll";
import { MAX_HELD_ENTRIES, appendEntries, createTranscriptStream } from "@/app/runs/transcript-stream";

import { SEEDED_RUN_ID, eventsPage, seededEntries } from "../helpers/runs";

/**
 * The transcript's stream (#312): exact resume from the cursor, an immediate re-ask while more is
 * stored, a bound on what is held, and a loop that stops once a finished run has been read.
 */

/**
 * A fresh answer.
 *
 * @param page The page.
 * @returns The answer.
 */
function fresh(page: RunEventsPage): PollAnswer<RunEventsPage> {
  return { state: "fresh", payload: page, etag: null, pollAfterSeconds: page.pollAfter };
}

/** Let queued microtasks and resolved reads land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("appendEntries", () => {
  it("appends only what is past the cursor", () => {
    const [a, b, c] = seededEntries();

    expect(appendEntries([a!], [a!, b!, c!], 1, 10)).toEqual({ entries: [a, b, c], added: 2, dropped: 0 });
    expect(appendEntries([a!], [a!], 1, 10)).toEqual({ entries: [a], added: 0, dropped: 0 });
  });

  it("keeps the newest `max`, counting what left", () => {
    const entries = seededEntries();

    const held = appendEntries(entries.slice(0, 5), entries.slice(5), 5, 6);
    expect(held.entries.map((entry) => entry.seq)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(held.dropped).toBe(3);
    expect(MAX_HELD_ENTRIES).toBe(500);
  });
});

describe("createTranscriptStream", () => {
  it("reads from the start, then from the cursor the page returned", async () => {
    const asked: number[] = [];
    const pages = [fresh(eventsPage()), fresh(eventsPage({ after: 9, entries: [], nextAfter: 9 }))];
    const read = vi.fn((_id: string, after: number) => {
      asked.push(after);
      return Promise.resolve(pages.shift() ?? pages[0]!);
    });
    const stream = createTranscriptStream(SEEDED_RUN_ID, { read, visible: () => true });

    const stop = stream.start();
    await settle();

    expect(stream.snapshot()).toMatchObject({ live: true, loaded: true, added: 9, dropped: 0, error: null });
    expect(stream.snapshot().entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    stream.refresh();
    await settle();
    expect(asked).toEqual([0, 9]);
    expect(stream.snapshot().added).toBe(0);
    stop();
  });

  it("asks again at once while more is stored", async () => {
    const entries = seededEntries();
    const pages = [
      fresh(eventsPage({ entries: entries.slice(0, 4), hasMore: true })),
      fresh(eventsPage({ after: 4, entries: entries.slice(4), hasMore: false })),
    ];
    const read = vi.fn(() => Promise.resolve(pages.shift()!));
    const stream = createTranscriptStream(SEEDED_RUN_ID, { read, visible: () => true });

    const stop = stream.start();
    await settle();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(stream.snapshot().entries).toHaveLength(9);
    stop();
  });

  it("drops a page that does not continue from the cursor — no duplicate, no gap", async () => {
    const read = vi.fn(() => Promise.resolve(fresh(eventsPage({ after: 3 }))));
    const stream = createTranscriptStream(SEEDED_RUN_ID, { read, visible: () => true });

    const stop = stream.start();
    await settle();

    expect(stream.snapshot().loaded).toBe(false);
    expect(stream.snapshot().entries).toEqual([]);
    stop();
  });

  it("drops another run's page", async () => {
    const read = vi.fn(() => Promise.resolve(fresh(eventsPage({ runId: "5eed0009-0000-4000-8000-000000000999" }))));
    const stream = createTranscriptStream(SEEDED_RUN_ID, { read, visible: () => true });

    const stop = stream.start();
    await settle();

    expect(stream.snapshot().entries).toEqual([]);
    stop();
  });

  it("holds at most `maxEntries`, and says how many left", async () => {
    const read = vi.fn(() => Promise.resolve(fresh(eventsPage())));
    const stream = createTranscriptStream(SEEDED_RUN_ID, { read, visible: () => true, maxEntries: 4 });

    const stop = stream.start();
    await settle();

    expect(stream.snapshot().entries.map((entry) => entry.seq)).toEqual([6, 7, 8, 9]);
    expect(stream.snapshot().dropped).toBe(5);
    stop();
  });

  it("keeps what it holds when a read fails, and says why", async () => {
    const pages: PollAnswer<RunEventsPage>[] = [
      fresh(eventsPage()),
      { state: "failed", reason: "The transcript could not be reached.", pollAfterSeconds: null },
    ];
    const read = vi.fn(() => Promise.resolve(pages.shift() ?? pages[0]!));
    const stream = createTranscriptStream(SEEDED_RUN_ID, { read, visible: () => true });

    const stop = stream.start();
    await settle();
    stream.refresh();
    await settle();

    expect(stream.snapshot().entries).toHaveLength(9);
    expect(stream.snapshot().error).toBe("The transcript could not be reached.");
    stop();
  });

  it("stops once a finished run is read to its end", async () => {
    const read = vi.fn(() => Promise.resolve(fresh(eventsPage({ live: false }))));
    const stream = createTranscriptStream(SEEDED_RUN_ID, { read, visible: () => true });

    stream.start();
    await settle();
    stream.refresh();
    await settle();

    expect(stream.snapshot().live).toBe(false);
    expect(read).toHaveBeenCalledOnce();
  });
});
