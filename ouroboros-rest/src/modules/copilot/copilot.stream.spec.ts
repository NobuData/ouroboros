import { UpstreamError } from "../errors/error.envelope";
import {
  formatSse,
  streamFailure,
  writeSse,
  type CopilotStreamEvent,
  type SseResponse,
} from "./copilot.stream";

function response() {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let ended = false;
  let flushed = false;
  const target: SseResponse = {
    setHeader: (name, value) => {
      headers[name] = value;
    },
    flushHeaders: () => {
      flushed = true;
    },
    write: (chunk) => written.push(chunk),
    end: () => {
      ended = true;
    },
  };
  return { target, written, headers, ended: () => ended, flushed: () => flushed };
}

async function* events(...items: CopilotStreamEvent[]) {
  await Promise.resolve();
  for (const item of items) yield item;
}

describe("the event stream", () => {
  it("frames an event by its kind with the body as data", () => {
    expect(formatSse({ kind: "delta", text: "hi\n" })).toBe(
      'event: delta\ndata: {"kind":"delta","text":"hi\\n"}\n\n',
    );
  });

  it("sends the headers after the first event and writes every event in order", async () => {
    const sink = response();

    await writeSse(
      sink.target,
      events({ kind: "delta", text: "a" }, { kind: "read", tool: "draft" }),
    );

    expect(sink.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(sink.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(sink.flushed()).toBe(true);
    expect(sink.written).toEqual([
      formatSse({ kind: "delta", text: "a" }),
      formatSse({ kind: "read", tool: "draft" }),
    ]);
    expect(sink.ended()).toBe(true);
  });

  it("lets a refusal before the first event propagate as the ordinary error envelope", async () => {
    const sink = response();
    async function* refusing(): AsyncGenerator<CopilotStreamEvent> {
      await Promise.resolve();
      throw new UpstreamError("engine_unavailable", "down");
      yield { kind: "delta", text: "never" };
    }

    await expect(writeSse(sink.target, refusing())).rejects.toMatchObject({
      code: "engine_unavailable",
    });
    expect(sink.written).toEqual([]);
    expect(sink.ended()).toBe(false);
  });

  it("turns a failure after the stream opened into an error event and ends", async () => {
    const sink = response();
    async function* breaking(): AsyncGenerator<CopilotStreamEvent> {
      await Promise.resolve();
      yield { kind: "delta", text: "a" };
      throw new UpstreamError("engine_unavailable", "down");
    }

    await writeSse(sink.target, breaking());

    expect(sink.written).toEqual([
      formatSse({ kind: "delta", text: "a" }),
      formatSse({ kind: "error", code: "engine_unavailable", message: "down" }),
    ]);
    expect(sink.ended()).toBe(true);
  });

  it("names an unknown failure without leaking it", () => {
    expect(streamFailure(new Error("secret internals"))).toEqual({
      kind: "error",
      code: "copilot_stream_failed",
      message: "secret internals",
    });
    expect(streamFailure(null)).toEqual({
      kind: "error",
      code: "copilot_stream_failed",
      message: "The reply could not be finished.",
    });
  });
});
