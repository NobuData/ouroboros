/**
 * The REST hop of the invocation gateway, reduced to what is on the token hot path.
 *
 * Both candidates in AF.1 (#234) put `ouroboros-rest` between the worker and the model: it
 * answers `POST /internal/llm/invoke` with the NDJSON stream `invoke.contract.ts` defines,
 * captures usage per hop and checks the cap as tokens arrive. What differs is what REST calls:
 *
 *   4-A  REST calls the provider itself (the adapter's `invoke()`).        TARGET = provider
 *   4-B  REST calls a LiteLLM sidecar, which calls the provider.            TARGET = LiteLLM
 *
 * So this one relay serves both measurements, and the 4-B figure is this relay *plus*
 * LiteLLM — which is the honest comparison, since 4-B removes none of REST's work.
 *
 * Per request it does what the executor must do per streamed call: unwrap a key for one hop
 * (simulated — a fixed string, never logged), open the upstream stream, parse every SSE frame,
 * re-emit each delta as an NDJSON `delta` event as it arrives (R6: never buffered), track
 * output tokens against a cap (R4), and close with `usage`, `hop` and `done`.
 *
 * Express 5, the same HTTP stack `ouroboros-rest` runs on (`@nestjs/platform-express`); Nest's
 * own routing adds a fixed per-request cost, not a per-token one, so it is left out.
 *
 * Environment:
 *   PORT    where to listen (default 9200)
 *   TARGET  the OpenAI-compatible base URL to call (default http://127.0.0.1:9100/v1)
 *   MODEL   the model name to send (default "bench")
 *   KEY     the bearer credential sent to TARGET (default a simulated provider key). For 4-B
 *           it is the sidecar's own key, since LiteLLM refuses to start without one
 */

import express from "express";
import { Agent, setGlobalDispatcher } from "undici";

const PORT = Number(process.env.PORT ?? 9200);
const TARGET = process.env.TARGET ?? "http://127.0.0.1:9100/v1";
const MODEL = process.env.MODEL ?? "bench";
const KEY = process.env.KEY ?? "sk-simulated-unwrapped-for-one-hop";

// A pooled keep-alive dispatcher, as a production executor would hold. Unbounded connections
// per origin: the benchmark is about the relay's cost, not about a pool limit it chose.
setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, connections: null }));

/**
 * Split a growing SSE buffer into complete `data:` payloads.
 *
 * @param {string} buffer - Text received so far, possibly ending mid-frame.
 * @returns {{ payloads: string[], rest: string }} The complete payloads, and what is left over.
 */
export function ssePayloads(buffer) {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const payloads = [];

  for (const frame of frames) {
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) payloads.push(line.slice(5).trim());
    }
  }

  return { payloads, rest };
}

const app = express();

app.use(express.json());

app.post("/internal/llm/invoke", async (request, response) => {
  const started = performance.now();
  const capTokens = Number(request.body?.runCtx?.capTokens ?? Number.POSITIVE_INFINITY);
  const key = KEY; // R10: unwrapped per request in the real executor, and never logged

  response.status(200).set({ "content-type": "application/x-ndjson", "cache-control": "no-store" });
  response.flushHeaders();

  const emit = (event) => response.write(`${JSON.stringify(event)}\n`);
  let outputTokens = 0;
  let usage = null;

  try {
    const upstream = await fetch(`${TARGET}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        stream_options: { include_usage: true },
        messages: request.body?.payload?.messages ?? [{ role: "user", content: "hi" }],
        max_tokens: request.body?.payload?.max_tokens,
      }),
    });

    if (!upstream.ok || upstream.body === null) {
      emit({ kind: "error", code: "provider_unavailable", status: upstream.status });
      emit({ kind: "done" });
      response.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });

      const { payloads, rest } = ssePayloads(buffer);

      buffer = rest;

      for (const payload of payloads) {
        if (payload === "[DONE]") continue;

        const parsed = JSON.parse(payload);
        const text = parsed.choices?.[0]?.delta?.content;

        if (parsed.usage) usage = parsed.usage;

        if (typeof text === "string" && text !== "") {
          outputTokens += 1;
          emit({ kind: "delta", hop: 0, text });

          if (outputTokens > capTokens) {
            emit({ kind: "error", code: "cost_cap_exceeded" });
            emit({ kind: "done" });
            response.end();
            return;
          }
        }
      }
    }

    emit({
      kind: "usage",
      hop: 0,
      connection: "bench",
      model: MODEL,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? outputTokens,
      costCents: null,
    });
    emit({
      kind: "hop",
      hop: 0,
      connection: "bench",
      outcome: "ok",
      latencyMs: Math.round(performance.now() - started),
    });
    emit({ kind: "done" });
    response.end();
  } catch (error) {
    emit({ kind: "error", code: "provider_unavailable", detail: String(error?.cause?.code ?? error) });
    emit({ kind: "done" });
    response.end();
  }
});

app.get("/health", (_request, response) => {
  response.send("ok");
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`relay on :${PORT} → ${TARGET}`);
});

server.keepAliveTimeout = 60_000;
