import type { InvocationChunk } from "../provider.adapter";
import { ANTHROPIC_INVOCATION_STREAM } from "./anthropic.recordings.fixture";
import { anthropicRefusal, parseAnthropicStream } from "./anthropic.stream";

/** A body in one chunk. */
async function* body(text: string): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  yield new TextEncoder().encode(text);
}

/** Parse to the end, collecting what came out before any throw. */
async function parse(text: string): Promise<{ chunks: InvocationChunk[]; error: unknown }> {
  const chunks: InvocationChunk[] = [];

  try {
    for await (const chunk of parseAnthropicStream(body(text))) {
      chunks.push(chunk);
    }
  } catch (error) {
    return { chunks, error };
  }

  return { chunks, error: null };
}

const START =
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}\n\n';

describe("parseAnthropicStream", () => {
  it("restates usage cumulatively and ends with the stop reason", async () => {
    const { chunks, error } = await parse(ANTHROPIC_INVOCATION_STREAM);

    expect(error).toBeNull();
    expect(
      chunks
        .filter((chunk) => chunk.kind === "usage")
        .map((chunk) => chunk.kind === "usage" && chunk.usage.outputTokens),
    ).toEqual([1, 15]);
    expect(chunks.at(-1)).toEqual({ kind: "done", finishReason: "end_turn" });
  });

  it("keeps the usage a hop reported before it failed partway", async () => {
    const { chunks, error } = await parse(
      `${START}event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n`,
    );

    expect(chunks).toEqual([
      {
        kind: "usage",
        usage: { inputTokens: 25, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
    expect(error).toMatchObject({ errorClass: "upstream" });
  });

  it.each([
    ["rate_limit_error", "rate_limit"],
    ["authentication_error", "auth"],
    ["invalid_request_error", "config"],
    ["something_new", "upstream"],
  ])("classifies a %s error event as %s", async (type, errorClass) => {
    const { error } = await parse(
      `event: error\ndata: {"type":"error","error":{"type":"${type}"}}\n\n`,
    );

    expect(error).toMatchObject({ errorClass });
  });

  it("ignores thinking and tool-input deltas", async () => {
    const { chunks } = await parse(
      `${START}data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hm"}}\n\ndata: {"type":"message_stop"}\n\n`,
    );

    expect(chunks.some((chunk) => chunk.kind === "delta")).toBe(false);
  });

  it("calls a stream that ends before message_stop upstream", async () => {
    expect((await parse(START)).error).toMatchObject({
      errorClass: "upstream",
      detail: "stream ended early",
    });
  });
});

describe("anthropicRefusal", () => {
  it("tells model_not_found and context_window_exceeded from other refusals", () => {
    expect(
      anthropicRefusal(404, { error: { type: "not_found_error", message: "model: claude-x" } }),
    ).toBe("model_not_found");
    expect(
      anthropicRefusal(400, {
        error: { message: "prompt is too long: 210000 tokens > 200000 maximum" },
      }),
    ).toBe("context_window_exceeded");
    expect(anthropicRefusal(400, { error: { message: "messages: field required" } })).toBeNull();
  });
});
