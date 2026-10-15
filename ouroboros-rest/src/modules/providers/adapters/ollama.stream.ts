/**
 * Ollama `/api/chat` NDJSON → {@link InvocationChunk}s — the third of AF.1's three parsers.
 *
 * ```
 * {message:{content},done:false}                      ─▶ delta
 * {done:true,done_reason,prompt_eval_count,eval_count} ─▶ usage, then done
 * {error:"…"}                                         ─▶ throw
 * ```
 *
 * Ollama always reports its counts on the last line, so usage needs no switch to ask for it.
 * A local model's usage is *unpriced*, not free (R7): the counts are real and are stored.
 */

import type { InvocationChunk } from "../provider.adapter";
import { ProviderAdapterError, type ModelRefusal } from "../provider.errors";
import {
  LineDecoder,
  bytesOf,
  count,
  endedEarly,
  errorText,
  field,
  frameJson,
  type ByteSource,
} from "./invocation.stream";

/** A request too long for the model, in Ollama's words. */
const CONTEXT_WINDOW = /context (length|window)|too many tokens/i;

/**
 * Tell a G8 refusal apart from an ordinary Ollama refusal.
 *
 * Ollama answers a model it has not pulled with `404 {"error":"model \"x\" not found, try
 * pulling it first"}`.
 *
 * @param status - The HTTP status.
 * @param body - The parsed error body.
 * @returns The refusal, or null.
 */
export function ollamaRefusal(status: number, body: unknown): ModelRefusal | null {
  const text = errorText(body);

  if (status === 404 || /model .*not found/i.test(text)) {
    return "model_not_found";
  }

  return CONTEXT_WINDOW.test(text) ? "context_window_exceeded" : null;
}

/**
 * One line's chunks.
 *
 * @param line - The line.
 * @returns The chunks to yield; the last is `done` on the `done: true` line.
 * @throws {ProviderAdapterError} For an `error` line or a malformed one.
 */
function step(line: string): InvocationChunk[] {
  if (line.trim() === "") {
    return [];
  }

  const frame = frameJson(line);

  if (field(frame, "error") !== undefined) {
    throw new ProviderAdapterError("upstream", "stream error");
  }

  const out: InvocationChunk[] = [];
  const content = field(field(frame, "message"), "content");

  if (typeof content === "string" && content !== "") {
    out.push({ kind: "delta", text: content });
  }

  if (field(frame, "done") === true) {
    const reason = field(frame, "done_reason");

    out.push(
      {
        kind: "usage",
        usage: {
          inputTokens: count(field(frame, "prompt_eval_count")),
          outputTokens: count(field(frame, "eval_count")),
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
      { kind: "done", finishReason: typeof reason === "string" ? reason : "stop" },
    );
  }

  return out;
}

/**
 * Parse an Ollama chat stream.
 *
 * @param source - The response body, or the call that opens it.
 * @yields Deltas, the usage total, and one `done` last.
 * @throws {ProviderAdapterError} For a refused request, an `error` line (`upstream`), a
 *   malformed line, or a stream that ends before `done: true`.
 */
export async function* parseOllamaStream(source: ByteSource): AsyncGenerator<InvocationChunk> {
  const decoder = new LineDecoder();

  for await (const bytes of await bytesOf(source)) {
    for (const line of decoder.push(bytes)) {
      for (const chunk of step(line)) {
        yield chunk;

        if (chunk.kind === "done") {
          return;
        }
      }
    }
  }

  for (const line of decoder.end()) {
    for (const chunk of step(line)) {
      yield chunk;

      if (chunk.kind === "done") {
        return;
      }
    }
  }

  throw endedEarly();
}
