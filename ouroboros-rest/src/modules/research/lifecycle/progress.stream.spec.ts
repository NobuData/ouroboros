import { NotFoundError } from "../../errors/error.envelope";
import type { InvestigationProgressResource } from "./lifecycle.resources";
import {
  KEEP_ALIVE_POLLS,
  MAX_POLLS,
  POLL_MS,
  type ProgressEvent,
  formatProgress,
  progressFailure,
  watchProgress,
  writeProgress,
} from "./progress.stream";

/**
 * The progress stream (CM.6, #625): a reading on every change, the source count ticking, a
 * clean `done` when the run ends — brief ready or cancelled — and nothing after the client
 * leaves.
 */

function reading(
  overrides: Partial<InvestigationProgressResource> = {},
): InvestigationProgressResource {
  return {
    status: "running",
    iteration: 1,
    iterations: 4,
    sources: 0,
    spendCents: 0,
    cancelRequested: false,
    updatedAt: "2026-10-10T12:00:00.000Z",
    ...overrides,
  };
}

/** A reader that answers a script of readings, repeating the last. */
function scripted(...readings: InvestigationProgressResource[]) {
  let index = 0;
  return jest.fn(() => Promise.resolve(readings[Math.min(index++, readings.length - 1)]));
}

const sleep = jest.fn(() => Promise.resolve());

async function collect(events: AsyncIterable<ProgressEvent>): Promise<ProgressEvent[]> {
  const seen: ProgressEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

/** A response that records what is written to it. */
function response() {
  const headers = new Map<string, string>();
  const chunks: string[] = [];
  let ended = false;
  let flushed = false;

  return {
    headers,
    chunks,
    ended: () => ended,
    flushed: () => flushed,
    setHeader: (name: string, value: string) => headers.set(name, value),
    flushHeaders: () => {
      flushed = true;
    },
    write: (chunk: string) => chunks.push(chunk),
    end: () => {
      ended = true;
    },
  };
}

beforeEach(() => sleep.mockClear());

describe("watchProgress", () => {
  it("shows start → progress → brief_ready, with the source count increasing", async () => {
    const read = scripted(
      reading({ status: "queued", iteration: null }),
      reading({ sources: 12, spendCents: 140 }),
      reading({ sources: 31, spendCents: 390, iteration: 3 }),
      reading({ status: "brief_ready", sources: 44, spendCents: 612, iteration: 4 }),
    );

    const events = await collect(watchProgress(read, { closed: () => false, sleep }));

    expect(events.map((event) => event.kind)).toEqual([
      "progress",
      "progress",
      "progress",
      "progress",
      "done",
    ]);
    const counts = events.map((event) => ("sources" in event ? event.sources : null));
    expect(counts).toEqual([0, 12, 31, 44, 44]);
    expect(events.at(-1)).toMatchObject({ kind: "done", status: "brief_ready", spendCents: 612 });
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(POLL_MS);
  });

  it("closes cleanly on a cancel, the partial ledger in the last reading", async () => {
    const read = scripted(
      reading({ sources: 31 }),
      reading({ sources: 31, cancelRequested: true }),
      reading({ status: "cancelled", sources: 31 }),
    );

    const events = await collect(watchProgress(read, { closed: () => false, sleep }));

    expect(events.map((event) => event.kind)).toEqual(["progress", "progress", "progress", "done"]);
    expect(events[1]).toMatchObject({ cancelRequested: true });
    expect(events.at(-1)).toEqual({
      kind: "done",
      ...reading({ status: "cancelled", sources: 31 }),
    });
  });

  it("answers one reading and `done` for a run that has already ended", async () => {
    const read = scripted(reading({ status: "failed", sources: 7 }));

    const events = await collect(watchProgress(read, { closed: () => false, sleep }));

    expect(events.map((event) => event.kind)).toEqual(["progress", "done"]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("sends nothing while nothing changes, then a keep-alive", async () => {
    const quiet = Array.from({ length: KEEP_ALIVE_POLLS + 1 }, () => reading({ sources: 5 }));
    const read = scripted(...quiet, reading({ status: "brief_ready", sources: 5 }));

    const events = await collect(watchProgress(read, { closed: () => false, sleep }));

    expect(events.map((event) => event.kind)).toEqual([
      "progress",
      "keep-alive",
      "progress",
      "done",
    ]);
  });

  it("honours a custom interval and keep-alive", async () => {
    const read = scripted(reading(), reading(), reading(), reading({ status: "brief_ready" }));

    const events = await collect(
      watchProgress(read, { closed: () => false, sleep, pollMs: 50, keepAlivePolls: 1 }),
    );

    expect(events.map((event) => event.kind)).toEqual([
      "progress",
      "keep-alive",
      "keep-alive",
      "progress",
      "done",
    ]);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("stops reading once the subscriber has gone", async () => {
    const read = scripted(
      reading({ sources: 1 }),
      reading({ sources: 2 }),
      reading({ sources: 3 }),
    );
    let polls = 0;

    const events = await collect(watchProgress(read, { closed: () => ++polls >= 2, sleep }));

    expect(events).toEqual([
      { kind: "progress", ...reading({ sources: 1 }) },
      { kind: "progress", ...reading({ sources: 2 }) },
    ]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("ends on its own after its poll limit, without claiming the run is done", async () => {
    const read = scripted(reading({ status: "queued", iteration: null }));

    const events = await collect(
      watchProgress(read, { closed: () => false, sleep, maxPolls: 3, keepAlivePolls: 99 }),
    );

    expect(events.map((event) => event.kind)).toEqual(["progress"]);
    expect(read).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("allows half an hour of polling by default", () => {
    expect(MAX_POLLS * POLL_MS).toBe(30 * 60 * 1000);
  });

  it("gives each subscriber its own stream of the same investigation", async () => {
    const shared = [
      reading({ sources: 1 }),
      reading({ sources: 2 }),
      reading({ status: "brief_ready", sources: 2 }),
    ];

    const [first, second] = await Promise.all([
      collect(watchProgress(scripted(...shared), { closed: () => false, sleep })),
      // A late subscriber starts from the current reading.
      collect(watchProgress(scripted(...shared.slice(1)), { closed: () => false, sleep })),
    ]);

    expect(first.map((event) => event.kind)).toEqual(["progress", "progress", "progress", "done"]);
    expect(second.map((event) => event.kind)).toEqual(["progress", "progress", "done"]);
    expect(first.at(-1)).toEqual(second.at(-1));
  });

  it("raises a first read's refusal before yielding anything", async () => {
    const read = jest.fn(() => Promise.reject(new NotFoundError("investigation_not_found", "No.")));

    await expect(
      collect(watchProgress(read, { closed: () => false, sleep })),
    ).rejects.toMatchObject({ code: "investigation_not_found" });
  });

  it("waits on a real timer when no sleep is given", async () => {
    jest.useFakeTimers();
    try {
      const read = scripted(reading(), reading({ status: "brief_ready" }));
      const events = collect(watchProgress(read, { closed: () => false, pollMs: 250 }));

      await jest.advanceTimersByTimeAsync(249);
      expect(read).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await events).map((event) => event.kind)).toEqual(["progress", "progress", "done"]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("formatProgress", () => {
  it("frames a reading as an event named by its kind, the kind in the data too", () => {
    expect(formatProgress({ kind: "progress", ...reading({ sources: 12 }) })).toBe(
      `event: progress\ndata: ${JSON.stringify({ kind: "progress", ...reading({ sources: 12 }) })}\n\n`,
    );
    expect(
      formatProgress({ kind: "done", ...reading() }).startsWith(
        'event: done\ndata: {"kind":"done",',
      ),
    ).toBe(true);
  });

  it("frames a keep-alive as a comment a client ignores", () => {
    expect(formatProgress({ kind: "keep-alive" })).toBe(": keep-alive\n\n");
  });

  it("frames an error with its code and message", () => {
    expect(formatProgress({ kind: "error", code: "x", message: "y" })).toBe(
      'event: error\ndata: {"kind":"error","code":"x","message":"y"}\n\n',
    );
  });
});

describe("progressFailure", () => {
  it("carries a domain error's code and message", () => {
    expect(progressFailure(new NotFoundError("investigation_not_found", "Gone."))).toEqual({
      kind: "error",
      code: "investigation_not_found",
      message: "Gone.",
    });
  });

  it.each([new Error("socket hang up"), null, "boom", { code: 42 }])(
    "says nothing of an unexpected failure's internals (%p)",
    (thrown) => {
      const event = progressFailure(thrown);

      expect(event).toMatchObject({ kind: "error", code: "investigation_progress_failed" });
      expect(JSON.stringify(event)).not.toContain("socket");
    },
  );
});

describe("writeProgress", () => {
  it("opens an event stream after the first event, writes every event and ends", async () => {
    const out = response();
    const read = scripted(reading({ sources: 1 }), reading({ status: "brief_ready", sources: 2 }));

    await writeProgress(out, watchProgress(read, { closed: () => false, sleep }));

    expect(out.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(out.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(out.headers.get("x-accel-buffering")).toBe("no");
    expect(out.flushed()).toBe(true);
    expect(out.chunks.map((chunk) => chunk.split("\n")[0])).toEqual([
      "event: progress",
      "event: progress",
      "event: done",
    ]);
    expect(out.ended()).toBe(true);
  });

  it("leaves a refusal before the first event to the error envelope", async () => {
    const out = response();
    const read = jest.fn(() => Promise.reject(new NotFoundError("investigation_not_found", "No.")));

    await expect(
      writeProgress(out, watchProgress(read, { closed: () => false, sleep })),
    ).rejects.toMatchObject({ code: "investigation_not_found" });

    expect(out.headers.size).toBe(0);
    expect(out.chunks).toEqual([]);
    expect(out.ended()).toBe(false);
  });

  it("writes a failure after the stream opened as an error event, and ends", async () => {
    const out = response();
    const read = jest
      .fn<Promise<InvestigationProgressResource>, []>()
      .mockResolvedValueOnce(reading())
      .mockRejectedValueOnce(new NotFoundError("investigation_not_found", "It was deleted."));

    await writeProgress(out, watchProgress(read, { closed: () => false, sleep }));

    expect(out.chunks.at(-1)).toBe(
      'event: error\ndata: {"kind":"error","code":"investigation_not_found","message":"It was deleted."}\n\n',
    );
    expect(out.ended()).toBe(true);
  });

  it("works without flushHeaders", async () => {
    const { flushHeaders: _unused, ...out } = response();

    await writeProgress(
      out,
      watchProgress(scripted(reading({ status: "cancelled" })), { closed: () => false, sleep }),
    );

    expect(out.ended()).toBe(true);
  });
});
