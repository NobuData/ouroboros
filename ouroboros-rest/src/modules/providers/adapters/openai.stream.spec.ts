import type { InvocationChunk } from "../provider.adapter";
import { OPENAI_INVOCATION_STREAM } from "./openai-compatible.recordings.fixture";
import { openAiRefusal, parseOpenAiStream } from "./openai.stream";

/** A body in one chunk. */
async function* body(text: string): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  yield new TextEncoder().encode(text);
}

/** Parse to the end, collecting what came out before any throw. */
async function parse(text: string): Promise<{ chunks: InvocationChunk[]; error: unknown }> {
  const chunks: InvocationChunk[] = [];

  try {
    for await (const chunk of parseOpenAiStream(body(text))) {
      chunks.push(chunk);
    }
  } catch (error) {
    return { chunks, error };
  }

  return { chunks, error: null };
}

describe("parseOpenAiStream", () => {
  it("splits cached tokens out of the prompt count and ends on [DONE]", async () => {
    const { chunks, error } = await parse(OPENAI_INVOCATION_STREAM);

    expect(error).toBeNull();
    expect(chunks.at(-1)).toEqual({ kind: "done", finishReason: "stop" });
  });

  it("completes on a finish_reason when a server omits [DONE]", async () => {
    const { chunks } = await parse(
      'data: {"choices":[{"delta":{"content":"a"},"finish_reason":"length"}]}\n\n',
    );

    expect(chunks).toEqual([
      { kind: "delta", text: "a" },
      { kind: "done", finishReason: "length" },
    ]);
  });

  it("classifies an error frame, rate limits apart", async () => {
    expect(
      (await parse('data: {"error":{"message":"Rate limit reached"}}\n\n')).error,
    ).toMatchObject({
      errorClass: "rate_limit",
    });
    expect((await parse('data: {"error":{"message":"boom"}}\n\n')).error).toMatchObject({
      errorClass: "upstream",
    });
  });

  it("calls a stream that stops mid-answer upstream", async () => {
    expect((await parse('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')).error).toMatchObject({
      errorClass: "upstream",
    });
  });
});

describe("openAiRefusal", () => {
  it("reads OpenAI's and vLLM's refusals", () => {
    expect(openAiRefusal(404, { error: { code: "model_not_found", message: "x" } })).toBe(
      "model_not_found",
    );
    expect(openAiRefusal(404, { message: "The model `qwen` does not exist." })).toBe(
      "model_not_found",
    );
    expect(openAiRefusal(400, { error: { code: "context_length_exceeded" } })).toBe(
      "context_window_exceeded",
    );
    expect(
      openAiRefusal(400, { message: "This model's maximum context length is 32768 tokens." }),
    ).toBe("context_window_exceeded");
    expect(openAiRefusal(400, { error: { message: "temperature must be a number" } })).toBeNull();
  });
});
