import { ProviderAdapterError } from "../provider.errors";
import {
  recordFailure,
  recordResponses,
  recordedRequest,
  streamedResponse,
} from "./http.recordings.fixture";
import {
  LineDecoder,
  MAX_FRAME_BYTES,
  SseDecoder,
  bytesOf,
  count,
  errorText,
  frameJson,
  openInvocation,
} from "./invocation.stream";

const INIT = {
  url: "https://api.example.test/v1/chat/completions",
  host: "api.example.test",
  headers: { authorization: "Bearer sk-hidden" },
  body: { model: "m" },
  signal: new AbortController().signal,
};

/** Bytes. */
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("LineDecoder", () => {
  it("rejoins lines split across chunks, drops CRLF, and keeps an unterminated last line", () => {
    const decoder = new LineDecoder();

    expect([
      ...decoder.push(bytes("one\r\ntw")),
      ...decoder.push(bytes("o\nthr")),
      ...decoder.push(bytes("ee")),
      ...decoder.end(),
    ]).toEqual(["one", "two", "three"]);
  });

  it("rejoins a multi-byte character cut between chunks", () => {
    const decoder = new LineDecoder();
    const tick = bytes("✓\n");

    expect([...decoder.push(tick.slice(0, 1)), ...decoder.push(tick.slice(1))]).toEqual(["✓"]);
  });

  it("refuses a frame longer than the ceiling as upstream", () => {
    expect(() => new LineDecoder().push(bytes("x".repeat(MAX_FRAME_BYTES + 1)))).toThrow(
      expect.objectContaining({ errorClass: "upstream" }) as Error,
    );
  });
});

describe("SseDecoder", () => {
  it("joins multi-line data, keeps the event name, and ignores comments", () => {
    const decoder = new SseDecoder();

    expect([
      ...decoder.push(bytes(": hi\nevent: a\ndata: 1\ndata: 2\n\n")),
      ...decoder.push(bytes("data:3\n\n")),
    ]).toEqual([
      { event: "a", data: "1\n2" },
      { event: null, data: "3" },
    ]);
  });

  it("dispatches a final event with no blank line after it", () => {
    const decoder = new SseDecoder();

    expect([...decoder.push(bytes("data: last")), ...decoder.end()]).toEqual([
      { event: null, data: "last" },
    ]);
  });
});

describe("bytesOf", () => {
  it("opens a call source only when asked", async () => {
    const body = (async function* () {
      await Promise.resolve();
      yield bytes("x");
    })();
    const open = jest.fn(() => Promise.resolve(body));

    expect(open).not.toHaveBeenCalled();
    await expect(bytesOf(open)).resolves.toBe(body);
    await expect(bytesOf(body)).resolves.toBe(body);
  });
});

describe("helpers", () => {
  it("parses frame JSON or refuses it as upstream", () => {
    expect(frameJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => frameJson("{nope")).toThrow(ProviderAdapterError);
  });

  it("counts only non-negative whole numbers", () => {
    expect([count(3), count(-1), count(1.5), count("4"), count(undefined)]).toEqual([
      3, 0, 0, 0, 0,
    ]);
  });

  it("collects the strings the common error shapes carry", () => {
    expect(errorText({ error: { message: "m", code: "c", type: "t" } })).toBe("m c t");
    expect(errorText({ error: "flat" })).toBe("flat");
  });
});

describe("openInvocation", () => {
  it("posts JSON without following redirects and hands back the body", async () => {
    const spy = recordResponses(streamedResponse("data: x\n\n"));
    const body = await openInvocation(INIT, () => null);
    const decoder = new SseDecoder();
    const events = [];

    for await (const chunk of body) {
      events.push(...decoder.push(chunk));
    }

    expect(events).toEqual([{ event: null, data: "x" }]);

    const { url, init } = recordedRequest(spy);

    expect(url).toBe(INIT.url);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBe('{"model":"m"}');
  });

  it.each([
    [401, "auth"],
    [429, "rate_limit"],
    [503, "upstream"],
    [400, "config"],
    [302, "config"],
  ] as const)("classifies a %s as %s", async (status, errorClass) => {
    recordResponses(new Response('{"error":{"message":"x"}}', { status }));

    await expect(openInvocation(INIT, () => null)).rejects.toMatchObject({
      errorClass,
      httpStatus: status,
    });
  });

  it("asks the detector about a config refusal and carries its answer, never the body's text", async () => {
    recordResponses(
      new Response('{"error":{"message":"prompt is too long: sk-hidden"}}', { status: 400 }),
    );
    const detect = jest.fn().mockReturnValue("context_window_exceeded");

    const failure = openInvocation(INIT, detect);

    await expect(failure).rejects.toMatchObject({ refusal: "context_window_exceeded" });
    await expect(failure).rejects.not.toMatchObject({
      detail: expect.stringContaining("sk-hidden") as string,
    });
    expect(detect).toHaveBeenCalledWith(400, {
      error: { message: "prompt is too long: sk-hidden" },
    });
  });

  it("reports a refused socket as network, naming the host", async () => {
    recordFailure();

    await expect(openInvocation(INIT, () => null)).rejects.toMatchObject({
      errorClass: "network",
      detail: expect.stringContaining("api.example.test") as string,
    });
  });
});
