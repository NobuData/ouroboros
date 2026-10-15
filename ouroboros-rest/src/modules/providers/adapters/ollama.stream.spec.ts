import type { InvocationChunk } from "../provider.adapter";
import { OLLAMA_INVOCATION_STREAM } from "./ollama.recordings.fixture";
import { ollamaRefusal, parseOllamaStream } from "./ollama.stream";

/** A body in one chunk. */
async function* body(text: string): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  yield new TextEncoder().encode(text);
}

/** Parse to the end, collecting what came out before any throw. */
async function parse(text: string): Promise<{ chunks: InvocationChunk[]; error: unknown }> {
  const chunks: InvocationChunk[] = [];

  try {
    for await (const chunk of parseOllamaStream(body(text))) {
      chunks.push(chunk);
    }
  } catch (error) {
    return { chunks, error };
  }

  return { chunks, error: null };
}

describe("parseOllamaStream", () => {
  it("emits usage from the last line, then done — the same as a hosted provider (R7)", async () => {
    const { chunks, error } = await parse(OLLAMA_INVOCATION_STREAM);

    expect(error).toBeNull();
    expect(chunks.slice(-2)).toEqual([
      {
        kind: "usage",
        usage: { inputTokens: 26, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      { kind: "done", finishReason: "stop" },
    ]);
  });

  it("refuses an error line and a stream with no done line as upstream", async () => {
    expect((await parse('{"error":"out of memory"}\n')).error).toMatchObject({
      errorClass: "upstream",
    });
    expect((await parse('{"message":{"content":"a"},"done":false}\n')).error).toMatchObject({
      errorClass: "upstream",
    });
  });
});

describe("ollamaRefusal", () => {
  it("reads a model that was never pulled as model_not_found", () => {
    expect(ollamaRefusal(404, { error: 'model "qwen3:8b" not found, try pulling it first' })).toBe(
      "model_not_found",
    );
    expect(ollamaRefusal(400, { error: "invalid options" })).toBeNull();
  });
});
