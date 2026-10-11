import type { SseResponse } from "../copilot/copilot.stream";
import { formatDryRunEvent, writeDryRunEvents, type DryRunStreamEvent } from "./dry-runs.stream";

function response() {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  const calls: string[] = [];
  const target: SseResponse = {
    setHeader: (name, value) => {
      headers[name] = value;
      calls.push(`header:${name}`);
    },
    flushHeaders: () => calls.push("flush"),
    write: (chunk) => {
      written.push(chunk);
      calls.push("write");
    },
    end: () => calls.push("end"),
  };
  return { target, written, headers, calls };
}

const STARTED: DryRunStreamEvent = {
  kind: "stage_started",
  seq: 1,
  stageKey: "analyze",
  displayName: "analyze",
};
const BLOCKED: DryRunStreamEvent = {
  kind: "guard_blocked",
  guard: "allow_list",
  call: "git_push",
  stageKey: "implement",
};

async function* events(...items: DryRunStreamEvent[]) {
  await Promise.resolve();
  for (const item of items) yield item;
}

describe("the dry-run event stream", () => {
  it("frames an event by its kind with the body as data", () => {
    expect(formatDryRunEvent(STARTED)).toBe(
      'event: stage_started\ndata: {"kind":"stage_started","seq":1,"stageKey":"analyze","displayName":"analyze"}\n\n',
    );
  });

  it("sends the headers after the first event is produced, then every event in order", async () => {
    const sink = response();

    await writeDryRunEvents(sink.target, events(STARTED, BLOCKED));

    expect(sink.headers).toEqual({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    expect(sink.written).toEqual([formatDryRunEvent(STARTED), formatDryRunEvent(BLOCKED)]);
    expect(sink.calls.at(-1)).toBe("end");
    expect(sink.calls.indexOf("flush")).toBeLessThan(sink.calls.indexOf("write"));
  });

  it("lets a refusal before the first event propagate as an ordinary error, writing nothing", async () => {
    const sink = response();
    // eslint-disable-next-line require-yield -- the refusal is the whole stream
    async function* refused(): AsyncGenerator<DryRunStreamEvent> {
      await Promise.resolve();
      throw new Error("dry_run_not_found");
    }

    await expect(writeDryRunEvents(sink.target, refused())).rejects.toThrow("dry_run_not_found");
    expect(sink.calls).toEqual([]);
  });

  it("ends the response when the stream breaks after it opened", async () => {
    const sink = response();
    async function* broken(): AsyncGenerator<DryRunStreamEvent> {
      await Promise.resolve();
      yield STARTED;
      throw new Error("connection terminated");
    }

    await expect(writeDryRunEvents(sink.target, broken())).rejects.toThrow("connection terminated");
    expect(sink.written).toEqual([formatDryRunEvent(STARTED)]);
    expect(sink.calls.at(-1)).toBe("end");
  });

  it("works on a response with no flushHeaders", async () => {
    const sink = response();
    delete sink.target.flushHeaders;

    await writeDryRunEvents(sink.target, events(STARTED));

    expect(sink.written).toHaveLength(1);
  });
});
