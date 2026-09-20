import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildLog } from "@/app/api/farm";
import { UNREACHABLE_LOG } from "@/app/farm/log-poll";
import {
  EARLIER_OUTPUT,
  EMPTY_LOG_VIEW,
  type LogStream,
  type LogStreamOptions,
  WITNESS_WINDOW_MS,
  createLogStream,
} from "@/app/farm/log-stream";
import { type PollAnswer, SESSION_ENDED } from "@/app/poll";

import { FARM_READ_AT, LIVE_JOB_ID, buildLog, logAnswer } from "../helpers/farm";

/**
 * One build's log, streamed by offset (#261): exact resume, catching up without the timer, the
 * jump to a long log's tail, a `live` flag passed through untouched, and a finished log that is
 * left alone. The loop's own timing is `poll.test.ts`'s.
 */

/** The live cadence, in milliseconds. */
const LIVE_MS = 2000;

/** The offsets the stream asked from, in order. */
let asked: number[];

/** What the reader answers, in order; the last one repeats. */
let script: PollAnswer<BuildLog>[];

/**
 * Build a stream over {@link script}.
 *
 * @param options Options beside the reader.
 * @returns The stream.
 */
function streaming(options: Partial<LogStreamOptions> = {}): LogStream {
  return createLogStream(LIVE_JOB_ID, {
    read: (_jobId, after) => {
      asked.push(after);
      const answer = script.length > 1 ? script.shift()! : script[0]!;
      return Promise.resolve(answer);
    },
    visible: () => true,
    ...options,
  });
}

/** Let every pending answer land. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** @returns What each row of a stream's view says. */
function texts(stream: LogStream): string[] {
  return stream.snapshot().rows.map((row) => row.text);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FARM_READ_AT);
  asked = [];
  script = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("before it starts", () => {
  it("is inert, and reports nothing read", () => {
    const stream = streaming();

    expect(stream.snapshot()).toBe(EMPTY_LOG_VIEW);
    expect(asked).toEqual([]);
  });
});

describe("offset fetching", () => {
  it("asks from 0, then from wherever the last page ended", async () => {
    script = [
      logAnswer(buildLog("$ west build\n")),
      logAnswer(buildLog("[1/2] a.c\n", { offset: 13 })),
      logAnswer(buildLog("", { offset: 23 })),
    ];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_MS);
    await vi.advanceTimersByTimeAsync(LIVE_MS);

    expect(asked).toEqual([0, 13, 23]);
    expect(texts(stream)).toEqual(["$ west build", "[1/2] a.c"]);
    stop();
  });

  it("waits the cadence the page asked for between asks", async () => {
    script = [logAnswer(buildLog("a\n"))];
    const stream = streaming();
    const stop = stream.start();
    await settle();

    await vi.advanceTimersByTimeAsync(LIVE_MS - 1);
    expect(asked).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toHaveLength(2);
    stop();
  });

  it("drops a page that does not start where the last one ended, so nothing is drawn twice", async () => {
    script = [
      logAnswer(buildLog("one\n")),
      // The same page again — an answer to an ask that was overtaken.
      logAnswer(buildLog("one\n")),
      logAnswer(buildLog("two\n", { offset: 4 })),
    ];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_MS);
    await vi.advanceTimersByTimeAsync(LIVE_MS);

    expect(texts(stream)).toEqual(["one", "two"]);
    // The offset did not move for the dropped page: the next ask is from 4 again.
    expect(asked).toEqual([0, 4, 4]);
    stop();
  });

  it("drops a page that skips ahead, rather than drawing a log with a silent hole in it", async () => {
    script = [logAnswer(buildLog("one\n")), logAnswer(buildLog("three\n", { offset: 9 }))];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_MS);

    expect(texts(stream)).toEqual(["one"]);
    stop();
  });

  it("drops a page that belongs to another job", async () => {
    script = [logAnswer(buildLog("theirs\n", { jobId: "another-job" }))];
    const stream = streaming();
    const stop = stream.start();
    await settle();

    expect(texts(stream)).toEqual([]);
    stop();
  });

  it("reassembles a log split inside multi-byte characters exactly", async () => {
    // AH.5 ends a page on a character boundary; what the stream owes is the byte arithmetic.
    const first = buildLog("✓ é ");
    const second = buildLog("𝄞 — done\n", { offset: first.nextOffset });
    script = [logAnswer(first), logAnswer(second), logAnswer(buildLog("", { offset: second.nextOffset }))];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_MS);

    expect(asked).toEqual([0, 7]);
    expect(texts(stream)).toEqual(["✓ é 𝄞 — done"]);
    stop();
  });

  it("keeps the rows it holds by identity when a page adds nothing", async () => {
    script = [logAnswer(buildLog("a\n")), logAnswer(buildLog("", { offset: 2 }))];
    const stream = streaming();
    const heard = vi.fn();
    stream.subscribe(heard);
    const stop = stream.start();

    await settle();
    const view = stream.snapshot();
    await vi.advanceTimersByTimeAsync(LIVE_MS);

    // Nothing moved, so nobody was told and the snapshot is the same object.
    expect(stream.snapshot()).toBe(view);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("catching up", () => {
  it("asks for the next page at once while more is stored than the last page reached", async () => {
    script = [
      logAnswer(buildLog("one\n", { end: 12 })),
      logAnswer(buildLog("two\n", { offset: 4, end: 12 })),
      logAnswer(buildLog("three\n", { offset: 8, end: 14 })),
      logAnswer(buildLog("", { offset: 14 })),
    ];
    const stream = streaming();
    const stop = stream.start();

    // No timer advanced: three pages in one go.
    await settle();

    expect(asked).toEqual([0, 4, 8]);
    expect(texts(stream)).toEqual(["one", "two", "three"]);
    expect(stream.snapshot().settled).toBe(true);

    // And then it is back on the cadence.
    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(asked).toEqual([0, 4, 8, 14]);
    stop();
  });
});

describe("joining a long log at its tail", () => {
  it("sets the first page aside and jumps to the last tailBytes, leaving out the line it lands in", async () => {
    script = [
      logAnswer(buildLog("x".repeat(100), { nextOffset: 100, end: 1000 })),
      logAnswer(buildLog("rest of a line\nwhole line\n", { offset: 900, nextOffset: 1000, end: 1000 })),
    ];
    const stream = streaming({ tailBytes: 100 });
    const stop = stream.start();
    await settle();

    expect(asked).toEqual([0, 900]);
    expect(texts(stream)).toEqual([EARLIER_OUTPUT.tail, "whole line"]);
    stop();
  });

  it("does not jump when what is left is within the tail", async () => {
    script = [
      logAnswer(buildLog("one\n", { end: 104 })),
      logAnswer(buildLog("two\n", { offset: 4, nextOffset: 104, end: 104 })),
    ];
    const stream = streaming({ tailBytes: 100 });
    const stop = stream.start();
    await settle();

    expect(asked).toEqual([0, 4]);
    expect(texts(stream)).toEqual(["one", "two"]);
    stop();
  });

  it("never jumps in full mode: the sheet reads the whole log", async () => {
    script = [
      logAnswer(buildLog("head\n", { end: 1000 })),
      logAnswer(buildLog("next\n", { offset: 5, nextOffset: 1000, end: 1000 })),
    ];
    const stream = streaming({ mode: "full", tailBytes: 100 });
    const stop = stream.start();
    await settle();

    expect(asked).toEqual([0, 5]);
    expect(texts(stream)).toEqual(["head", "next"]);
    stop();
  });
});

describe("bounds", () => {
  it("says that earlier output is not held once rows have left the head", async () => {
    script = [logAnswer(buildLog("1\n2\n3\n4\n5\n"))];
    const stream = streaming({ limits: { maxLines: 3, maxColumns: 100 } });
    const stop = stream.start();
    await settle();

    expect(texts(stream)).toEqual([EARLIER_OUTPUT.tail, "3", "4", "5"]);
    stop();
  });

  it("says it in the sheet's own words in full mode", async () => {
    script = [logAnswer(buildLog("1\n2\n3\n"))];
    const stream = streaming({ mode: "full", limits: { maxLines: 2, maxColumns: 100 } });
    const stop = stream.start();
    await settle();

    expect(texts(stream)[0]).toBe(EARLIER_OUTPUT.full);
    stop();
  });
});

describe("holes", () => {
  it("draws the tail marker once, under the text, and redraws it only when its figures move", async () => {
    const tail = { bytes: 100, missingChunks: 0, capped: true };
    script = [
      logAnswer(buildLog("a\n", { tail })),
      logAnswer(buildLog("", { offset: 2, tail: { ...tail } })),
      logAnswer(buildLog("", { offset: 2, tail: { ...tail, bytes: 250 } })),
    ];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    const first = stream.snapshot().rows;
    expect(texts(stream)).toEqual(["a", "[… 100 bytes elided — log cap reached]"]);

    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(stream.snapshot().rows).toBe(first);

    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(texts(stream)).toEqual(["a", "[… 250 bytes elided — log cap reached]"]);
    stop();
  });
});

describe("live", () => {
  it("is nothing until a page has said, then exactly what the page says", async () => {
    script = [logAnswer(buildLog("a\n", { live: true }))];
    const stream = streaming();
    const stop = stream.start();

    expect(stream.snapshot().live).toBeNull();
    await settle();
    expect(stream.snapshot().live).toBe(true);
    stop();
  });

  it("stays true through pages that carry no text: it is the job's state, not chunk recency", async () => {
    script = [logAnswer(buildLog("a\n")), logAnswer(buildLog("", { offset: 2 }))];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    for (let quiet = 0; quiet < 30; quiet += 1) await vi.advanceTimersByTimeAsync(LIVE_MS);

    // A minute of silence, and nothing here has decided the build is over.
    expect(stream.snapshot().live).toBe(true);
    expect(stream.snapshot().endedAt).toBeNull();
    stop();
  });

  it("goes false the moment a page says so — even one that carried text a moment ago", async () => {
    script = [logAnswer(buildLog("a\n")), logAnswer(buildLog("done\n", { offset: 2, live: false, pollAfter: 15 }))];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_MS);

    expect(stream.snapshot().live).toBe(false);
    expect(texts(stream)).toEqual(["a", "done"]);
    stop();
  });

  it("stamps an end it witnessed, once, and never moves it", async () => {
    script = [logAnswer(buildLog("a\n")), logAnswer(buildLog("", { offset: 2, live: false, end: 9 }))];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(stream.snapshot().endedAt).toBe(FARM_READ_AT + LIVE_MS);

    // Not settled, so it keeps asking; later pages are later, and the end is not.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stream.snapshot().endedAt).toBe(FARM_READ_AT + LIVE_MS);
    stop();
  });

  it("claims no end time for a build that was already over when first read", async () => {
    script = [logAnswer(buildLog("done\n", { live: false }))];
    const stream = streaming();
    const stop = stream.start();
    await settle();

    expect(stream.snapshot()).toMatchObject({ live: false, endedAt: null });
    stop();
  });

  it("claims none for a build that ended while nobody was listening", async () => {
    let visible = true;
    script = [logAnswer(buildLog("a\n")), logAnswer(buildLog("", { offset: 2, live: false }))];
    const stream = streaming({ visible: () => visible });
    const stop = stream.start();
    await settle();

    // The tab is hidden for far longer than the witness window, and the build ends meanwhile.
    visible = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(WITNESS_WINDOW_MS * 10);
    expect(asked).toHaveLength(1);

    visible = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    expect(stream.snapshot()).toMatchObject({ live: false, endedAt: null });
    stop();
  });
});

describe("a finished log", () => {
  it("is final once read to its end: the stream stops asking altogether", async () => {
    script = [logAnswer(buildLog("done\n", { live: false, pollAfter: 15 }))];
    const stream = streaming();
    stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(asked).toEqual([0]);
  });

  it("is read to its end first", async () => {
    script = [
      logAnswer(buildLog("one\n", { live: false, end: 8 })),
      logAnswer(buildLog("two\n", { offset: 4, live: false })),
    ];
    const stream = streaming();
    stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(asked).toEqual([0, 4]);
    expect(texts(stream)).toEqual(["one", "two"]);
  });

  it("resumes from the offset it reached when started again, and draws nothing twice", async () => {
    script = [logAnswer(buildLog("one\n")), logAnswer(buildLog("two\n", { offset: 4 }))];
    const stream = streaming();

    stream.start()();
    await settle();
    // The first ask was in the air when the stream was stopped: its answer arrived to nobody.
    expect(texts(stream)).toEqual([]);

    script = [logAnswer(buildLog("one\n")), logAnswer(buildLog("two\n", { offset: 4 }))];
    const stop = stream.start();
    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_MS);

    expect(texts(stream)).toEqual(["one", "two"]);
    stop();
  });
});

describe("failures", () => {
  it("keeps what it holds and says why, then clears the sentence on the next success", async () => {
    script = [
      logAnswer(buildLog("one\n")),
      { state: "failed", reason: UNREACHABLE_LOG, pollAfterSeconds: null },
      logAnswer(buildLog("two\n", { offset: 4 })),
    ];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(stream.snapshot()).toMatchObject({ error: UNREACHABLE_LOG, live: true });
    expect(texts(stream)).toEqual(["one"]);

    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(stream.snapshot().error).toBeNull();
    expect(texts(stream)).toEqual(["one", "two"]);
    // The failed ask moved nothing: the retry was from the same offset.
    expect(asked).toEqual([0, 4, 4]);
    stop();
  });

  it("says the session ended, and stops asking on the timer", async () => {
    script = [{ state: "gone" }];
    const stream = streaming();
    const stop = stream.start();

    await settle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stream.snapshot().error).toBe(SESSION_ENDED);
    expect(asked).toEqual([0]);
    stop();
  });

  it("draws nothing for a log retention has removed, and says it is gone", async () => {
    script = [logAnswer(buildLog("", { live: false, retained: false }))];
    const stream = streaming();
    stream.start();
    await settle();

    expect(stream.snapshot()).toMatchObject({ retained: false, rows: [] });
  });
});

describe("the tab", () => {
  it("asks nothing while hidden, and at once on return — from the same offset", async () => {
    let visible = true;
    script = [logAnswer(buildLog("a\n")), logAnswer(buildLog("b\n", { offset: 2 }))];
    const stream = streaming({ visible: () => visible });
    const stop = stream.start();
    await settle();

    visible = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual([0]);

    visible = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    expect(asked).toEqual([0, 2]);
    expect(texts(stream)).toEqual(["a", "b"]);
    stop();
  });
});
