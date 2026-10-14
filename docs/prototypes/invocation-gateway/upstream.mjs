/**
 * A fake model provider: an OpenAI-compatible `POST /v1/chat/completions` that streams.
 *
 * AF.1 (#234) measures what a gateway adds to a streamed call, so the provider has to be
 * deterministic: a fixed time to first token, a fixed pace, a fixed number of tokens. Every
 * path in the benchmark — direct, 4-A and 4-B — streams from this one server, so whatever
 * differs between their timings is the gateway's.
 *
 * Environment:
 *   PORT              where to listen (default 9100)
 *   FIRST_TOKEN_MS    delay before the first token, the model "thinking" (default 200)
 *   INTERVAL_MS       delay between tokens; 0 sends them as fast as the socket takes them
 *                     (default 10, about 100 tokens a second — a fast hosted model)
 *   TOKENS            tokens per answer, unless the request's `max_tokens` is smaller
 *                     (default 256)
 *
 * It also answers `POST /v1/messages` in the Anthropic Messages streaming shape — with `ping`
 * events, and with a fixed `400` error body for any model whose name contains `refuse` — and
 * `GET /last-headers` with the headers the last Messages call arrived with. `check-messages.sh`
 * uses those three to test what R9 needs a gateway to pass through unchanged.
 *
 * The chat-completions answer is the OpenAI streaming shape: one `chat.completion.chunk` per token, a final
 * chunk with `usage` when the request asked for it (`stream_options.include_usage`), then
 * `data: [DONE]`. That is the shape LiteLLM's `openai/` provider and our relay both parse.
 */

import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 9100);
const FIRST_TOKEN_MS = Number(process.env.FIRST_TOKEN_MS ?? 200);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 10);
const TOKENS = Number(process.env.TOKENS ?? 256);

/**
 * Read a request body as JSON.
 *
 * @param {import("node:http").IncomingMessage} request - The request.
 * @returns {Promise<Record<string, unknown>>} The parsed body, or `{}` when it is empty.
 */
async function jsonBody(request) {
  const chunks = [];

  for await (const chunk of request) chunks.push(chunk);

  const text = Buffer.concat(chunks).toString("utf8");

  return text === "" ? {} : JSON.parse(text);
}

/**
 * One SSE frame carrying a chunk.
 *
 * @param {string} id - The completion id.
 * @param {string} model - The model name echoed back.
 * @param {Record<string, unknown>} fields - What the chunk carries beyond its envelope.
 * @returns {string} The frame, terminated by a blank line.
 */
function frame(id, model, fields) {
  return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model, ...fields })}\n\n`;
}

/** The exact error body a refused Messages call answers with — what R9 needs passed through unmodified. */
export const REFUSAL_BODY = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "upstream-refusal-canary: prompt is too long" },
});

/** The headers the last `/v1/messages` call arrived with. */
let lastMessagesHeaders = {};

/**
 * One Anthropic SSE event.
 *
 * @param {string} event - The event name.
 * @param {Record<string, unknown>} data - Its payload.
 * @returns {string} The frame.
 */
function anthropicEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

/**
 * Answer an Anthropic Messages call: streamed, with a `ping` after `message_start` and another
 * between deltas, as the vendor's own stream does.
 *
 * @param {import("node:http").IncomingMessage} request - The request.
 * @param {import("node:http").ServerResponse} response - The response.
 * @returns {Promise<void>}
 */
async function messages(request, response) {
  lastMessagesHeaders = request.headers;

  const body = await jsonBody(request);
  const model = String(body.model ?? "claude-bench");

  if (model.includes("refuse")) {
    response.writeHead(400, { "content-type": "application/json" }).end(REFUSAL_BODY);
    return;
  }

  const tokens = Math.min(5, Number(body.max_tokens ?? 5));

  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  response.write(
    anthropicEvent("message_start", {
      message: {
        id: "msg_bench",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    }),
  );
  response.write(anthropicEvent("ping", {}));
  response.write(
    anthropicEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
  );

  for (let index = 0; index < tokens; index += 1) {
    response.write(
      anthropicEvent("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text: `tok${index} ` },
      }),
    );

    if (index === 1) response.write(anthropicEvent("ping", {}));

    await sleep(INTERVAL_MS);
  }

  response.write(anthropicEvent("content_block_stop", { index: 0 }));
  response.write(
    anthropicEvent("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: tokens },
    }),
  );
  response.end(anthropicEvent("message_stop", {}));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200).end("ok");
    return;
  }

  if (request.method === "GET" && request.url === "/last-headers") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(lastMessagesHeaders));
    return;
  }

  if (request.method === "POST" && request.url?.startsWith("/v1/messages")) {
    await messages(request, response);
    return;
  }

  if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }

  const body = await jsonBody(request);
  const model = String(body.model ?? "bench");
  const tokens = Math.min(TOKENS, Number(body.max_tokens ?? TOKENS));
  const withUsage = Boolean(body.stream_options?.include_usage);
  const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
  let closed = false;

  response.on("close", () => {
    closed = true;
  });
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  await sleep(FIRST_TOKEN_MS);

  for (let index = 0; index < tokens && !closed; index += 1) {
    response.write(
      frame(id, model, {
        choices: [{ index: 0, delta: { content: `tok${index} ` }, finish_reason: null }],
      }),
    );

    if (INTERVAL_MS > 0) await sleep(INTERVAL_MS);
  }

  if (closed) return;

  response.write(
    frame(id, model, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
  );

  if (withUsage) {
    response.write(
      frame(id, model, {
        choices: [],
        usage: { prompt_tokens: 12, completion_tokens: tokens, total_tokens: 12 + tokens },
      }),
    );
  }

  response.end("data: [DONE]\n\n");
});

server.keepAliveTimeout = 60_000;
server.listen(PORT, "127.0.0.1", () => {
  console.log(`upstream on :${PORT} first=${FIRST_TOKEN_MS}ms interval=${INTERVAL_MS}ms tokens=${TOKENS}`);
});
